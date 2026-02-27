use std::time::Instant;

use crate::model::collection::*;
use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::commands::state::RequestRegistry;
use crate::model::collection::Request;
use crate::model::http::{HttpErrorDto, HttpResponseDto};



fn err(kind: &str, message: impl Into<String>, detail: Option<String>) -> HttpErrorDto {
  HttpErrorDto {
    kind: kind.to_string(),
    message: message.into(),
    detail,
  }
}

fn map_reqwest_error(e: reqwest::Error) -> HttpErrorDto {
  // Url invalide / parsing
  if e.is_builder() {
    return err("invalid_url", "Invalid request (URL/headers/body)", Some(e.to_string()));
  }

  // Timeout
  if e.is_timeout() {
    return err("timeout", "Request timed out", Some(e.to_string()));
  }

  // TLS / certificat
  // (reqwest ne donne pas un helper "is_tls", on garde un heuristique soft)
  let msg = e.to_string();
  if msg.to_lowercase().contains("tls") || msg.to_lowercase().contains("certificate") {
    return err("tls", "TLS / certificate error", Some(msg));
  }

  // DNS (typo de domaine typiquement)
  // (heuristique, mais marche bien)
  if msg.to_lowercase().contains("dns")
    || msg.to_lowercase().contains("failed to lookup address")
    || msg.to_lowercase().contains("name or service not known")
    || msg.to_lowercase().contains("nodename nor servname provided")
  {
    return err("dns", "DNS lookup failed (domain not found)", Some(msg));
  }

  // Connect
  if e.is_connect() {
    return err("connect", "Could not connect to server", Some(e.to_string()));
  }

  err("unknown", "Request failed", Some(e.to_string()))
}
pub async fn do_send_request(req: Request) -> Result<HttpResponseDto, HttpErrorDto> {
  // 1) validate URL early
  let url = reqwest::Url::parse(&req.url)
    .map_err(|e| err("invalid_url", "Invalid URL", Some(e.to_string())))?;

  // 2) client with timeout
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(60))
    .build()
    .map_err(|e| err("unknown", "Failed to create HTTP client", Some(e.to_string())))?;

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
  let resp = builder.send().await.map_err(map_reqwest_error)?;
  let duration_ms = start.elapsed().as_millis();

  let status = resp.status().as_u16();

  let mut headers_out = vec![];
  for (k, v) in resp.headers().iter() {
    headers_out.push(KeyValue {
      key: k.to_string(),
      value: v.to_str().unwrap_or("").to_string(),
    });
  }

  let body_text = resp.text().await.map_err(map_reqwest_error)?;

  Ok(HttpResponseDto {
    status,
    headers: headers_out,
    body_text,
    duration_ms,
  })
}

// helper
fn cancelled() -> HttpErrorDto {
  HttpErrorDto {
    kind: "cancelled".into(),
    message: "Request cancelled".into(),
    detail: None,
  }
}

#[tauri::command]
pub async fn send_request(
  registry: State<'_, RequestRegistry>,
  request_id: String,
  req: Request,
) -> Result<HttpResponseDto, HttpErrorDto> {
  // create token + store
  let token = CancellationToken::new();
  {
    let mut map = registry.tokens.lock().unwrap();
    map.insert(request_id.clone(), token.clone());
  }

  // Important: always cleanup (remove token) at the end
  let result = tokio::select! {
    _ = token.cancelled() => Err(cancelled()),
    res = do_send_request(req) => res, // on met ta logique HTTP existante dans do_send_request()
  };

  {
    let mut map = registry.tokens.lock().unwrap();
    map.remove(&request_id);
  }

  result
}

#[tauri::command]
pub fn cancel_request(
  registry: State<'_, RequestRegistry>,
  request_id: String,
) -> Result<(), String> {
  let map = registry.tokens.lock().unwrap();
  if let Some(token) = map.get(&request_id) {
    token.cancel();
    return Ok(());
  }
  Err("No in-flight request with this id".into())
}
