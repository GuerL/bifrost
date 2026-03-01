// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
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
          commands::http::send_request,
          commands::http::is_pending,
          commands::http::cancel_request,
          commands::collection::create_request,
          commands::collection::update_request,
          commands::collection::delete_request,
          commands::collection::list_collections,
          commands::collection::load_collection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
