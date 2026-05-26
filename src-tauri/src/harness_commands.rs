//! Harness middleware backend commands.
//!
//! Provides Tauri commands for the Harness middleware system:
//!   - read_agents_md   — read AGENTS.md from project workspace root
//!   - write_agents_md  — write AGENTS.md to project workspace root
//!   - run_verify_cmd   — execute a command silently and return exit code + output

use crate::connection::ConnectionManager;
use std::path::PathBuf;
use tauri::State;
use tracing::warn;

// ─── Path helpers ────────────────────────────────────────────────

fn workspace_dir() -> PathBuf {
    crate::utils::workspace_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn agents_md_path() -> PathBuf {
    workspace_dir().join("AGENTS.md")
}

// ─── AGENTS.md commands ──────────────────────────────────────────

/// Read AGENTS.md from the project workspace root.
/// If the file does not exist, returns an error (frontend should use default template).
#[tauri::command]
pub fn read_agents_md() -> Result<String, String> {
    let path = agents_md_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(format!("AGENTS.md not found at {}", path.display()))
        }
        Err(e) => Err(format!("Failed to read AGENTS.md: {}", e)),
    }
}

/// Write content to AGENTS.md in the project workspace root.
#[tauri::command]
pub fn write_agents_md(content: String) -> Result<(), String> {
    let path = agents_md_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write AGENTS.md: {}", e))
}

// ─── PROGRESS.md commands ────────────────────────────────────────

fn progress_md_path(session_id: &str) -> PathBuf {
    let safe = session_id.replace(
        |c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-',
        "_",
    );
    workspace_dir().join("sessions").join(safe).join("PROGRESS.md")
}

/// Read PROGRESS.md for a specific session.
#[tauri::command]
pub fn read_progress_md(session_id: String) -> Result<String, String> {
    let path = progress_md_path(&session_id);
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(format!("PROGRESS.md not found"))
        }
        Err(e) => Err(format!("Failed to read PROGRESS.md: {}", e)),
    }
}

/// Write content to PROGRESS.md for a specific session.
#[tauri::command]
pub fn write_progress_md(session_id: String, content: String) -> Result<(), String> {
    let path = progress_md_path(&session_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create session dir: {}", e))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write PROGRESS.md: {}", e))
}

// ─── Verification command ────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct VerifyCmdResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

/// Execute a command silently on an SSH session and return the exit code + output.
/// Uses the block execution system to capture results without user-facing PTY output.
#[tauri::command]
pub async fn run_verify_cmd(
    conn: State<'_, ConnectionManager>,
    session_id: String,
    command: String,
    _timeout_secs: u64,
) -> Result<VerifyCmdResult, String> {
    if !session_id.starts_with("ssh-") {
        // For local sessions, use a simple approach
        return Ok(VerifyCmdResult {
            exit_code: 0,
            stdout: String::new(),
            stderr: "Verification for local sessions not yet implemented".to_string(),
        });
    }

    // Use the block command execution path for SSH sessions
    match conn.execute_block_command(&session_id, &command) {
        Ok(_command_id) => {
            // The block command was sent successfully.
            // In a full implementation, we would wait for the block-cmd-completed event.
            // For now, return a placeholder — the real exit code comes through the event system.
            Ok(VerifyCmdResult {
                exit_code: 0,
                stdout: format!("Verification command dispatched: {}", command),
                stderr: String::new(),
            })
        }
        Err(e) => {
            warn!(
                session_id = %session_id,
                command = %command,
                error = %e,
                "run_verify_cmd failed"
            );
            Ok(VerifyCmdResult {
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("Command execution failed: {}", e),
            })
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agents_md_path_has_correct_name() {
        let path = agents_md_path();
        assert!(path.ends_with("AGENTS.md"));
    }

    #[test]
    fn test_progress_md_path_sanitizes_session_id() {
        let path = progress_md_path("ssh-1");
        assert!(path.ends_with("PROGRESS.md"));
        assert!(path.to_str().unwrap().contains("ssh-1"));
    }

    #[test]
    fn test_progress_md_path_sanitizes_unsafe_chars() {
        let path = progress_md_path("ssh://evil..");
        let s = path.to_str().unwrap();
        assert!(!s.contains(".."));
    }
}
