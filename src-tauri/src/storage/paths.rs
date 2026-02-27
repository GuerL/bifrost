use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path().app_data_dir().map_err(|e| e.to_string())
}

pub fn collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_dir(app)?.join("collections"))
}

pub fn collection_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
  Ok(collections_dir(app)?.join(id))
}

pub fn collection_meta_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
  Ok(collection_dir(app, id)?.join("collection.json"))
}

pub fn requests_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
  Ok(collection_dir(app, id)?.join("requests"))
}

pub fn request_path(app: &AppHandle, collection_id: &str, request_id: &str) -> Result<PathBuf, String> {
  Ok(requests_dir(app, collection_id)?.join(format!("{request_id}.json")))
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
  fs::write(path, text).map_err(|e| e.to_string())
}

pub fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
  let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn delete_dir(path: &Path) -> Result<(), String> {
  if path.exists() {
    fs::remove_dir_all(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}
