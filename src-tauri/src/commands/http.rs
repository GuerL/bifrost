use crate::commands::environment::load_environment_values;
use crate::commands::state::{RequestRegistry, RunningRequest};
use crate::model::collection::{Body, HttpMethod, KeyValue, Request};
use crate::model::http::{HttpErrorDto, HttpResponseDto};
use std::collections::{HashMap, HashSet};
use std::time::Instant;
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
    // Url invalide / parsing
    if e.is_builder() {
        return err(
            "invalid_url",
            "Invalid request (URL/headers/body)",
            Some(e.to_string()),
            duration_ms,
        );
    }

    // Timeout
    if e.is_timeout() {
        return err(
            "timeout",
            "Request timed out",
            Some(e.to_string()),
            duration_ms,
        );
    }

    // TLS / certificat
    // (reqwest ne donne pas un helper "is_tls", on garde un heuristique soft)
    let msg = e.to_string();
    if msg.to_lowercase().contains("tls") || msg.to_lowercase().contains("certificate") {
        return err("tls", "TLS / certificate error", Some(msg), duration_ms);
    }

    // DNS (typo de domaine typiquement)
    // (heuristique, mais marche bien)
    if msg.to_lowercase().contains("dns")
        || msg.to_lowercase().contains("failed to lookup address")
        || msg.to_lowercase().contains("name or service not known")
        || msg
            .to_lowercase()
            .contains("nodename nor servname provided")
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
        return err(
            "connect",
            "Could not connect to server",
            Some(e.to_string()),
            duration_ms,
        );
    }

    err(
        "unknown",
        "Request failed",
        Some(e.to_string()),
        duration_ms,
    )
}

fn replace_vars_in_text(
    input: &str,
    vars: &HashMap<String, String>,
    unresolved: &mut HashSet<String>,
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
) {
    match value {
        serde_json::Value::String(s) => {
            *s = replace_vars_in_text(s, vars, unresolved);
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                resolve_json_value(v, vars, unresolved);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                resolve_json_value(v, vars, unresolved);
            }
        }
        _ => {}
    }
}

fn resolve_request_vars(
    mut req: Request,
    vars: &HashMap<String, String>,
) -> (Request, Vec<String>) {
    let mut unresolved = HashSet::new();

    req.url = replace_vars_in_text(&req.url, vars, &mut unresolved);

    for kv in req.headers.iter_mut() {
        kv.key = replace_vars_in_text(&kv.key, vars, &mut unresolved);
        kv.value = replace_vars_in_text(&kv.value, vars, &mut unresolved);
    }

    for kv in req.query.iter_mut() {
        kv.key = replace_vars_in_text(&kv.key, vars, &mut unresolved);
        kv.value = replace_vars_in_text(&kv.value, vars, &mut unresolved);
    }

    req.body = match req.body {
        Body::None => Body::None,
        Body::Raw { content_type, text } => Body::Raw {
            content_type: replace_vars_in_text(&content_type, vars, &mut unresolved),
            text: replace_vars_in_text(&text, vars, &mut unresolved),
        },
        Body::Json { mut value } => {
            resolve_json_value(&mut value, vars, &mut unresolved);
            Body::Json { value }
        }
        Body::Form { mut fields } => {
            for kv in fields.iter_mut() {
                kv.key = replace_vars_in_text(&kv.key, vars, &mut unresolved);
                kv.value = replace_vars_in_text(&kv.value, vars, &mut unresolved);
            }
            Body::Form { fields }
        }
    };

    let mut unresolved_vec: Vec<String> = unresolved.into_iter().collect();
    unresolved_vec.sort();
    (req, unresolved_vec)
}
pub async fn do_send_request(req: Request) -> Result<HttpResponseDto, HttpErrorDto> {
    // 1) validate URL early
    let url = reqwest::Url::parse(&req.url)
        .map_err(|e| err("invalid_url", "Invalid URL", Some(e.to_string()), None))?;

    // 2) client with timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(59998)) // 1 minutes max (on gère le timeout côté JS, on veut juste éviter les timeouts automatiques de reqwest)
        .build()
        .map_err(|e| {
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
    for h in &req.headers {
        if !h.key.trim().is_empty() {
            builder = builder.header(h.key.trim(), h.value.clone());
        }
    }

    // query params
    if !req.query.is_empty() {
        let pairs: Vec<(String, String)> = req
            .query
            .iter()
            .filter(|kv| !kv.key.trim().is_empty())
            .map(|kv| (kv.key.clone(), kv.value.clone()))
            .collect();
        builder = builder.query(&pairs);
    }

    // body
    builder = match &req.body {
        Body::None => builder,
        Body::Raw { content_type, text } => builder
            .header("Content-Type", content_type.clone())
            .body(text.clone()),
        Body::Json { value } => builder.json(value),
        Body::Form { fields } => {
            let pairs: Vec<(String, String)> = fields
                .iter()
                .filter(|kv| !kv.key.trim().is_empty())
                .map(|kv| (kv.key.clone(), kv.value.clone()))
                .collect();
            builder.form(&pairs)
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
) -> Result<HttpResponseDto, HttpErrorDto> {
    let vars = load_environment_values(&app, environment_id).map_err(|e| {
        err(
            "environment",
            "Failed to load environment values",
            Some(e),
            None,
        )
    })?;
    let (req, unresolved) = resolve_request_vars(req, &vars);
    if !unresolved.is_empty() {
        return Err(err(
            "variables",
            format!("Missing environment variables: {}", unresolved.join(", ")),
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
