use crate::commands::environment::load_environment_values;
use crate::commands::settings::{
    apply_reqwest_proxy_configuration, load_app_settings_value, resolve_effective_proxy_transport,
    ResolvedProxyTransport,
};
use crate::commands::state::{RequestRegistry, RunningRequest};
use crate::model::collection::{
    Auth, AuthLocation, Body, HttpMethod, KeyValue, MultipartField, Request, RequestTls,
};
use crate::model::http::{HttpErrorDiagnosticDto, HttpErrorDto, HttpResponseDto};
use rand::Rng;
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::io;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[tauri::command]
pub fn is_pending(registry: State<'_, RequestRegistry>, request_id: String) -> bool {
    let map = registry.running.lock().unwrap();
    map.contains_key(&request_id)
}

fn err(
    kind: &str,
    message: impl Into<String>,
    detail: Option<String>,
    duration_ms: Option<u128>,
) -> HttpErrorDto {
    err_with_diagnostics(kind, message, detail, duration_ms, vec![])
}

fn err_with_diagnostics(
    kind: &str,
    message: impl Into<String>,
    detail: Option<String>,
    duration_ms: Option<u128>,
    diagnostics: Vec<HttpErrorDiagnosticDto>,
) -> HttpErrorDto {
    HttpErrorDto {
        kind: kind.to_string(),
        message: message.into(),
        detail,
        diagnostics,
        duration_ms,
    }
}

struct TransportErrorContext<'a> {
    target_url: &'a reqwest::Url,
    request_timeout_ms: u64,
    verify_tls_certificates: bool,
    request_tls: &'a RequestTls,
    proxy: &'a ResolvedProxyTransport,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NetworkErrorKind {
    Dns,
    ConnectionRefused,
    ConnectionTimeout,
    RequestTimeout,
    Tls,
    Proxy,
    ProxyAuthentication,
    ConnectionReset,
    Connection,
    Redirect,
    InvalidUrl,
    InvalidRequest,
    InvalidHeader,
    ResponseBody,
    Unknown,
}

impl NetworkErrorKind {
    fn wire(self) -> &'static str {
        match self {
            Self::Dns => "dns",
            Self::ConnectionRefused => "connection_refused",
            Self::ConnectionTimeout => "connection_timeout",
            Self::RequestTimeout => "request_timeout",
            Self::Tls => "tls",
            Self::Proxy => "proxy",
            Self::ProxyAuthentication => "proxy_auth",
            Self::ConnectionReset => "connection_reset",
            Self::Connection => "connection",
            Self::Redirect => "redirect",
            Self::InvalidUrl => "invalid_url",
            Self::InvalidRequest => "invalid_request",
            Self::InvalidHeader => "invalid_header",
            Self::ResponseBody => "response_body",
            Self::Unknown => "unknown",
        }
    }

    fn error_type(self) -> &'static str {
        match self {
            Self::Dns => "DNS resolution",
            Self::ConnectionRefused => "Connection refused",
            Self::ConnectionTimeout => "Connection timeout",
            Self::RequestTimeout => "Request timeout",
            Self::Tls => "TLS handshake",
            Self::Proxy => "Proxy connection",
            Self::ProxyAuthentication => "Proxy authentication",
            Self::ConnectionReset => "Connection reset",
            Self::Connection => "Connection",
            Self::Redirect => "Redirect",
            Self::InvalidUrl => "Invalid URL",
            Self::InvalidRequest => "Invalid request",
            Self::InvalidHeader => "Invalid header",
            Self::ResponseBody => "Response body",
            Self::Unknown => "Transport error",
        }
    }

    fn failure_phase(self) -> &'static str {
        match self {
            Self::Dns => "DNS resolution",
            Self::ConnectionRefused | Self::ConnectionTimeout | Self::Connection => {
                "Opening TCP connection"
            }
            Self::Tls => "TLS handshake",
            Self::Proxy | Self::ProxyAuthentication => "Proxy negotiation",
            Self::RequestTimeout => "Waiting for response",
            Self::ConnectionReset | Self::ResponseBody => "Reading response body",
            Self::Redirect => "Following redirect",
            Self::InvalidUrl | Self::InvalidRequest | Self::InvalidHeader => "Sending request",
            Self::Unknown => "HTTP transport",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Dns => "The hostname could not be resolved.",
            Self::ConnectionRefused => "The remote server refused the TCP connection.",
            Self::ConnectionTimeout => "The TCP connection could not be established.",
            Self::RequestTimeout => "The server did not respond within the configured timeout.",
            Self::Tls => "The TLS handshake or certificate validation failed.",
            Self::Proxy => "The request could not connect through the configured proxy.",
            Self::ProxyAuthentication => "The proxy rejected the configured credentials.",
            Self::ConnectionReset => "The connection was reset before the response completed.",
            Self::Connection => "The request could not establish a network connection.",
            Self::Redirect => "The request could not complete the redirect chain.",
            Self::InvalidUrl => "The request URL is invalid.",
            Self::InvalidRequest => "The request could not be sent.",
            Self::InvalidHeader => "A request header name or value is invalid.",
            Self::ResponseBody => "The response body could not be read.",
            Self::Unknown => "The request failed before an HTTP response was received.",
        }
    }
}

fn diagnostic(label: impl Into<String>, value: impl Into<String>) -> HttpErrorDiagnosticDto {
    HttpErrorDiagnosticDto {
        label: label.into(),
        value: value.into(),
    }
}

