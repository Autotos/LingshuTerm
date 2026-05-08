//! Session 持久化模块
//!
//! 目录布局：
//!   {HOME}/.LingShuTerm/workspace/sessions/{session_id}/
//!     ├─ meta.json      # Session 元信息（id/name/mode/createdAt/lastAccessed 等）
//!     ├─ blocks.json    # Blocks 视图数据（tasks/currentFlow）
//!     ├─ editor.json    # Editor 视图数据（files/openFiles/activeFile/theme）
//!     └─ terminal.ndjson # Terminal 日志，每行一个 JSON 记录，追加写
//!
//! 所有 IO 均为异步（tokio::fs）；写 JSON 时先写到 .tmp 再 rename 原子替换，
//! 避免进程崩溃导致文件半截损坏。
//!
//! session_id 做严格白名单校验（只允许 A-Z a-z 0-9 _ - .），防目录穿越。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tokio::fs::{self, OpenOptions};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::utils::workspace_dir;

const SESSIONS_DIR: &str = "sessions";
const META_FILE: &str = "meta.json";
const BLOCKS_FILE: &str = "blocks.json";
const EDITOR_FILE: &str = "editor.json";
const TERMINAL_FILE: &str = "terminal.ndjson";

/// 默认读取的终端日志尾部行数上限
const DEFAULT_TERMINAL_TAIL: usize = 2000;

/// ------------------------- 校验与路径 -------------------------

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() || session_id.len() > 128 {
        return Err(format!(
            "invalid session_id length: {} (must be 1..=128)",
            session_id.len()
        ));
    }
    // 白名单：字母/数字/下划线/短横/小数点
    if !session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(format!("invalid session_id: {}", session_id));
    }
    // 防御 ".." 与 "."（虽然前面校验已覆盖，但再兜一层语义）
    if session_id == "." || session_id == ".." {
        return Err("invalid session_id: reserved name".to_string());
    }
    Ok(())
}

fn app_sessions_root(_app: &AppHandle) -> Result<PathBuf, String> {
    workspace_dir().map(|d| d.join(SESSIONS_DIR))
}

fn session_dir(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    validate_session_id(session_id)?;
    Ok(app_sessions_root(app)?.join(session_id))
}

async fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .await
        .map_err(|e| format!("create_dir_all {:?} failed: {}", path, e))
}

/// 原子写 JSON：先写 .tmp 再 rename
async fn atomic_write_json(target: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        ensure_dir(parent).await?;
    }
    let tmp = target.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| format!("serialize json failed: {}", e))?;
    fs::write(&tmp, &bytes)
        .await
        .map_err(|e| format!("write {:?} failed: {}", tmp, e))?;
    fs::rename(&tmp, target)
        .await
        .map_err(|e| format!("rename {:?} -> {:?} failed: {}", tmp, target, e))?;
    Ok(())
}

async fn read_json_if_exists(path: &Path) -> Result<Option<Value>, String> {
    match fs::read(path).await {
        Ok(bytes) => {
            let v: Value = serde_json::from_slice(&bytes)
                .map_err(|e| format!("parse {:?} failed: {}", path, e))?;
            Ok(Some(v))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {:?} failed: {}", path, e)),
    }
}

/// ------------------------- Commands -------------------------

#[tauri::command]
pub async fn save_session_meta(
    app: AppHandle,
    session_id: String,
    meta: Value,
) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    ensure_dir(&dir).await?;
    atomic_write_json(&dir.join(META_FILE), &meta).await
}

#[tauri::command]
pub async fn save_session_blocks(
    app: AppHandle,
    session_id: String,
    blocks: Value,
) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    ensure_dir(&dir).await?;
    atomic_write_json(&dir.join(BLOCKS_FILE), &blocks).await
}

#[tauri::command]
pub async fn save_session_editor(
    app: AppHandle,
    session_id: String,
    editor: Value,
) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    ensure_dir(&dir).await?;
    atomic_write_json(&dir.join(EDITOR_FILE), &editor).await
}

