//! Unified session creation entry point.
//!
//! The frontend used to call `create_session` (local PTY) and `connect`
//! (remote SSH/Telnet/Serial) as two separate commands. This module merges
//! them behind a single `create_session(config)` dispatcher so the UI only
//! has one code path for "New Session".
//!
//! * `ConnectionConfig::Local` is routed to [`PtyManager::create_session`].
//! * All other variants are routed to [`ConnectionManager::connect`].
//!
//! It also exposes `list_local_shells` which probes the current OS for
//! sensible local shell candidates — the Local panel of `SessionTypeModal`
//! uses this to populate its dropdown.

use crate::connection::{ConnectionConfig, ConnectionManager};
use crate::shell::PtyManager;
use serde::Serialize;
use tauri::State;

/// Descriptor for a single local shell option surfaced to the UI.
/// Matches the TypeScript `LocalShellOption` interface.
#[derive(Debug, Clone, Serialize)]
pub struct LocalShellOption {
    pub kind: String,
    pub label: String,
    pub path: String,
}

/// Unified session creation command.
///
/// Returns the session ID on success. The ID prefix (`session-*` vs
/// `ssh-*` / `telnet-*` / `serial-*`) drives downstream write/resize
/// dispatch in `sessionUtils.getWriteCommand`.
#[tauri::command]
pub async fn create_session(
    pty: State<'_, PtyManager>,
    conn: State<'_, ConnectionManager>,
    config: ConnectionConfig,
) -> Result<String, String> {
    match config {
        ConnectionConfig::Local { shell, cwd } => {
            let shell_opt = if shell.is_empty() { None } else { Some(shell) };
            pty.create_session(shell_opt, cwd).map_err(|e| e.to_string())
        }
        other => conn.connect(other).await.map_err(|e| e.to_string()),
    }
}

/// Query remote server statistics (CPU / memory / disk / users / network)
/// for an active SSH session.  Only works for `ssh-*` prefixed session IDs.
#[tauri::command]
pub async fn query_server_stats(
    conn: State<'_, ConnectionManager>,
    session_id: String,
) -> Result<String, String> {
    if !session_id.starts_with("ssh-") {
        return Err("Server stats only available for SSH sessions".to_string());
    }
    conn.query_server_stats(&session_id).await.map_err(|e| e.to_string())
}

/// Enumerate local shells available on the current OS.
#[tauri::command]
pub async fn list_local_shells() -> Result<Vec<LocalShellOption>, String> {
    Ok(detect_local_shells())
}

#[cfg(target_os = "windows")]
fn detect_local_shells() -> Vec<LocalShellOption> {
    let mut out = Vec::new();

    // cmd.exe — always available on Windows
    let cmd_path = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
    out.push(LocalShellOption {
        kind: "cmd".to_string(),
        label: "Command Prompt (cmd)".to_string(),
        path: cmd_path,
    });

    // Windows PowerShell — always present on modern Windows
    let ps_path = std::env::var("SystemRoot")
        .map(|root| format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", root))
        .unwrap_or_else(|_| "powershell.exe".to_string());
    out.push(LocalShellOption {
        kind: "powershell".to_string(),
        label: "PowerShell".to_string(),
        path: ps_path,
    });

    out
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn detect_local_shells() -> Vec<LocalShellOption> {
    let mut out = Vec::new();

    let bash_candidates = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"];
    if let Some(path) = first_existing(&bash_candidates) {
        out.push(LocalShellOption {
            kind: "bash".to_string(),
            label: "Bash".to_string(),
            path,
        });
    }

    let zsh_candidates = ["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"];
    if let Some(path) = first_existing(&zsh_candidates) {
        out.push(LocalShellOption {
            kind: "zsh".to_string(),
            label: "Zsh".to_string(),
            path,
        });
    }

    // Guarantee at least one option for UI sanity.
    if out.is_empty() {
        out.push(LocalShellOption {
            kind: "bash".to_string(),
            label: "Bash".to_string(),
            path: "/bin/sh".to_string(),
        });
    }

    out
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn detect_local_shells() -> Vec<LocalShellOption> {
    vec![LocalShellOption {
        kind: "bash".to_string(),
        label: "Shell".to_string(),
        path: "/bin/sh".to_string(),
    }]
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn first_existing(candidates: &[&str]) -> Option<String> {
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return Some((*c).to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_local_shells_returns_nonempty() {
        let shells = detect_local_shells();
        assert!(!shells.is_empty(), "expected at least one local shell");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_exposes_cmd_and_powershell() {
        let shells = detect_local_shells();
        assert!(shells.iter().any(|s| s.kind == "cmd"));
        assert!(shells.iter().any(|s| s.kind == "powershell"));
    }
}