fn deepest_error_message(error: &(dyn Error + 'static)) -> Option<String> {
    let mut current = error.source()?;
    while let Some(next) = current.source() {
        current = next;
    }
    let message = current.to_string();
    if message.trim().is_empty() {
        None
    } else {
        Some(message)
    }
}

fn source_messages(error: &(dyn Error + 'static)) -> Vec<String> {
    let mut messages = vec![];
    let mut current = error.source();
    while let Some(source) = current {
        let message = source.to_string();
        if !message.trim().is_empty() {
            messages.push(message);
        }
        current = source.source();
    }
    messages
}

fn error_chain_hierarchy(error: &(dyn Error + 'static), kind: NetworkErrorKind) -> String {
    let messages = source_messages(error);
    let mut nodes = vec!["Request".to_string()];

    match kind {
        NetworkErrorKind::Dns => {
            nodes.push("Connect".to_string());
            nodes.push("DNS".to_string());
        }
        NetworkErrorKind::ConnectionRefused
        | NetworkErrorKind::ConnectionTimeout
        | NetworkErrorKind::Connection
        | NetworkErrorKind::ConnectionReset => {
            nodes.push("Connect".to_string());
        }
        NetworkErrorKind::Tls => {
            nodes.push("Connect".to_string());
            nodes.push("TLS".to_string());
        }
        NetworkErrorKind::Proxy | NetworkErrorKind::ProxyAuthentication => {
            nodes.push("Proxy".to_string());
        }
        NetworkErrorKind::RequestTimeout => {
            nodes.push("Timeout".to_string());
        }
        NetworkErrorKind::ResponseBody => {
            nodes.push("ResponseBody".to_string());
        }
        NetworkErrorKind::Redirect => {
            nodes.push("Redirect".to_string());
        }
        _ => {}
    }

    if let Some(deepest) = deepest_error_message(error) {
        let cleaned = concise_underlying_error(&deepest);
        if nodes.last().map(|last| last != &cleaned).unwrap_or(true) {
            nodes.push(cleaned);
        }
    } else {
        for message in messages {
            let cleaned = concise_underlying_error(&message);
            if nodes.last().map(|last| last != &cleaned).unwrap_or(true) {
                nodes.push(cleaned);
            }
        }
    }

    nodes
        .into_iter()
        .enumerate()
        .map(|(index, node)| {
            if index == 0 {
                node
            } else {
                format!("{}└── {}", "    ".repeat(index - 1), node)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn io_error_kind(error: &(dyn Error + 'static)) -> Option<io::ErrorKind> {
    let mut current = error.source();
    while let Some(source) = current {
        if let Some(io_error) = source.downcast_ref::<io::Error>() {
            return Some(io_error.kind());
        }
        current = source.source();
    }
    None
}

fn reqwest_error_kind(e: &reqwest::Error) -> String {
    let mut kinds = vec![];
    if e.is_timeout() {
        kinds.push("timeout");
    }
    if e.is_connect() {
        kinds.push("connect");
    }
    if e.is_request() {
        kinds.push("request");
    }
    if e.is_body() {
        kinds.push("body");
    }
    if e.is_decode() {
        kinds.push("decode");
    }
    if e.is_redirect() {
        kinds.push("redirect");
    }
    if e.is_builder() {
        kinds.push("builder");
    }
    if kinds.is_empty() {
        "unknown".to_string()
    } else {
        kinds.join(", ")
    }
}

fn certificate_hint(message: &str) -> Option<&'static str> {
    let lower = message.to_lowercase();
    if lower.contains("expired") {
        return Some("Expired");
    }
    if lower.contains("not yet valid") {
        return Some("Not yet valid");
    }
    if lower.contains("unknownissuer")
        || lower.contains("unknown issuer")
        || lower.contains("self signed")
        || lower.contains("local issuer")
    {
        return Some("Untrusted issuer");
    }
    if lower.contains("hostname") || lower.contains("dns name") || lower.contains("not valid for") {
        return Some("Hostname mismatch");
    }
    None
}

fn build_transport_diagnostics(
    kind: NetworkErrorKind,
    e: &reqwest::Error,
    msg: &str,
    duration_ms: Option<u128>,
    ctx: &TransportErrorContext<'_>,
) -> Vec<HttpErrorDiagnosticDto> {
    let deepest = deepest_error_message(e).unwrap_or_else(|| msg.to_string());
    let mut rows = vec![
        diagnostic("Error type", kind.error_type()),
        diagnostic("Target URL", ctx.target_url.as_str().to_string()),
    ];

    if let Some(host) = ctx.target_url.host_str() {
        rows.push(diagnostic("Host", host.to_string()));
    }

    match kind {
        NetworkErrorKind::RequestTimeout | NetworkErrorKind::ConnectionTimeout => {
            rows.push(diagnostic(
                "Configured timeout",
                format!("{} ms", ctx.request_timeout_ms),
            ));
            if let Some(duration) = duration_ms {
                rows.push(diagnostic("Elapsed time", format!("{duration} ms")));
            }
            rows.push(diagnostic("Failure phase", kind.failure_phase()));
            rows.push(diagnostic(
                "Underlying transport error",
                concise_underlying_error(&deepest),
            ));
        }
        NetworkErrorKind::Proxy | NetworkErrorKind::ProxyAuthentication => {
            rows.push(diagnostic(
                "Proxy",
                ctx.proxy
                    .info
                    .proxy_url
                    .clone()
                    .unwrap_or_else(|| ctx.proxy.info.summary.clone()),
            ));
            rows.push(diagnostic(
                "Authentication",
                if ctx.proxy.credentials_configured() {
                    "Configured"
                } else {
                    "Disabled"
                },
            ));
            rows.push(diagnostic("Failure phase", kind.failure_phase()));
            rows.push(diagnostic(
                "Underlying error",
                concise_underlying_error(&deepest),
            ));
        }
        NetworkErrorKind::Tls => {
            rows.push(diagnostic(
                "TLS validation",
                if ctx.verify_tls_certificates && !ctx.request_tls.allow_invalid_certificates {
                    "Enabled"
                } else {
                    "Disabled"
                },
            ));
            if let Some(hint) = certificate_hint(&deepest).or_else(|| certificate_hint(msg)) {
                rows.push(diagnostic("Certificate", hint));
            }
            rows.push(diagnostic("Failure phase", kind.failure_phase()));
            rows.push(diagnostic(
                "Underlying error",
                concise_underlying_error(&deepest),
            ));
        }
        NetworkErrorKind::Dns => {
            rows.push(diagnostic("Resolver", "System"));
            rows.push(diagnostic("Failure phase", kind.failure_phase()));
            rows.push(diagnostic(
                "Underlying error",
                concise_underlying_error(&deepest),
            ));
        }
        _ => {
            rows.push(diagnostic("Failure phase", kind.failure_phase()));
            rows.push(diagnostic(
                "Underlying error",
                concise_underlying_error(&deepest),
            ));
        }
    }

    if !matches!(
        kind,
        NetworkErrorKind::RequestTimeout | NetworkErrorKind::ConnectionTimeout
    ) {
        rows.push(diagnostic("Reqwest error kind", reqwest_error_kind(e)));
    }
    rows.push(diagnostic("Error chain", error_chain_hierarchy(e, kind)));
    rows
}

fn concise_underlying_error(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return "Unknown".to_string();
    }
    trimmed
        .strip_prefix("error trying to connect: ")
        .or_else(|| trimmed.strip_prefix("client error (Connect): "))
        .or_else(|| trimmed.strip_prefix("client error (Request): "))
        .unwrap_or(trimmed)
        .to_string()
}

fn classify_reqwest_error_kind(e: &reqwest::Error, msg_lower: &str) -> NetworkErrorKind {
    let io_kind = io_error_kind(e);
    let chain_text = source_messages(e).join(" ").to_lowercase();
    let text = format!("{msg_lower} {chain_text}");

    if text.contains("proxy authentication") || text.contains("proxy auth") || text.contains("407")
    {
        return NetworkErrorKind::ProxyAuthentication;
    }
    if text.contains("proxy connect")
        || text.contains("proxy error")
        || text.contains("proxy tunnel")
    {
        return NetworkErrorKind::Proxy;
    }
    if text.contains("invalid header")
        || text.contains("header name")
        || text.contains("header value")
    {
        return NetworkErrorKind::InvalidHeader;
    }
    if e.is_builder() {
        if text.contains("url") {
            return NetworkErrorKind::InvalidUrl;
        }
        return NetworkErrorKind::InvalidRequest;
    }

    if text.contains("dns")
        || text.contains("failed to lookup address")
        || text.contains("failed to lookup address information")
        || text.contains("name or service not known")
        || text.contains("nodename nor servname provided")
        || text.contains("temporary failure in name resolution")
        || text.contains("no address associated with hostname")
        || text.contains("could not resolve host")
    {
        return NetworkErrorKind::Dns;
    }

    if io_kind == Some(io::ErrorKind::ConnectionRefused) || text.contains("connection refused")
    {
        return NetworkErrorKind::ConnectionRefused;
    }

    if io_kind == Some(io::ErrorKind::TimedOut) || e.is_timeout() {
        if e.is_connect()
            || msg_lower.contains("tcp")
            || text.contains("connect")
            || text.contains("connecting")
        {
            return NetworkErrorKind::ConnectionTimeout;
        }
        return NetworkErrorKind::RequestTimeout;
    }

    if io_kind == Some(io::ErrorKind::ConnectionReset)
        || text.contains("connection reset")
        || text.contains("reset by peer")
    {
        return NetworkErrorKind::ConnectionReset;
    }

    if text.contains("tls")
        || text.contains("certificate")
        || text.contains("unknownissuer")
        || text.contains("x509")
        || text.contains("ssl")
    {
        return NetworkErrorKind::Tls;
    }
    if e.is_redirect() || text.contains("redirect") {
        return NetworkErrorKind::Redirect;
    }
    if e.is_connect() {
        if text.contains("proxy") {
            return NetworkErrorKind::Proxy;
        }
        return NetworkErrorKind::Connection;
    }
    if e.is_body() {
        return NetworkErrorKind::ResponseBody;
    }
    if text.contains("http/2")
        || text.contains("frame")
        || text.contains("unexpected eof")
        || text.contains("broken pipe")
    {
        return NetworkErrorKind::ResponseBody;
    }
    NetworkErrorKind::Unknown
}

fn map_reqwest_error(
    e: reqwest::Error,
    duration_ms: Option<u128>,
    ctx: &TransportErrorContext<'_>,
) -> HttpErrorDto {
    let msg = e.to_string();
    let msg_lower = msg.to_lowercase();
    let kind = classify_reqwest_error_kind(&e, &msg_lower);
    let diagnostics = build_transport_diagnostics(kind, &e, &msg, duration_ms, ctx);

    if kind == NetworkErrorKind::ProxyAuthentication {
        return err_with_diagnostics(
            kind.wire(),
            "Proxy authentication failed",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    if kind == NetworkErrorKind::Proxy {
        return err_with_diagnostics(
            kind.wire(),
            "Proxy connection failed",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    if kind == NetworkErrorKind::InvalidHeader {
        return err_with_diagnostics(
            kind.wire(),
            "Invalid header name or value",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    // Url invalide / parsing
    if kind == NetworkErrorKind::InvalidUrl {
        return err_with_diagnostics(
            kind.wire(),
            "Invalid URL",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }
    if kind == NetworkErrorKind::InvalidRequest {
        return err_with_diagnostics(
            kind.wire(),
            "Invalid request (URL/headers/body)",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    // Timeout
    if kind == NetworkErrorKind::RequestTimeout {
        return err_with_diagnostics(
            kind.wire(),
            "Request timed out",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }
    if kind == NetworkErrorKind::ConnectionTimeout {
        return err_with_diagnostics(
            kind.wire(),
            "Connection timed out",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    // TLS / certificate
    // (reqwest does not provide an "is_tls" helper, keep a soft heuristic)
    if kind == NetworkErrorKind::Tls {
        let explanation = if msg_lower.contains("unknownissuer")
            || msg_lower.contains("unknown issuer")
            || msg_lower.contains("self signed")
            || msg_lower.contains("unable to get local issuer certificate")
        {
            "TLS certificate is not trusted. Add a custom CA certificate path in TLS settings, or allow invalid certificates for local testing."
        } else if msg_lower.contains("expired") || msg_lower.contains("not yet valid") {
            "TLS certificate is expired or not yet valid."
        } else if msg_lower.contains("hostname")
            || msg_lower.contains("dns name")
            || msg_lower.contains("not valid for")
        {
            "TLS hostname verification failed. The certificate does not match the request host."
        } else if msg_lower.contains("handshake") {
            "TLS handshake failed. Check protocol/cipher compatibility and certificate settings."
        } else {
            "TLS handshake failed. Check certificate chain and TLS settings."
        };

        return err_with_diagnostics(
            kind.wire(),
            if explanation.is_empty() {
                kind.message()
            } else {
                explanation
            },
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    // DNS (typically a domain typo)
    // (heuristic, but works well)
    if kind == NetworkErrorKind::Dns {
        return err_with_diagnostics(
            kind.wire(),
            "DNS resolution failed",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    // Connect
    if kind == NetworkErrorKind::Connection {
        if msg_lower.contains("proxy") {
            return err_with_diagnostics(
                "proxy",
                "Proxy connection failed",
                deepest_error_message(&e),
                duration_ms,
                diagnostics,
            );
        }
        return err_with_diagnostics(
            kind.wire(),
            kind.message(),
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    if kind == NetworkErrorKind::ConnectionRefused {
        return err_with_diagnostics(
            kind.wire(),
            "Connection refused",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    if kind == NetworkErrorKind::ConnectionReset {
        return err_with_diagnostics(
            kind.wire(),
            "Connection reset",
            deepest_error_message(&e),
            duration_ms,
            diagnostics,
        );
    }

    err_with_diagnostics(
        kind.wire(),
        kind.message(),
        deepest_error_message(&e),
        duration_ms,
        diagnostics,
    )
}

fn replace_vars_in_text(
    input: &str,
    vars: &HashMap<String, String>,
    unresolved: &mut HashSet<String>,
    dynamic_values: &mut HashMap<String, String>,
) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;

    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '{' && chars[i + 1] == '{' {
            let mut j = i + 2;
            while j + 1 < chars.len() {
                if chars[j] == '}' && chars[j + 1] == '}' {
                    break;
                }
                j += 1;
            }

            if j + 1 < chars.len() {
                let raw_key: String = chars[i + 2..j].iter().collect();
                let key = raw_key.trim().to_string();
                if key.is_empty() {
                    out.push_str("{{}}");
                } else if key.starts_with('$') {
                    if let Some(cached) = dynamic_values.get(&key) {
                        out.push_str(cached);
                    } else if let Some(value) = resolve_dynamic_variable(&key) {
                        out.push_str(&value);
                        dynamic_values.insert(key, value);
                    } else {
                        unresolved.insert(key);
                        out.push_str("{{");
                        out.push_str(&raw_key);
                        out.push_str("}}");
                    }
                } else if let Some(value) = vars.get(&key) {
                    out.push_str(value);
                } else {
                    unresolved.insert(key);
                    out.push_str("{{");
                    out.push_str(&raw_key);
                    out.push_str("}}");
                }
                i = j + 2;
                continue;
            }
        }

        out.push(chars[i]);
        i += 1;
    }

    out
}

fn resolve_json_value(
    value: &mut serde_json::Value,
    vars: &HashMap<String, String>,
    unresolved: &mut HashSet<String>,
    dynamic_values: &mut HashMap<String, String>,
) {
    match value {
        serde_json::Value::String(s) => {
            *s = replace_vars_in_text(s, vars, unresolved, dynamic_values);
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                resolve_json_value(v, vars, unresolved, dynamic_values);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                resolve_json_value(v, vars, unresolved, dynamic_values);
            }
        }
        _ => {}
    }
}

fn resolve_dynamic_variable(name: &str) -> Option<String> {
    let normalized = name.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "$timestamp" => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis();
            Some(now.to_string())
        }
        "$timestampseconds" | "$timestamp_s" => {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
            Some(now.to_string())
        }
        "$uuid" => Some(Uuid::new_v4().to_string()),
        "$randomint" => {
            let value = rand::thread_rng().gen_range(0..1000);
            Some(value.to_string())
        }
        _ => None,
    }
}

fn resolve_request_vars(
    mut req: Request,
    vars: &HashMap<String, String>,
) -> (Request, Vec<String>) {
    let mut unresolved = HashSet::new();
    let mut dynamic_values = HashMap::new();

    req.url = replace_vars_in_text(&req.url, vars, &mut unresolved, &mut dynamic_values);

    for kv in req.headers.iter_mut() {
        kv.key = replace_vars_in_text(&kv.key, vars, &mut unresolved, &mut dynamic_values);
        kv.value = replace_vars_in_text(&kv.value, vars, &mut unresolved, &mut dynamic_values);
    }

    for kv in req.query.iter_mut() {
        kv.key = replace_vars_in_text(&kv.key, vars, &mut unresolved, &mut dynamic_values);
        kv.value = replace_vars_in_text(&kv.value, vars, &mut unresolved, &mut dynamic_values);
    }

    req.body = match req.body {
        Body::None => Body::None,
        Body::Raw { content_type, text } => Body::Raw {
            content_type: replace_vars_in_text(
                &content_type,
                vars,
                &mut unresolved,
                &mut dynamic_values,
            ),
            text: replace_vars_in_text(&text, vars, &mut unresolved, &mut dynamic_values),
        },
        Body::Json { mut value, text } => {
            let resolved_text =
                replace_vars_in_text(&text, vars, &mut unresolved, &mut dynamic_values);
            if resolved_text.trim().is_empty() {
                resolve_json_value(&mut value, vars, &mut unresolved, &mut dynamic_values);
            }
            Body::Json {
                value,
                text: resolved_text,
            }
        }
        Body::Form { mut fields } => {
            for kv in fields.iter_mut() {
                kv.key = replace_vars_in_text(&kv.key, vars, &mut unresolved, &mut dynamic_values);
                kv.value =
                    replace_vars_in_text(&kv.value, vars, &mut unresolved, &mut dynamic_values);
            }
            Body::Form { fields }
        }
        Body::Multipart { mut fields } => {
            for field in fields.iter_mut() {
                match field {
                    MultipartField::Text { name, value, .. } => {
                        *name =
                            replace_vars_in_text(name, vars, &mut unresolved, &mut dynamic_values);
                        *value =
                            replace_vars_in_text(value, vars, &mut unresolved, &mut dynamic_values);
                    }
                    MultipartField::File {
                        name,
                        file_path,
                        file_name,
                        mime_type,
                        ..
                    } => {
                        *name =
                            replace_vars_in_text(name, vars, &mut unresolved, &mut dynamic_values);
                        *file_path = replace_vars_in_text(
                            file_path,
                            vars,
                            &mut unresolved,
                            &mut dynamic_values,
                        );
                        if let Some(value) = file_name.as_ref() {
                            *file_name = Some(replace_vars_in_text(
                                value,
                                vars,
                                &mut unresolved,
                                &mut dynamic_values,
                            ));
                        }
                        if let Some(value) = mime_type.as_ref() {
                            *mime_type = Some(replace_vars_in_text(
                                value,
                                vars,
                                &mut unresolved,
                                &mut dynamic_values,
                            ));
                        }
                    }
                }
            }
            Body::Multipart { fields }
        }
    };

    req.auth = match req.auth {
        Auth::None => Auth::None,
        Auth::Bearer { token } => Auth::Bearer {
            token: replace_vars_in_text(&token, vars, &mut unresolved, &mut dynamic_values),
        },
        Auth::Basic { username, password } => Auth::Basic {
            username: replace_vars_in_text(&username, vars, &mut unresolved, &mut dynamic_values),
            password: replace_vars_in_text(&password, vars, &mut unresolved, &mut dynamic_values),
        },
        Auth::ApiKey {
            key,
            value,
            location,
        } => Auth::ApiKey {
            key: replace_vars_in_text(&key, vars, &mut unresolved, &mut dynamic_values),
            value: replace_vars_in_text(&value, vars, &mut unresolved, &mut dynamic_values),
            location,
        },
    };

    req.tls.ca_certificate_path = replace_vars_in_text(
        &req.tls.ca_certificate_path,
        vars,
        &mut unresolved,
        &mut dynamic_values,
    );
    req.tls.client_certificate_path = replace_vars_in_text(
        &req.tls.client_certificate_path,
        vars,
        &mut unresolved,
        &mut dynamic_values,
    );

    let mut unresolved_vec: Vec<String> = unresolved.into_iter().collect();
    unresolved_vec.sort();
    (req, unresolved_vec)
}

fn upsert_header(headers: &mut Vec<KeyValue>, key: &str, value: String) {
    if let Some(entry) = headers
        .iter_mut()
        .find(|header| header.key.eq_ignore_ascii_case(key))
    {
        entry.value = value;
        entry.enabled = true;
        return;
    }

    headers.push(KeyValue {
        key: key.to_string(),
        value,
        enabled: true,
    });
}

fn upsert_query(query: &mut Vec<KeyValue>, key: &str, value: String) {
    if let Some(entry) = query.iter_mut().find(|param| param.key == key) {
        entry.value = value;
        entry.enabled = true;
        return;
    }

    query.push(KeyValue {
        key: key.to_string(),
        value,
        enabled: true,
    });
}

fn has_enabled_header(headers: &[KeyValue], key: &str) -> bool {
    headers
        .iter()
        .any(|entry| entry.enabled && entry.key.trim().eq_ignore_ascii_case(key))
}

fn is_generated_header_key(key: &str) -> bool {
    match key.trim().to_ascii_lowercase().as_str() {
        "host" | "user-agent" | "accept" | "accept-encoding" | "connection" | "content-length"
        | "content-type" | "cookie" => true,
        _ => false,
    }
}

fn is_generated_header_enabled(req: &Request, key: &str) -> bool {
    if !is_generated_header_key(key) {
        return true;
    }

    req.generated_headers
        .iter()
        .find(|entry| entry.key.trim().eq_ignore_ascii_case(key))
        .map(|entry| entry.enabled)
        .unwrap_or(true)
}

fn should_send_explicit_header(header: &KeyValue, body_is_multipart: bool) -> bool {
    if !header.enabled {
        return false;
    }

    let header_name = header.key.trim();
    if header_name.is_empty() {
        return false;
    }

    if body_is_multipart
        && (header_name.eq_ignore_ascii_case("content-type")
            || header_name.eq_ignore_ascii_case("content-length"))
    {
        return false;
    }

    true
}

fn should_auto_set_generated_content_type(req: &Request, content_type: &str) -> bool {
    if content_type.trim().is_empty() {
        return false;
    }
    if has_enabled_header(&req.headers, "content-type") {
        return false;
    }
    is_generated_header_enabled(req, "content-type")
}

fn apply_auth_to_request(req: &mut Request) {
    let auth = req.auth.clone();
    match auth {
        Auth::None => {}
        Auth::Bearer { token } => {
            upsert_header(&mut req.headers, "Authorization", format!("Bearer {token}"));
        }
        Auth::Basic { .. } => {
            // handled with reqwest::RequestBuilder::basic_auth below
        }
        Auth::ApiKey {
            key,
            value,
            location,
        } => {
            let trimmed_key = key.trim();
            if trimmed_key.is_empty() {
                return;
            }

            match location {
                AuthLocation::Header => {
                    upsert_header(&mut req.headers, trimmed_key, value.clone());
                }
                AuthLocation::Query => {
                    upsert_query(&mut req.query, trimmed_key, value.clone());
                }
            }
        }
    }
}

fn strip_json_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();

    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while i < chars.len() {
        let ch = chars[i];
        let next = chars.get(i + 1).copied().unwrap_or('\0');

        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
                out.push(ch);
            }
            i += 1;
            continue;
        }

        if in_block_comment {
            if ch == '*' && next == '/' {
                in_block_comment = false;
                i += 2;
                continue;
            }
            if ch == '\n' {
                out.push(ch);
            }
            i += 1;
            continue;
        }

        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
                i += 1;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                i += 1;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if ch == '"' {
            in_string = true;
            out.push(ch);
            i += 1;
            continue;
        }

        if ch == '/' && next == '/' {
            in_line_comment = true;
            i += 2;
            continue;
        }

        if ch == '/' && next == '*' {
            in_block_comment = true;
            i += 2;
            continue;
        }

        out.push(ch);
        i += 1;
    }

    out
}

fn load_custom_ca_certificates(path: &str) -> Result<Vec<reqwest::Certificate>, HttpErrorDto> {
    let bytes = std::fs::read(path).map_err(|e| {
        err(
            "tls_config",
            format!("Failed to read custom CA certificate file '{path}'"),
            Some(e.to_string()),
            None,
        )
    })?;

    if let Ok(bundle) = reqwest::Certificate::from_pem_bundle(&bytes) {
        if !bundle.is_empty() {
            return Ok(bundle);
        }
    }

    if let Ok(cert) = reqwest::Certificate::from_pem(&bytes) {
        return Ok(vec![cert]);
    }

    if let Ok(cert) = reqwest::Certificate::from_der(&bytes) {
        return Ok(vec![cert]);
    }

    Err(err(
        "tls_config",
        format!("Invalid CA certificate file '{path}'. Expected PEM or DER."),
        None,
        None,
    ))
}

fn load_client_identity(path: &str) -> Result<reqwest::Identity, HttpErrorDto> {
    let bytes = std::fs::read(path).map_err(|e| {
        err(
            "tls_config",
            format!("Failed to read client certificate file '{path}'"),
            Some(e.to_string()),
            None,
        )
    })?;

    reqwest::Identity::from_pem(&bytes).map_err(|e| {
        err(
            "tls_config",
            format!("Invalid client certificate file '{path}'. Expected PEM containing certificate and private key."),
            Some(e.to_string()),
            None,
        )
    })
}

fn apply_tls_settings(
    mut builder: reqwest::ClientBuilder,
    tls: &RequestTls,
    verify_tls_certificates: bool,
) -> Result<reqwest::ClientBuilder, HttpErrorDto> {
    if !verify_tls_certificates || tls.allow_invalid_certificates {
        builder = builder.danger_accept_invalid_certs(true);
    }

    let ca_path = tls.ca_certificate_path.trim();
    if !ca_path.is_empty() {
        let certs = load_custom_ca_certificates(ca_path)?;
        for cert in certs {
            builder = builder.add_root_certificate(cert);
        }
    }

    let identity_path = tls.client_certificate_path.trim();
    if !identity_path.is_empty() {
        let identity = load_client_identity(identity_path)?;
        builder = builder.identity(identity);
    }

    Ok(builder)
}

fn build_multipart_form(
    fields: &[MultipartField],
) -> Result<reqwest::multipart::Form, HttpErrorDto> {
    let mut form = reqwest::multipart::Form::new();

    for field in fields {
        match field {
            MultipartField::Text {
                enabled,
                name,
                value,
                ..
            } => {
                if !*enabled {
                    continue;
                }
                if name.trim().is_empty() {
                    return Err(err(
                        "invalid_request",
                        "Enabled multipart rows must have a field name.",
                        None,
                        None,
                    ));
                }
                form = form.text(name.clone(), value.clone());
            }
            MultipartField::File {
                enabled,
                name,
                file_path,
                file_name,
                mime_type,
                ..
            } => {
                if !*enabled {
                    continue;
                }

                if name.trim().is_empty() {
                    return Err(err(
                        "invalid_request",
                        "Enabled multipart rows must have a field name.",
                        None,
                        None,
                    ));
                }

                let normalized_path = file_path.trim();
                if normalized_path.is_empty() {
                    return Err(err(
                        "invalid_request",
                        format!("File field '{name}' has no file selected."),
                        None,
                        None,
                    ));
                }

                let file_bytes = std::fs::read(normalized_path).map_err(|e| {
                    err(
                        "file",
                        "Failed to read multipart file",
                        Some(format!("{normalized_path}: {e}")),
                        None,
                    )
                })?;
                let mut part = reqwest::multipart::Part::bytes(file_bytes);

                let resolved_file_name = file_name
                    .as_ref()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .or_else(|| {
                        Path::new(normalized_path)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .map(|value| value.to_string())
                    });
                if let Some(value) = resolved_file_name {
                    part = part.file_name(value);
                }

                if let Some(content_type) = mime_type
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                {
                    part = part.mime_str(content_type).map_err(|e| {
                        err(
                            "invalid_request",
                            format!(
                                "Invalid mime type '{content_type}' for multipart field '{}'",
                                name
                            ),
                            Some(e.to_string()),
                            None,
                        )
                    })?;
                }

                form = form.part(name.clone(), part);
            }
        }
    }

    Ok(form)
}

pub async fn do_send_request(
    app: &AppHandle,
    mut req: Request,
) -> Result<HttpResponseDto, HttpErrorDto> {
    apply_auth_to_request(&mut req);

    // 1) validate URL early
    let url = reqwest::Url::parse(&req.url)
        .map_err(|e| err("invalid_url", "Invalid URL", Some(e.to_string()), None))?;
    let url_for_diagnostics = url.clone();
    let app_settings = load_app_settings_value(app).map_err(|error| {
        err(
            "settings",
            "Failed to load application settings",
            Some(error),
            None,
        )
    })?;
    let resolved_proxy =
        resolve_effective_proxy_transport(app, &url, Some(app_settings.proxy.clone())).map_err(
            |error| {
                err(
                    "proxy",
                    "Failed to resolve proxy settings",
                    Some(error),
                    None,
                )
            },
        )?;
    let request_timeout_ms = app_settings.general.requests.request_timeout_ms;
    let verify_tls_certificates = app_settings.general.security.verify_tls_certificates;

    // 2) client with explicit timeout budget + TLS options
    let mut client_builder = reqwest::Client::builder();
    if request_timeout_ms > 0 {
        let timeout = std::time::Duration::from_millis(request_timeout_ms);
        client_builder = client_builder.timeout(timeout).connect_timeout(timeout);
    }
    client_builder = apply_reqwest_proxy_configuration(client_builder, &resolved_proxy)
        .map_err(|error| err("proxy", "Failed to apply proxy settings", Some(error), None))?;
    let client_builder = apply_tls_settings(client_builder, &req.tls, verify_tls_certificates)?;
    let client = client_builder.build().map_err(|e| {
        err(
            "unknown",
            "Failed to create HTTP client",
            Some(e.to_string()),
            None,
        )
    })?;

    // 3) method + builder
    let mut builder = match req.method {
        HttpMethod::Get => client.get(url),
        HttpMethod::Post => client.post(url),
        HttpMethod::Put => client.put(url),
        HttpMethod::Patch => client.patch(url),
        HttpMethod::Delete => client.delete(url),
        HttpMethod::Head => client.head(url),
        HttpMethod::Options => client.request(reqwest::Method::OPTIONS, url),
    };

    // headers
    let body_is_multipart = matches!(&req.body, Body::Multipart { .. });
    for h in &req.headers {
        if !should_send_explicit_header(h, body_is_multipart) {
            continue;
        }

        let header_name = h.key.trim();
        builder = builder.header(header_name, h.value.clone());
    }

    // query params
    if !req.query.is_empty() {
        let pairs: Vec<(String, String)> = req
            .query
            .iter()
            .filter(|kv| kv.enabled && !kv.key.trim().is_empty())
            .map(|kv| (kv.key.clone(), kv.value.clone()))
            .collect();
        builder = builder.query(&pairs);
    }

    builder = match &req.auth {
        Auth::Basic { username, password } => {
            builder.basic_auth(username.clone(), Some(password.clone()))
        }
        _ => builder,
    };

    // body
    builder = match &req.body {
        Body::None => builder,
        Body::Raw { content_type, text } => {
            if !should_auto_set_generated_content_type(&req, content_type) {
                builder.body(text.clone())
            } else {
                builder
                    .header("Content-Type", content_type.trim())
                    .body(text.clone())
            }
        }
        Body::Json { value, text } => {
            let should_auto_content_type = !has_enabled_header(&req.headers, "content-type")
                && is_generated_header_enabled(&req, "content-type");
            if text.trim().is_empty() {
                let json_body = value.to_string();
                if !should_auto_content_type {
                    builder.body(json_body)
                } else {
                    builder
                        .header("Content-Type", "application/json")
                        .body(json_body)
                }
            } else {
                let stripped = strip_json_comments(text);
                if !should_auto_content_type {
                    builder.body(stripped)
                } else {
                    builder
                        .header("Content-Type", "application/json")
                        .body(stripped)
                }
            }
        }
        Body::Form { fields } => {
            let pairs: Vec<(String, String)> = fields
                .iter()
                .filter(|kv| kv.enabled && !kv.key.trim().is_empty())
                .map(|kv| (kv.key.clone(), kv.value.clone()))
                .collect();
            builder.form(&pairs)
        }
        Body::Multipart { fields } => {
            let multipart = build_multipart_form(fields)?;
            builder.multipart(multipart)
        }
    };

    // 4) send + measure time even on failure
    let start = Instant::now();
    let resp = builder.send().await.map_err(|e| {
        let d = start.elapsed().as_millis();
        let ctx = TransportErrorContext {
            target_url: &url_for_diagnostics,
            request_timeout_ms,
            verify_tls_certificates,
            request_tls: &req.tls,
            proxy: &resolved_proxy,
        };
        map_reqwest_error(e, Some(d), &ctx)
    })?;
    let duration_ms = start.elapsed().as_millis();

    let status = resp.status().as_u16();

    let mut headers_out = vec![];
    for (k, v) in resp.headers().iter() {
        headers_out.push(KeyValue {
            key: k.to_string(),
            value: v.to_str().unwrap_or("").to_string(),
            enabled: true,
        });
    }

    let body_text = resp.text().await.map_err(|e| {
        let d = start.elapsed().as_millis();
        let ctx = TransportErrorContext {
            target_url: &url_for_diagnostics,
            request_timeout_ms,
            verify_tls_certificates,
            request_tls: &req.tls,
            proxy: &resolved_proxy,
        };
        map_reqwest_error(e, Some(d), &ctx)
    })?;

    Ok(HttpResponseDto {
        status,
        headers: headers_out,
        body_text,
        duration_ms,
    })
}

// helper
fn cancelled(duration_ms: Option<u128>) -> HttpErrorDto {
    HttpErrorDto {
        kind: "cancelled".into(),
        message: "Request cancelled".into(),
        detail: None,
        diagnostics: vec![],
        duration_ms,
    }
}

#[tauri::command]
pub async fn send_request(
    app: AppHandle,
    registry: State<'_, RequestRegistry>,
    request_id: String,
    req: Request,
    environment_id: Option<String>,
    extra_variables: Option<HashMap<String, String>>,
) -> Result<HttpResponseDto, HttpErrorDto> {
    let mut vars = load_environment_values(&app, environment_id).map_err(|e| {
        err(
            "environment",
            "Failed to load environment values",
            Some(e),
            None,
        )
    })?;
    if let Some(extra) = extra_variables {
        for (key, value) in extra {
            vars.insert(key, value);
        }
    }
    let (req, unresolved) = resolve_request_vars(req, &vars);
    if !unresolved.is_empty() {
        return Err(err(
            "variables",
            format!("Unresolved variables: {}", unresolved.join(", ")),
            None,
            None,
        ));
    }

    let token = CancellationToken::new();
    let run_id = Uuid::new_v4().to_string();

    // store (cancel previous)
    {
        let mut map = registry.running.lock().unwrap();
        if let Some(prev) = map.get(&request_id) {
            prev.token.cancel();
        }
        map.insert(
            request_id.clone(),
            RunningRequest {
                run_id: run_id.clone(),
                token: token.clone(),
            },
        );
    }
    let start = Instant::now();

    let result = tokio::select! {
      _ = token.cancelled() => Err(cancelled(Some(start.elapsed().as_millis()))),
      res = do_send_request(&app, req) => res,
    };

    // cleanup only if still the same run_id
    {
        let mut map = registry.running.lock().unwrap();
        if let Some(cur) = map.get(&request_id) {
            if cur.run_id == run_id {
                map.remove(&request_id);
            }
        }
    }

    result
}

#[tauri::command]
pub fn cancel_request(
    registry: State<'_, RequestRegistry>,
    request_id: String,
) -> Result<(), String> {
    let map = registry.running.lock().unwrap();
    if let Some(r) = map.get(&request_id) {
        r.token.cancel();
        return Ok(());
    }
    Err("No in-flight request with this id".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::collection::{Auth, Body, HttpMethod, Request, RequestScripts, RequestTls};

    fn build_request() -> Request {
        Request {
            id: "req_1".to_string(),
            name: "Request".to_string(),
            method: HttpMethod::Post,
            url: "http://localhost:8080/test".to_string(),
            headers: vec![],
            generated_headers: vec![],
            query: vec![],
            body: Body::None,
            auth: Auth::None,
            tls: RequestTls::default(),
            extractors: vec![],
            scripts: RequestScripts::default(),
        }
    }

    #[test]
    fn disabled_custom_headers_are_not_sent_explicitly() {
        let header = KeyValue {
            key: "X-Test".to_string(),
            value: "value".to_string(),
            enabled: false,
        };

        assert!(!should_send_explicit_header(&header, false));
    }

    #[test]
    fn disabled_generated_content_type_prevents_auto_content_type_injection() {
        let mut request = build_request();
        request.generated_headers = vec![crate::model::collection::GeneratedHeaderControl {
            key: "content-type".to_string(),
            enabled: false,
        }];
        assert!(!should_auto_set_generated_content_type(
            &request,
            "application/json"
        ));
    }

    #[test]
    fn generated_headers_default_to_enabled() {
        let request = build_request();
        assert!(is_generated_header_enabled(&request, "content-type"));
        assert!(is_generated_header_enabled(&request, "host"));
    }

    #[test]
    fn multipart_content_type_is_never_sent_explicitly() {
        let header = KeyValue {
            key: "Content-Type".to_string(),
            value: "multipart/form-data".to_string(),
            enabled: true,
        };
        assert!(!should_send_explicit_header(&header, true));
    }
}
