// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod model;
mod storage;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
          commands::collection::list_collections,
          commands::collection::load_collection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
