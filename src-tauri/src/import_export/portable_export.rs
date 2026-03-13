use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::commands::collection::create_collection;
use crate::commands::collection::load_collection;
use crate::model::collection::{CollectionMeta, CollectionNode, Request};
use crate::storage::paths::{collection_meta_path, request_path, write_json};

#[derive(Debug, Serialize)]
pub struct PortableCollectionExportDto {
    pub format: String,
    pub version: u32,
    pub exported_at_unix_ms: u128,
    pub collection: CollectionMeta,
    pub requests: Vec<Request>,
}

#[derive(Debug, Deserialize)]
pub struct PortableCollectionImportDto {
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub version: u32,
    pub collection: CollectionMeta,
    #[serde(default)]
    pub requests: Vec<Request>,
}

#[derive(Debug, Serialize)]
pub struct ImportPortableResult {
    pub collection_id: String,
    pub collection_name: String,
    pub imported_requests: usize,
    pub warnings: Vec<String>,
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

pub fn import_collection_portable_from_json_impl(
    app: &AppHandle,
    json_text: &str,
) -> Result<ImportPortableResult, String> {
    let imported: PortableCollectionImportDto = serde_json::from_str(json_text)
        .map_err(|error| format!("Invalid portable JSON: {}", error))?;

    let mut warnings = vec![];
    if imported.format.trim() != "postguerl_portable" {
        return Err("Invalid portable file format. Expected 'postguerl_portable'.".to_string());
    }
    if imported.version != 1 {
        warnings.push(format!(
            "Portable format version {} is not the current version (1). Import continued.",
            imported.version
        ));
    }

    let collection_name = imported.collection.name.trim();
    let created = create_collection(
        app.clone(),
        if collection_name.is_empty() {
            "Imported Collection".to_string()
        } else {
            collection_name.to_string()
        },
    )?;

    let mut request_ids_from_files = HashSet::new();
    for request in &imported.requests {
        if request.id.trim().is_empty() {
            return Err("Portable file contains a request with an empty id.".to_string());
        }
        if !request_ids_from_files.insert(request.id.clone()) {
            return Err(format!(
                "Portable file contains duplicate request id '{}'.",
                request.id
            ));
        }

        let req_path = request_path(app, &created.id, &request.id)?;
        write_json(&req_path, request)?;
    }

    let mut meta_items = if imported.collection.items.is_empty() {
        imported
            .collection
            .request_order
            .iter()
            .map(|request_id| CollectionNode::RequestRef {
                request_id: request_id.clone(),
            })
            .collect::<Vec<_>>()
    } else {
        imported.collection.items
    };

    let mut request_order = flatten_request_order(&meta_items);

    for request_id in &request_order {
        if !request_ids_from_files.contains(request_id) {
            return Err(format!(
                "Portable file references request '{}' in tree/order but request payload is missing.",
                request_id
            ));
        }
    }

    let request_ids_in_tree = request_order.iter().cloned().collect::<HashSet<_>>();
    for request in &imported.requests {
        if request_ids_in_tree.contains(&request.id) {
            continue;
        }
        meta_items.push(CollectionNode::RequestRef {
            request_id: request.id.clone(),
        });
        warnings.push(format!(
            "Request '{}' was not referenced in tree and was appended at root.",
            request.id
        ));
    }

    request_order = flatten_request_order(&meta_items);
    let meta = CollectionMeta {
        version: 2,
        id: created.id.clone(),
        name: created.name.clone(),
        request_order,
        items: meta_items,
    };

    let meta_path = collection_meta_path(app, &meta.id)?;
    write_json(&meta_path, &meta)?;

    Ok(ImportPortableResult {
        collection_id: meta.id,
        collection_name: meta.name,
        imported_requests: imported.requests.len(),
        warnings,
    })
}

pub fn import_collection_portable_from_file_impl(
    app: &AppHandle,
    path: &str,
) -> Result<ImportPortableResult, String> {
    let json_text = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read file '{}': {}", path, error))?;
    import_collection_portable_from_json_impl(app, &json_text)
}

fn flatten_request_order(items: &[CollectionNode]) -> Vec<String> {
    let mut out = vec![];
    flatten_request_order_recursive(items, &mut out);
    out
}

fn flatten_request_order_recursive(items: &[CollectionNode], out: &mut Vec<String>) {
    for item in items {
        match item {
            CollectionNode::RequestRef { request_id } => out.push(request_id.clone()),
            CollectionNode::Folder { children, .. } => {
                flatten_request_order_recursive(children, out)
            }
        }
    }
}