/// 追加一行到 terminal.ndjson。
/// `entry` 预期已是前端序列化后的单行 JSON 字符串（或纯文本），
/// 本函数会自动去掉末尾的换行再补一个 `\n`。
#[tauri::command]
pub async fn append_terminal_log(
    app: AppHandle,
    session_id: String,
    entry: String,
) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    ensure_dir(&dir).await?;
    let path = dir.join(TERMINAL_FILE);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| format!("open {:?} failed: {}", path, e))?;

    let mut line = entry.trim_end_matches(['\r', '\n']).to_string();
    line.push('\n');
    file.write_all(line.as_bytes())
        .await
        .map_err(|e| format!("append to {:?} failed: {}", path, e))?;
    Ok(())
}

/// 批量追加多条日志，单次 open+write+close，减少 IO 开销。
/// `entries` 中每条已是单行文本（JSON 字符串或纯文本），本函数负责拼进换行。
#[tauri::command]
pub async fn append_terminal_batch(
    app: AppHandle,
    session_id: String,
    entries: Vec<String>,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let dir = session_dir(&app, &session_id)?;
    ensure_dir(&dir).await?;
    let path = dir.join(TERMINAL_FILE);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| format!("open {:?} failed: {}", path, e))?;

    // 拼接到一个 buffer 一次性写入
    let mut buf = String::with_capacity(
        entries.iter().map(|e| e.len() + 1).sum(),
    );
    for entry in entries {
        let s = entry.trim_end_matches(['\r', '\n']);
        buf.push_str(s);
        buf.push('\n');
    }
    file.write_all(buf.as_bytes())
        .await
        .map_err(|e| format!("append_batch to {:?} failed: {}", path, e))?;
    Ok(())
}

/// 读取 terminal.ndjson 的尾部若干行
async fn read_terminal_tail(path: &Path, limit: usize) -> Result<Vec<String>, String> {
    let file = match fs::File::open(path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("open {:?} failed: {}", path, e)),
    };
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    // 使用环形缓冲保留最后 N 行
    let mut buf: std::collections::VecDeque<String> = std::collections::VecDeque::with_capacity(limit);
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("read line from {:?} failed: {}", path, e))?
    {
        if buf.len() == limit {
            buf.pop_front();
        }
        buf.push_back(line);
    }
    Ok(buf.into_iter().collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub meta: Option<Value>,
    pub blocks: Option<Value>,
    pub editor: Option<Value>,
    pub terminal_tail: Vec<String>,
}

#[tauri::command]
pub async fn load_session(
    app: AppHandle,
    session_id: String,
    tail_limit: Option<usize>,
) -> Result<SessionSnapshot, String> {
    let dir = session_dir(&app, &session_id)?;
    if !fs::try_exists(&dir).await.unwrap_or(false) {
        return Ok(SessionSnapshot {
            session_id,
            meta: None,
            blocks: None,
            editor: None,
            terminal_tail: Vec::new(),
        });
    }

    let meta = read_json_if_exists(&dir.join(META_FILE)).await?;
    let blocks = read_json_if_exists(&dir.join(BLOCKS_FILE)).await?;
    let editor = read_json_if_exists(&dir.join(EDITOR_FILE)).await?;
    let terminal_tail = read_terminal_tail(
        &dir.join(TERMINAL_FILE),
        tail_limit.unwrap_or(DEFAULT_TERMINAL_TAIL),
    )
    .await?;

    Ok(SessionSnapshot {
        session_id,
        meta,
        blocks,
        editor,
        terminal_tail,
    })
}

#[tauri::command]
pub async fn list_sessions(app: AppHandle) -> Result<Vec<String>, String> {
    let root = app_sessions_root(&app)?;
    if !fs::try_exists(&root).await.unwrap_or(false) {
        return Ok(Vec::new());
    }
    let mut rd = fs::read_dir(&root)
        .await
        .map_err(|e| format!("read_dir {:?} failed: {}", root, e))?;
    let mut ids = Vec::new();
    while let Some(entry) = rd
        .next_entry()
        .await
        .map_err(|e| format!("iterate {:?} failed: {}", root, e))?
    {
        let file_type = match entry.file_type().await {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            if validate_session_id(name).is_ok() {
                ids.push(name.to_string());
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
pub async fn clear_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    match fs::remove_dir_all(&dir).await {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove_dir_all {:?} failed: {}", dir, e)),
    }
}
