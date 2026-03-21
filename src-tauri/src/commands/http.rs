use crate::commands::environment::load_environment_values;
use crate::commands::state::{RequestRegistry, RunningRequest};
use crate::model::collection::{Auth, AuthLocation, Body, HttpMethod, KeyValue, Request};
use crate::model::http::{HttpErrorDto, HttpResponseDto};
use rand::Rng;
use std::collections::{HashMap, HashSet};
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

    // TLS / certificate
    // (reqwest does not provide an "is_tls" helper, keep a soft heuristic)
    let msg = e.to_string();
    if msg.to_lowercase().contains("tls") || msg.to_lowercase().contains("certificate") {
        return err("tls", "TLS / certificate error", Some(msg), duration_ms);
    }

    // DNS (typically a domain typo)
    // (heuristic, but works well)
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

    let mut unresolved_vec: Vec<String> = unresolved.into_iter().collect();
    unresolved_vec.sort();
    (req, unresolved_vec)
}

fn parse_json_body_text(text: &str) -> Result<serde_json::Value, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({}));
    }

    json5::from_str::<serde_json::Value>(trimmed).map_err(|error| error.to_string())
}

fn resolve_json_body_from_text(mut req: Request) -> Result<Request, String> {
    if let Body::Json { value: _, text } = req.body.clone() {
        let parsed = parse_json_body_text(&text)?;
        req.body = Body::Json {
            value: parsed,
            text,
        };
    }

    Ok(req)
}

fn upsert_header(headers: &mut Vec<KeyValue>, key: &str, value: String) {
    if let Some(entry) = headers
        .iter_mut()
        .find(|header| header.key.eq_ignore_ascii_case(key))
    {
        entry.value = value;
        return;
    }

    headers.push(KeyValue {
        key: key.to_string(),
        value,
    });
}

fn upsert_query(query: &mut Vec<KeyValue>, key: &str, value: String) {
    if let Some(entry) = query.iter_mut().find(|param| param.key == key) {
        entry.value = value;
        return;
    }

    query.push(KeyValue {
        key: key.to_string(),
        value,
    });
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

pub async fn do_send_request(mut req: Request) -> Result<HttpResponseDto, HttpErrorDto> {
    apply_auth_to_request(&mut req);
    const REQUEST_TIMEOUT_SECONDS: u64 = 120;

    // 1) validate URL early
    let url = reqwest::Url::parse(&req.url)
        .map_err(|e| err("invalid_url", "Invalid URL", Some(e.to_string()), None))?;

    // 2) client with explicit 60s timeout budget
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .connect_timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
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

    builder = match &req.auth {
        Auth::Basic { username, password } => {
            builder.basic_auth(username.clone(), Some(password.clone()))
        }
        _ => builder,
    };

    // body
    builder = match &req.body {
        Body::None => builder,
        Body::Raw { content_type, text } => builder
            .header("Content-Type", content_type.clone())
            .body(text.clone()),
        Body::Json { value, .. } => builder.json(value),
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
    extra_variables: Option<HashMap<String, String>>,
) -> Result<HttpResponseDto, HttpErrorDto> {
    let should_parse_json_text = matches!(&req.body, Body::Json { text, .. } if text.contains("{{"));
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
    let req = if should_parse_json_text {
        resolve_json_body_from_text(req).map_err(|detail| {
            err(
                "invalid_json",
                "Invalid JSON body after variable resolution",
                Some(detail),
                None,
            )
        })?
    } else {
        req
    };

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
