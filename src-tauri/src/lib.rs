// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod import_export;
mod model;
mod storage;
use commands::state::RequestRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RequestRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::collection::greet,
            commands::fs::app_data_dir,
            commands::fs::open_app_data_dir,
            commands::fs::write_text_file,
            commands::fs::read_text_file,
            commands::collection::init_default_collection,
            commands::collection::overwrite_default,
            commands::environment::init_default_environment,
            commands::environment::list_environments,
            commands::environment::load_environment,
            commands::environment::create_environment,
            commands::environment::duplicate_environment,
            commands::environment::save_environment,
            commands::environment::delete_environment,
            commands::environment::get_active_environment,
            commands::environment::set_active_environment,
            commands::environment::open_environments_dir,
            commands::http::send_request,
            commands::http::is_pending,
            commands::http::cancel_request,
            commands::collection::create_folder,
            commands::collection::rename_folder,
            commands::collection::delete_folder,
            commands::collection::move_node,
            commands::collection::create_request,
            commands::collection::update_request,
            commands::collection::delete_request,
            commands::collection::rename_request,
            commands::collection::reorder_requests,
            commands::collection::list_collections,
            commands::collection::create_collection,
            commands::collection::rename_collection,
            commands::collection::delete_collection,
            commands::collection::load_collection,
            commands::collection::get_active_collection,
            commands::collection::set_active_collection,
            commands::collection::load_drafts,
            commands::collection::save_drafts,
            commands::collection::clear_draft,
            commands::collection::duplicate_request,
            commands::import_export::import_postman_collection_from_file,
            commands::import_export::import_postman_collection_from_json,
            commands::import_export::export_collection_portable,
            commands::import_export::export_collection_portable_to_file,
            commands::import_export::export_collection_to_postman,
            commands::import_export::export_collection_to_postman_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
