mod drop_scope;
mod session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(session::SessionStore::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        // 记住窗口尺寸/位置：插件在 Resized/Moved 时更新缓存，退出时落盘，下次启动自动恢复。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            drop_scope::allow_dropped_paths,
            session::load_workspace_session,
            session::commit_workspace_session,
        ])
        .run(tauri::generate_context!())
        .expect("启动 JSON Forge 失败");
}
