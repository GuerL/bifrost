use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::open_path;

#[tauri::command]
pub fn open_app_data_dir(app: AppHandle) -> Result<(), String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

  // ouvre dans Finder (ou explorer sous Windows)
  open_path(dir, None::<String>).map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub fn app_data_dir(app: AppHandle) -> Result<String, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
  let p = Path::new(&path);
  if let Some(parent) = p.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| e.to_string())
}