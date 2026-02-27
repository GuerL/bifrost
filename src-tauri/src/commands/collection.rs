use std::fs;
use tauri::{AppHandle};

use crate::model::collection::*;
use crate::storage::paths::*;
use crate::storage::paths::{read_json, write_json, delete_dir};

#[tauri::command]
pub fn init_default_collection(app: AppHandle) -> Result<(), String> {
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
    url: "https://postman-echo0.com/get".into(),
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
pub fn overwrite_default(app: AppHandle) -> Result<(), String> {
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
pub fn list_collections(app: AppHandle) -> Result<Vec<CollectionMeta>, String> {
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
pub fn load_collection(app: AppHandle, id: String) -> Result<CollectionLoaded, String> {
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
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}


