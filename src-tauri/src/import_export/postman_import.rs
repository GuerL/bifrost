use serde::Serialize;
use tauri::AppHandle;
use uuid::Uuid;

use crate::commands::collection::create_collection;
use crate::commands::environment::save_environment;
use crate::import_export::mappers::{
    flatten_request_order, map_postman_collection, MappedPostmanCollection, PostmanCollectionDto,
};
use crate::model::collection::CollectionMeta;
use crate::model::environment::Environment;
use crate::storage::paths::{collection_meta_path, request_path, write_json};

#[derive(Debug, Serialize)]
pub struct ImportPostmanResult {
    pub collection_id: String,
    pub collection_name: String,
    pub imported_requests: usize,
    pub imported_folders: usize,
    pub imported_environment_id: Option<String>,
    pub warnings: Vec<String>,
}

pub fn import_postman_collection_from_json_impl(
    app: &AppHandle,
    json_text: &str,
) -> Result<ImportPostmanResult, String> {
    let postman_collection: PostmanCollectionDto = serde_json::from_str(json_text)
        .map_err(|error| format!("Invalid Postman collection JSON: {}", error))?;

    let mapped = map_postman_collection(postman_collection);
    persist_mapped_postman_collection(app, mapped)
}

pub fn import_postman_collection_from_file_impl(
    app: &AppHandle,
    path: &str,
) -> Result<ImportPostmanResult, String> {
    let json_text = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read file '{}': {}", path, error))?;
    import_postman_collection_from_json_impl(app, &json_text)
}

fn persist_mapped_postman_collection(
    app: &AppHandle,
    mapped: MappedPostmanCollection,
) -> Result<ImportPostmanResult, String> {
    let created = create_collection(app.clone(), mapped.name.clone())?;

    for request in &mapped.requests {
        let path = request_path(app, &created.id, &request.id)?;
        write_json(&path, request)?;
    }

    let request_order = flatten_request_order(&mapped.items);
    let meta = CollectionMeta {
        version: 2,
        id: created.id.clone(),
        name: created.name.clone(),
        request_order,
        items: mapped.items,
    };

    let meta_path = collection_meta_path(app, &meta.id)?;
    write_json(&meta_path, &meta)?;

    let mut warnings = mapped.warnings;
    let mut imported_environment_id = None;
    if !mapped.variables.is_empty() {
        let environment = Environment {
            id: Uuid::new_v4().to_string(),
            name: format!("{} (Postman Variables)", meta.name),
            variables: mapped.variables,
        };

        match save_environment(app.clone(), environment.clone()) {
            Ok(_) => {
                imported_environment_id = Some(environment.id);
            }
            Err(error) => warnings.push(format!(
                "Collection imported but Postman variables environment could not be saved: {}",
                error
            )),
        }
    }

    Ok(ImportPostmanResult {
        collection_id: meta.id,
        collection_name: meta.name,
        imported_requests: mapped.request_count,
        imported_folders: mapped.folder_count,
        imported_environment_id,
        warnings,
    })
}
