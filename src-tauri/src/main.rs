// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lingshu_term2_lib::{
    ai_proxy,
    commands,
    connection::ConnectionManager,
    connection_commands,
    logger,
    persistence,
    server_manager,
    session_commands,
    sftp,
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
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::new())
        .manage(ConnectionManager::new())
        .manage(server_manager::ServerManager::new())
        .manage(sftp::SftpManager::new())
        .invoke_handler(tauri::generate_handler![
            // Unified session creation (dispatches to PtyManager or ConnectionManager)
            session_commands::create_session,
            session_commands::list_local_shells,
            // PTY commands (write / resize / destroy / block)
            commands::write_to_terminal,
            commands::get_terminal_cwd,
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
            persistence::save_settings,
            persistence::load_settings,
            persistence::read_memory_file,
            persistence::write_memory_file,
            persistence::save_session_export,
            persistence::load_sessions,
            persistence::save_sessions,
            // Logger
            logger::write_log,
            logger::list_logs,
            logger::read_log_file,
            logger::open_in_explorer,
            // Server Manager
            server_manager::list_services,
            server_manager::service_status,
            server_manager::start_service,
            server_manager::stop_service,
            server_manager::update_service_config,
            server_manager::get_service_config,
            // Connection storage (encrypted)
            storage::load_connections,
            storage::save_connections,
            // SFTP file operations
            sftp::sftp_home_dir,
            sftp::sftp_list_dir,
            sftp::sftp_read_file,
            sftp::sftp_write_file,
            sftp::sftp_upload_file,
            sftp::sftp_download_file,
            sftp::sftp_delete_item,
            sftp::sftp_rename_item,
            sftp::sftp_file_properties,
            sftp::sftp_create_dir,
            sftp::sftp_create_file,
            // AI proxy (CORS bypass)
            ai_proxy::ai_proxy_request,
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
