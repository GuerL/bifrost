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
    request_order: vec!["ping".into(), "ping-second".into(), "invalid-http".into(), "timeout-http".into()],
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

  let invalid_htp_request = Request {
    id: "invalid-http".into(),
    name: "Invalid HTTP method".into(),
    method: HttpMethod::Get,
    url: "htp://postman-echo.com/get".into(),
    headers: vec![],
    query: vec![],
    body: Body::None,
  };

  let timeout_http_request = Request {
      id: "timeout-http".into(),
      name: "Request with timeout".into(),
      method: HttpMethod::Get,
      url: "http://10.255.255.1".into(),
      headers: vec![],
      query: vec![],
      body: Body::None,
  };

  let meta_path = collection_meta_path(&app, "default")?;
  let ping_path = request_path(&app, "default", "ping")?;
  let ping_second_path = request_path(&app, "default", "ping-second")?;
  let invalid_http_path = request_path(&app, "default", "invalid-http")?;
  let timeout_http_path = request_path(&app, "default", "timeout-http")?;

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

  if !invalid_http_path.exists(){
    write_json(&invalid_http_path, &invalid_htp_request)?;
  }

  if !timeout_http_path.exists() {
    write_json(&timeout_http_path, &timeout_http_request)?;
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
pub fn create_request(app: AppHandle, collection_id: String, request: Request) -> Result<(), String> {
  if request.id.trim().is_empty() {
    return Err("Request id is empty".into());
  }

  let meta_path = collection_meta_path(&app, &collection_id)?;
  if !meta_path.exists() {
    return Err(format!("Collection not found: {}", collection_id));
  }

  let mut meta = read_json::<CollectionMeta>(&meta_path)?;

  let req_path = request_path(&app, &collection_id, &request.id)?;
  if req_path.exists() {
    return Err(format!("Request already exists: {}", request.id));
  }

  // write request file
  write_json(&req_path, &request)?;

  // update order
  if !meta.request_order.iter().any(|x| x == &request.id) {
    meta.request_order.push(request.id.clone());
    write_json(&meta_path, &meta)?;
  }

  Ok(())
}

#[tauri::command]
pub fn update_request(app: AppHandle, collection_id: String, request: Request) -> Result<(), String> {
  if request.id.trim().is_empty() {
    return Err("Request id is empty".into());
  }

  let meta_path = collection_meta_path(&app, &collection_id)?;
  if !meta_path.exists() {
    return Err(format!("Collection not found: {}", collection_id));
  }

  let mut meta = read_json::<CollectionMeta>(&meta_path)?;

  let req_path = request_path(&app, &collection_id, &request.id)?;

  // write request (overwrite)
  write_json(&req_path, &request)?;

  // ensure order contains it
  if !meta.request_order.iter().any(|x| x == &request.id) {
    meta.request_order.push(request.id.clone());
    write_json(&meta_path, &meta)?;
  }

  Ok(())
}

#[tauri::command]
pub fn delete_request(app: AppHandle, collection_id: String, request_id: String) -> Result<(), String> {
  if request_id.trim().is_empty() {
    return Err("Request id is empty".into());
  }

  let meta_path = collection_meta_path(&app, &collection_id)?;
  if !meta_path.exists() {
    return Err(format!("Collection not found: {}", collection_id));
  }

  let mut meta = read_json::<CollectionMeta>(&meta_path)?;

  let req_path = request_path(&app, &collection_id, &request_id)?;
  if req_path.exists() {
    std::fs::remove_file(&req_path).map_err(|e| e.to_string())?;
  }

  // remove from order
  meta.request_order.retain(|x| x != &request_id);
  write_json(&meta_path, &meta)?;

  Ok(())
}

#[tauri::command]
pub fn rename_request(
  app: AppHandle,
  collection_id: String,
  request_id: String,
  new_name: String,
) -> Result<(), String> {
  if request_id.trim().is_empty() {
    return Err("Request id is empty".into());
  }

  let new_name = new_name.trim().to_string();
  if new_name.is_empty() {
    return Err("New request name is empty".into());
  }

  let meta_path = collection_meta_path(&app, &collection_id)?;
  if !meta_path.exists() {
    return Err(format!("Collection not found: {}", collection_id));
  }

  let source_path = request_path(&app, &collection_id, &request_id)?;
  if !source_path.exists() {
    return Err(format!("Request not found: {}", request_id));
  }

  let mut req = read_json::<Request>(&source_path)?;
  req.id = request_id;
  req.name = new_name;

  write_json(&source_path, &req)?;

  Ok(())
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub fn load_drafts(
  app: AppHandle,
  collection_id: String,
) -> Result<std::collections::HashMap<String, Request>, String> {
  let path = draft_collection_path(&app, &collection_id)?;
  if !path.exists() {
    return Ok(std::collections::HashMap::new());
  }

  read_json(&path)
}

#[tauri::command]
pub fn save_drafts(
  app: AppHandle,
  collection_id: String,
  drafts: std::collections::HashMap<String, Request>,
) -> Result<(), String> {
  let path = draft_collection_path(&app, &collection_id)?;
  write_json(&path, &drafts)
}

#[tauri::command]
pub fn clear_draft(
  app: AppHandle,
  collection_id: String,
  request_id: String,
) -> Result<(), String> {
  let path = draft_collection_path(&app, &collection_id)?;
  let mut drafts: std::collections::HashMap<String, Request> =
    if path.exists() { read_json(&path)? } else { std::collections::HashMap::new() };

  drafts.remove(&request_id);
  write_json(&path, &drafts)
}


#[tauri::command]
pub fn duplicate_request(
  app: tauri::AppHandle,
  collection_id: String,
  source_request_id: String,
  new_request_id: String,
  new_name: Option<String>,
) -> Result<(), String> {
  if source_request_id.trim().is_empty() {
    return Err("Source request id is empty".into());
  }

  if new_request_id.trim().is_empty() {
    return Err("New request id is empty".into());
  }

  if source_request_id == new_request_id {
    return Err("New request id must be different from source request id".into());
  }

  let meta_path = collection_meta_path(&app, &collection_id)?;
  if !meta_path.exists() {
    return Err(format!("Collection not found: {}", collection_id));
  }

  let mut meta = read_json::<CollectionMeta>(&meta_path)?;

  let source_path = request_path(&app, &collection_id, &source_request_id)?;
  if !source_path.exists() {
    return Err(format!("Source request not found: {}", source_request_id));
  }

  let target_path = request_path(&app, &collection_id, &new_request_id)?;
  if target_path.exists() {
    return Err(format!("Target request already exists: {}", new_request_id));
  }

  let mut duplicated = read_json::<Request>(&source_path)?;
  duplicated.id = new_request_id.clone();

  duplicated.name = match new_name {
    Some(name) if !name.trim().is_empty() => name,
    _ => format!("{} Copy", duplicated.name),
  };

  write_json(&target_path, &duplicated)?;

  if !meta.request_order.iter().any(|x| x == &new_request_id) {
    if let Some(pos) = meta.request_order.iter().position(|x| x == &source_request_id) {
      meta.request_order.insert(pos + 1, new_request_id);
    } else {
      meta.request_order.push(new_request_id);
    }
    write_json(&meta_path, &meta)?;
  }

  Ok(())
}
