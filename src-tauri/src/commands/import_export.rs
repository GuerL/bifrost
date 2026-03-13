use tauri::AppHandle;

use crate::import_export::portable_export::{
    export_collection_portable_json_impl, export_collection_portable_to_file_impl,
    import_collection_portable_from_file_impl, import_collection_portable_from_json_impl,
    ImportPortableResult,
};
use crate::import_export::postman_export::{
    export_collection_postman_json_impl, export_collection_postman_to_file_impl,
};
use crate::import_export::postman_import::{
    import_postman_collection_from_file_impl, import_postman_collection_from_json_impl,
    ImportPostmanResult,
};

#[tauri::command]
pub fn import_postman_collection_from_file(
    app: AppHandle,
    path: String,
) -> Result<ImportPostmanResult, String> {
    import_postman_collection_from_file_impl(&app, &path)
}

#[tauri::command]
pub fn import_postman_collection_from_json(
    app: AppHandle,
    json_text: String,
) -> Result<ImportPostmanResult, String> {
    import_postman_collection_from_json_impl(&app, &json_text)
}

#[tauri::command]
pub fn export_collection_portable(app: AppHandle, collection_id: String) -> Result<String, String> {
    export_collection_portable_json_impl(&app, &collection_id)
}

#[tauri::command]
pub fn export_collection_portable_to_file(
    app: AppHandle,
    collection_id: String,
    path: String,
) -> Result<(), String> {
    export_collection_portable_to_file_impl(&app, &collection_id, &path)
}

#[tauri::command]
pub fn import_collection_portable_from_file(
    app: AppHandle,
    path: String,
) -> Result<ImportPortableResult, String> {
    import_collection_portable_from_file_impl(&app, &path)
}

#[tauri::command]
pub fn import_collection_portable_from_json(
    app: AppHandle,
    json_text: String,
) -> Result<ImportPortableResult, String> {
    import_collection_portable_from_json_impl(&app, &json_text)
}

#[tauri::command]
pub fn export_collection_to_postman(
    app: AppHandle,
    collection_id: String,
) -> Result<String, String> {
    export_collection_postman_json_impl(&app, &collection_id)
}

#[tauri::command]
pub fn export_collection_to_postman_file(
    app: AppHandle,
    collection_id: String,
    path: String,
) -> Result<(), String> {
    export_collection_postman_to_file_impl(&app, &collection_id, &path)
}
