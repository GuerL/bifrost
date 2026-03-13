use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::commands::collection::load_collection;
use crate::model::collection::{CollectionMeta, Request};

#[derive(Debug, Serialize)]
pub struct PortableCollectionExportDto {
    pub format: String,
    pub version: u32,
    pub exported_at_unix_ms: u128,
    pub collection: CollectionMeta,
    pub requests: Vec<Request>,
}

pub fn export_collection_portable_json_impl(
    app: &AppHandle,
    collection_id: &str,
) -> Result<String, String> {
    let loaded = load_collection(app.clone(), collection_id.to_string())?;

    let exported_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    let portable = PortableCollectionExportDto {
        format: "postguerl_portable".to_string(),
        version: 1,
        exported_at_unix_ms,
        collection: loaded.meta,
        requests: loaded.requests,
    };

    serde_json::to_string_pretty(&portable).map_err(|error| error.to_string())
}

pub fn export_collection_portable_to_file_impl(
    app: &AppHandle,
    collection_id: &str,
    path: &str,
) -> Result<(), String> {
    let json = export_collection_portable_json_impl(app, collection_id)?;
    let file = std::path::Path::new(path);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(file, json).map_err(|error| error.to_string())
}
