// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::open_path;

#[derive(Debug, Serialize, Deserialize)]
struct KeyValue {
  key: String,
  value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum HttpMethod {
  Get, Post, Put, Patch, Delete, Head, Options,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Body {
  None,
  Raw { content_type: String, text: String },
  Json { value: serde_json::Value },
  Form { fields: Vec<KeyValue> },
}

#[derive(Debug, Serialize, Deserialize)]
struct Request {
  id: String,
  name: String,
  method: HttpMethod,
  url: String,
  headers: Vec<KeyValue>,
  query: Vec<KeyValue>,
  body: Body,
}

#[derive(Debug, Serialize, Deserialize)]
struct HttpResponseDto {
  status: u16,
  headers: Vec<KeyValue>,
  body_text: String,
  duration_ms: u128,
}


#[derive(Debug, Serialize, Deserialize)]
struct CollectionMeta {
  version: u32,
  id: String,
  name: String,
  #[serde(default)]
  request_order: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CollectionLoaded {
  meta: CollectionMeta,
  requests: Vec<Request>,
}
fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path().app_data_dir().map_err(|e| e.to_string())
}

fn collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_dir(app)?.join("collections"))
}

fn collection_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
  Ok(collections_dir(app)?.join(id))
}

fn collection_meta_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
  Ok(collection_dir(app, id)?.join("collection.json"))
}

fn requests_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
  Ok(collection_dir(app, id)?.join("requests"))
}

fn request_path(app: &AppHandle, collection_id: &str, request_id: &str) -> Result<PathBuf, String> {
  Ok(requests_dir(app, collection_id)?.join(format!("{request_id}.json")))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
  fs::write(path, text).map_err(|e| e.to_string())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
  let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn delete_dir(path: &Path) -> Result<(), String> {
  if path.exists() {
    fs::remove_dir_all(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}


#[tauri::command]
fn init_default_collection(app: AppHandle) -> Result<(), String> {
  let meta = CollectionMeta {
    version: 1,
    id: "default".into(),
    name: "Default".into(),
    request_order: vec!["ping".into(), "ping-second".into()],
  };

  let ping = Request {
    id: "ping".into(),
    name: "Ping (GET)".into(),
    method: HttpMethod::Get,
    url: "https://postman-echo.com/get".into(),
    headers: vec![],
    query: vec![],
    body: Body::None,
  };

  let ping_second = Request {
    id: "ping-second".into(),
    name: "Ping (POST)".into(),
    method: HttpMethod::Post,
    url: "https://postman-echo.com/post".into(),
    headers: vec![],
    query: vec![],
    body: Body::Json { value: serde_json::json!({"hello": "world"}) },
  };

  let meta_path = collection_meta_path(&app, "default")?;
  let ping_path = request_path(&app, "default", "ping")?;
  let ping_second_path = request_path(&app, "default", "ping-second")?;

  // N'écrase pas si déjà existant
  if !meta_path.exists() {
    write_json(&meta_path, &meta)?;
  }
  if !ping_path.exists() {
    write_json(&ping_path, &ping)?;
  }

  if !ping_second_path.exists() {
    write_json(&ping_second_path, &ping_second)?;
  }

  Ok(())
}

#[tauri::command]
fn overwrite_default(app: AppHandle) -> Result<(), String> {
    // Removes the default collection (for testing purposes)
  let meta_path = collection_meta_path(&app, "default")?;
    if meta_path.exists() {
        let dir = collection_dir(&app, "default")?;
        delete_dir(&dir)?;
    }
    init_default_collection(app)?;
    Ok(())

}

#[tauri::command]
fn list_collections(app: AppHandle) -> Result<Vec<CollectionMeta>, String> {
  let dir = collections_dir(&app)?;
  if !dir.exists() {
    return Ok(vec![]);
  }

  let mut out = vec![];
  for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
      continue;
    }
    let id = entry.file_name().to_string_lossy().to_string();
    let meta_path = collection_meta_path(&app, &id)?;
    if meta_path.exists() {
      if let Ok(meta) = read_json::<CollectionMeta>(&meta_path) {
        out.push(meta);
      }
    }
  }

  Ok(out)
}

#[tauri::command]
fn load_collection(app: AppHandle, id: String) -> Result<CollectionLoaded, String> {
  let meta_path = collection_meta_path(&app, &id)?;
  let meta = read_json::<CollectionMeta>(&meta_path)?;

  let mut requests = vec![];
  for req_id in &meta.request_order {
    let p = request_path(&app, &id, req_id)?;
    if p.exists() {
      let r = read_json::<Request>(&p)?;
      requests.push(r);
    }
  }

  Ok(CollectionLoaded { meta, requests })
}

#[tauri::command]
fn open_app_data_dir(app: AppHandle) -> Result<(), String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

  // ouvre dans Finder (ou explorer sous Windows)
  open_path(dir, None::<String>).map_err(|e| e.to_string())?;

  Ok(())
}


#[tauri::command]
fn ensure_parent_dir(path: String) -> Result<(), String> {
  let p = Path::new(&path);
  let parent = p
    .parent()
    .ok_or_else(|| "Path has no parent".to_string())?;

  std::fs::create_dir_all(parent).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_data_dir(app: AppHandle) -> Result<String, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
  let p = Path::new(&path);
  if let Some(parent) = p.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn send_request(req: Request) -> Result<HttpResponseDto, String> {
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


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
          greet,
          app_data_dir,
          open_app_data_dir,
          write_text_file,
          read_text_file,
          init_default_collection,
          overwrite_default,
          send_request,
          list_collections,
          load_collection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
