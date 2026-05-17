use crate::connection::ConnectionManager;
use crate::shell::PtyManager;
use tauri::State;

// Note: `create_session` is no longer a Tauri command here. The unified
// entry point lives in `session_commands::create_session`, which dispatches
// local PTY creation to `PtyManager::create_session` directly.

/// Query the shell's current working directory.
/// For local PTY sessions: writes a hidden `pwd` command and captures the response.
/// For SSH sessions: writes a hidden `pwd` command and captures via output scanning.
#[tauri::command]
pub async fn get_terminal_cwd(
    pty: State<'_, PtyManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
) -> Result<String, String> {
    if session_id.starts_with("session-") {
        pty.query_cwd(&session_id).map_err(|e| e.to_string())
    } else if session_id.starts_with("ssh-") {
        conn.query_cwd(&session_id).await.map_err(|e| e.to_string())
    } else {
        Err("CWD query only supported for local PTY and SSH sessions".to_string())
    }
}

/// Write input to terminal
#[tauri::command]
pub async fn write_to_terminal(
    manager: State<'_, PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager
        .write_input(&session_id, data.as_bytes())
        .map_err(|e| e.to_string())
}

/// Resize terminal
#[tauri::command]
pub async fn resize_terminal(
    manager: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

/// Destroy a terminal session
#[tauri::command]
pub async fn destroy_session(
    manager: State<'_, PtyManager>,
    session_id: String,
) -> Result<(), String> {
    manager
        .destroy_session(&session_id)
        .map_err(|e| e.to_string())
}

/// Execute a command in block mode (wrapped with OSC 7701 markers).
/// Returns the generated command_id.
///
/// Dispatches by session_id prefix:
///   - `session-*` → [`PtyManager::execute_block_command`] (local PTY)
///   - `ssh-*`     → [`ConnectionManager::execute_block_command`] (remote SSH)
///   - otherwise   → error (Blocks not supported, e.g. Telnet / Serial)
#[tauri::command]
pub async fn execute_block_command(
    pty: State<'_, PtyManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    command: String,
) -> Result<String, String> {
    if session_id.starts_with("ssh-") {
        conn.execute_block_command(&session_id, &command)
            .map_err(|e| e.to_string())
    } else if session_id.starts_with("session-") {
        pty.execute_block_command(&session_id, &command)
            .map_err(|e| e.to_string())
    } else {
        Err(format!(
            "Blocks mode not supported for session: {}",
            session_id
        ))
    }
}
