//! SFTP file operations for SSH sessions.
//!
//! Opens an SSH channel, requests the SFTP subsystem, and wraps the
//! resulting stream in a [`russh_sftp::client::SftpSession`].

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tokio::io::AsyncWriteExt;

use crate::connection::ConnectionManager;

// ─── Types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
    /// Modification time as human-readable string.
    pub modified: String,
}

// ─── SftpManager ─────────────────────────────────────────────────

type SftpSession = russh_sftp::client::SftpSession;

pub struct SftpManager {
    /// Cached SFTP sessions keyed by connection session ID.
    sessions: std::sync::Mutex<HashMap<String, Arc<SftpSession>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Get (or create) an SFTP session for a connection.
    async fn get_or_create(
        &self,
        session_id: &str,
        conn: &ConnectionManager,
    ) -> Result<Arc<SftpSession>, String> {
        // Fast path: cached
        {
            let guard = self.sessions.lock().unwrap();
            if let Some(sftp) = guard.get(session_id) {
                return Ok(Arc::clone(sftp));
            }
        }

        let handle = conn
            .get_ssh_handle(session_id)
            .ok_or_else(|| "SSH handle not found — session may not be SSH or already disconnected".to_string())?;

        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open SFTP channel: {}", e))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("Failed to initialise SFTP session: {}", e))?;

        let sftp = Arc::new(sftp);
        let mut guard = self.sessions.lock().unwrap();
        // Check again to avoid race
        if let Some(existing) = guard.get(session_id) {
            return Ok(Arc::clone(existing));
        }
        guard.insert(session_id.to_string(), Arc::clone(&sftp));
        Ok(sftp)
    }

    /// Remove cached SFTP session on disconnect.
    pub fn evict(&self, session_id: &str) {
        self.sessions.lock().unwrap().remove(session_id);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────

fn resolve_path(base: &str, name: &str) -> String {
    let p = Path::new(base).join(name);
    p.to_string_lossy().replace('\\', "/")
}

// ─── Tauri commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_list_dir(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;

    let read_dir = sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read dir '{}': {}", path, e))?;

    let mut result: Vec<FileEntry> = Vec::new();
    for entry in read_dir {
        let name = entry.file_name();
        let metadata = entry.metadata();
        let is_dir = entry.file_type().is_dir();
        result.push(FileEntry {
            name: name.clone(),
            path: resolve_path(&path, &name),
            is_dir,
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| humantime_secs(d.as_secs()))
                .unwrap_or_default(),
        });
    }

    // Sort: directories first, then alphabetically
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(result)
}

/// Get the remote user's home directory via SFTP `realpath(".")`.
#[tauri::command]
pub async fn sftp_home_dir(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
) -> Result<String, String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;
    sftp.canonicalize(".")
        .await
        .map_err(|e| format!("Failed to get home dir: {}", e))
}

#[tauri::command]
pub async fn sftp_read_file(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;

    let bytes = sftp
        .read(&path)
        .await
        .map_err(|e| format!("Failed to read file '{}': {}", path, e))?;

    String::from_utf8(bytes).map_err(|e| format!("File is not valid UTF-8: {}", e))
}

#[tauri::command]
pub async fn sftp_write_file(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;

    sftp
        .write(&path, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
pub async fn sftp_upload_file(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let content =
        std::fs::read(&local_path).map_err(|e| format!("Failed to read local file: {}", e))?;

    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;

    // Use create() (creates + truncates) instead of write() (opens existing).
    // The file handle is auto-closed on drop.
    sftp.create(&remote_path)
        .await
        .map_err(|e| format!("Failed to create remote file '{}': {}", remote_path, e))?
        .write_all(&content)
        .await
        .map_err(|e| format!("Failed to write data to '{}': {}", remote_path, e))
}

#[tauri::command]
pub async fn sftp_download_file(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;

    let bytes = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("Failed to read remote file: {}", e))?;

    std::fs::write(&local_path, &bytes).map_err(|e| format!("Failed to write local file: {}", e))
}

/// Delete a remote file or empty directory.
#[tauri::command]
pub async fn sftp_delete_item(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;

    if is_dir {
        sftp.remove_dir(&path)
            .await
            .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))
    } else {
        sftp.remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete file '{}': {}", path, e))
    }
}

/// Rename (or move) a remote file or directory.
#[tauri::command]
pub async fn sftp_rename_item(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;
    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename '{}' → '{}': {}", old_path, new_path, e))
}

/// Get metadata for a remote file or directory.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileProperties {
    pub path: String,
    pub size: u64,
    pub modified: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "isSymlink")]
    pub is_symlink: bool,
    pub permissions: String,
}

#[tauri::command]
pub async fn sftp_file_properties(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    path: String,
) -> Result<FileProperties, String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;

    let meta = sftp
        .symlink_metadata(&path)
        .await
        .map_err(|e| format!("Failed to stat '{}': {}", path, e))?;

    let file_type = meta.file_type();
    let perms = meta.permissions();

    Ok(FileProperties {
        path,
        size: meta.len(),
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| humantime_secs(d.as_secs()))
            .unwrap_or_default(),
        is_dir: file_type.is_dir(),
        is_symlink: file_type.is_symlink(),
        permissions: format!("{}", perms),
    })
}

/// Create a new remote directory.
#[tauri::command]
pub async fn sftp_create_dir(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;
    sftp.create_dir(&path)
        .await
        .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}

/// Create an empty remote file.
#[tauri::command]
pub async fn sftp_create_file(
    sftp_mgr: State<'_, SftpManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = sftp_mgr.get_or_create(&session_id, &conn).await?;
    sftp.create(&path)
        .await
        .map_err(|e| format!("Failed to create file '{}': {}", path, e))?;
    // File is auto-closed on drop — creates an empty file.
    Ok(())
}

/// Format seconds since epoch as a compact date string.
fn humantime_secs(secs: u64) -> String {
    let d = secs / 86400;
    if d < 1 {
        return "today".to_string();
    }
    if d < 2 {
        return "yesterday".to_string();
    }
    if d < 7 {
        return format!("{}d ago", d);
    }
    if d < 365 {
        let months = d / 30;
        return format!("{}mo ago", months);
    }
    let years = d / 365;
    format!("{}y ago", years)
}
