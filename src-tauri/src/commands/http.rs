use crate::model::collection::*;
use crate::model::http::*;

#[tauri::command]
pub async fn send_request(req: Request) -> Result<HttpResponseDto, String> {
  let client = reqwest::Client::new();

  let mut builder = match req.method {
    HttpMethod::Get => client.get(&req.url),
    HttpMethod::Post => client.post(&req.url),
    HttpMethod::Put => client.put(&req.url),
    HttpMethod::Patch => client.patch(&req.url),
    HttpMethod::Delete => client.delete(&req.url),
    HttpMethod::Head => client.head(&req.url),
    HttpMethod::Options => client.request(reqwest::Method::OPTIONS, &req.url),
  };

  // headers
  for h in req.headers {
    if !h.key.is_empty() {
      builder = builder.header(h.key, h.value);
    }
  }

  // query params
  if !req.query.is_empty() {
    let pairs: Vec<(String, String)> = req
      .query
      .into_iter()
      .filter(|kv| !kv.key.is_empty())
      .map(|kv| (kv.key, kv.value))
      .collect();
    builder = builder.query(&pairs);
  }

  // body
  builder = match req.body {
    Body::None => builder,
    Body::Raw { content_type, text } => builder.header("Content-Type", content_type).body(text),
    Body::Json { value } => builder.json(&value),
    Body::Form { fields } => {
      let pairs: Vec<(String, String)> = fields
        .into_iter()
        .filter(|kv| !kv.key.is_empty())
        .map(|kv| (kv.key, kv.value))
        .collect();
      builder.form(&pairs)
    }
  };

  let start = std::time::Instant::now();
  let resp = builder.send().await.map_err(|e| e.to_string())?;
  let duration_ms = start.elapsed().as_millis();

  let status = resp.status().as_u16();

  let mut headers_out = vec![];
  for (k, v) in resp.headers().iter() {
    headers_out.push(KeyValue {
      key: k.to_string(),
      value: v.to_str().unwrap_or("").to_string(),
    });
  }

  let body_text = resp.text().await.map_err(|e| e.to_string())?;

  Ok(HttpResponseDto {
    status,
    headers: headers_out,
    body_text,
    duration_ms,
  })
}