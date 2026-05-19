use crate::commands::environment::load_environment_values;
use crate::commands::state::{RequestRegistry, RunningRequest};
use crate::model::collection::{
    Auth, AuthLocation, Body, HttpMethod, KeyValue, MultipartField, Request, RequestTls,
};
use crate::model::http::{HttpErrorDto, HttpResponseDto};
use rand::Rng;
use std::collections::{HashMap, HashSet};
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
    HttpErrorDto {
        kind: kind.to_string(),
        message: message.into(),
        detail,
        duration_ms,
    }
}

fn map_reqwest_error(e: reqwest::Error, duration_ms: Option<u128>) -> HttpErrorDto {
    let msg = e.to_string();
    let msg_lower = msg.to_lowercase();

    if msg_lower.contains("invalid header")
        || msg_lower.contains("header name")
        || msg_lower.contains("header value")
    {
        return err(
            "invalid_header",
            "Invalid header name or value",
            Some(msg),
            duration_ms,
        );
    }

    // Url invalide / parsing
    if e.is_builder() {
        if msg_lower.contains("url") {
            return err("invalid_url", "Invalid URL", Some(msg), duration_ms);
        }
        return err(
            "invalid_request",
            "Invalid request (URL/headers/body)",
            Some(msg),
            duration_ms,
        );
    }

    // Timeout
    if e.is_timeout() {
        return err("timeout", "Request timed out", Some(msg), duration_ms);
    }

    // TLS / certificate
    // (reqwest does not provide an "is_tls" helper, keep a soft heuristic)
    if msg_lower.contains("tls")
        || msg_lower.contains("certificate")
        || msg_lower.contains("unknownissuer")
        || msg_lower.contains("x509")
        || msg_lower.contains("ssl")
    {
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

        return err("tls", explanation, Some(msg), duration_ms);
    }

    // DNS (typically a domain typo)
    // (heuristic, but works well)
    if msg_lower.contains("dns")
        || msg_lower.contains("failed to lookup address")
        || msg_lower.contains("name or service not known")
        || msg_lower.contains("nodename nor servname provided")
    {
        return err(
            "dns",
            "DNS lookup failed (domain not found)",
            Some(msg),
            duration_ms,
        );
    }

    // Connect
    if e.is_connect() {
        if msg_lower.contains("connection refused") {
            return err(
                "connect",
                "Connection refused by remote host",
                Some(msg),
                duration_ms,
            );
        }
        return err(
            "connect",
            "Could not connect to server",
            Some(msg),
            duration_ms,
        );
    }

    if msg_lower.contains("http/2")
        || msg_lower.contains("frame")
        || msg_lower.contains("unexpected eof")
        || msg_lower.contains("connection reset")
        || msg_lower.contains("broken pipe")
    {
        return err(
            "protocol",
            "HTTP protocol/connection error",
            Some(msg),
            duration_ms,
        );
    }

    err("unknown", "Request failed", Some(msg), duration_ms)
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
) -> Result<reqwest::ClientBuilder, HttpErrorDto> {
    if tls.allow_invalid_certificates {
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

pub async fn do_send_request(mut req: Request) -> Result<HttpResponseDto, HttpErrorDto> {
    apply_auth_to_request(&mut req);
    const REQUEST_TIMEOUT_SECONDS: u64 = 120;

    // 1) validate URL early
    let url = reqwest::Url::parse(&req.url)
        .map_err(|e| err("invalid_url", "Invalid URL", Some(e.to_string()), None))?;

    // 2) client with explicit timeout budget + TLS options
    let client_builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .connect_timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS));
    let client_builder = apply_tls_settings(client_builder, &req.tls)?;
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
        map_reqwest_error(e, Some(d))
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
        map_reqwest_error(e, Some(d))
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
      res = do_send_request(req) => res,
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
