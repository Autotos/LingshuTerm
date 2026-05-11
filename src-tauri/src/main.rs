// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lingshu_term2_lib::{
    commands,
    connection::ConnectionManager,
    connection_commands,
    persistence,
    session_commands,
    shell::PtyManager,
    storage,
    utils,
};
use tauri::Manager;

fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!("Starting LingshuTerm 2.0...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(PtyManager::new())
        .manage(ConnectionManager::new())
        .invoke_handler(tauri::generate_handler![
            // Unified session creation (dispatches to PtyManager or ConnectionManager)
            session_commands::create_session,
            session_commands::list_local_shells,
            // PTY commands (write / resize / destroy / block)
            commands::write_to_terminal,
            commands::resize_terminal,
            commands::destroy_session,
            commands::execute_block_command,
            // Connection commands (disconnect / write / resize / list_serial_ports)
            connection_commands::disconnect,
            connection_commands::write_to_connection,
            connection_commands::resize_connection,
            connection_commands::list_serial_ports,
            // Session persistence commands
            persistence::save_session_meta,
            persistence::save_session_blocks,
            persistence::save_session_editor,
            persistence::append_terminal_log,
            persistence::append_terminal_batch,
            persistence::append_timeline_batch,
            persistence::load_session,
            persistence::list_sessions,
            persistence::clear_session,
            persistence::save_session_export,
            persistence::load_sessions,
            persistence::save_sessions,
            // Connection storage (encrypted)
            storage::load_connections,
            storage::save_connections,
        ])
        .setup(|app| {
            // 确保工作空间存在
            if let Err(e) = utils::ensure_workspace() {
                tracing::error!("failed to ensure workspace: {}", e);
            }

            let pty_manager = app.state::<PtyManager>();
            pty_manager.set_app_handle(app.handle().clone());

            let conn_manager = app.state::<ConnectionManager>();
            conn_manager.set_app_handle(app.handle().clone());

            tracing::info!("LingshuTerm 2.0 initialized successfully");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LingshuTerm 2.0");
}
