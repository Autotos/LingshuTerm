//! 连接配置与分组持久化（加密存储）。
//!
//! 文件位置：`{HOME}/.LingShuTerm/workspace/connections.json`
//!
//! 存储格式：
//! ```json
//! { "connections": [...], "groups": ["GroupA", "GroupB"] }
//! ```
//! 旧格式（纯数组）自动迁移为新格式。
//!
//! 密码字段使用 AES-256-GCM（via ring）加密：
//!   - 密钥：首次运行时随机生成并保存在 `{workspace}/.key`
//!   - Nonce：每次加密随机生成 96-bit nonce，前置到密文
//!   - 密文格式：`base64(nonce || ciphertext)`
//!
//! 所有序列化使用 camelCase，与前端 TypeScript 类型对齐。

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::utils::workspace_dir;

static KEY_CACHE: OnceLock<Mutex<Option<LessSafeKey>>> = OnceLock::new();

const KEY_FILE: &str = ".key";
const CONNECTIONS_FILE: &str = "connections.json";
const NONCE_LEN: usize = 12; // 96-bit for AES-GCM

// ─── Frontend 可序列化的连接条目 ──────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnectionEntry {
    pub id: String,
    pub name: String,
    pub config: Value,       // 加密后的 config（password 字段为密文）
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastUsedAt", skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
}

// ─── Key management ─────────────────────────────────────────

fn key_path() -> Result<PathBuf, String> {
    workspace_dir().map(|d| d.join(KEY_FILE))
}

fn load_or_create_key() -> Result<LessSafeKey, String> {
    let path = key_path()?;

    if path.exists() {
        let bytes =
            std::fs::read(&path).map_err(|e| format!("read key file: {}", e))?;
        let unbound = UnboundKey::new(&AES_256_GCM, &bytes)
            .map_err(|_| "invalid key material".to_string())?;
        return Ok(LessSafeKey::new(unbound));
    }

    // 首次运行：生成 256-bit 随机密钥并持久化
    let rng = SystemRandom::new();
    let mut key_bytes = [0u8; 32]; // AES-256 = 32 bytes
    rng.fill(&mut key_bytes)
        .map_err(|_| "failed to generate random key".to_string())?;

    std::fs::write(&path, &key_bytes)
        .map_err(|e| format!("write key file: {}", e))?;

    let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| "invalid key material".to_string())?;
    Ok(LessSafeKey::new(unbound))
}

fn get_key() -> Result<LessSafeKey, String> {
    let cache = KEY_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap();
    if let Some(ref key) = *guard {
        // ring 0.17 LessSafeKey implements Clone
        return Ok(key.clone());
    }
    let key = load_or_create_key()?;
    *guard = Some(key.clone());
    Ok(key)
}

// ─── Encrypt / Decrypt ──────────────────────────────────────

fn encrypt_plaintext(plain: &str) -> Result<String, String> {
    let key = get_key()?;
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "failed to generate nonce".to_string())?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = plain.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "encryption failed".to_string())?;

    // 前置 nonce
    let mut payload = nonce_bytes.to_vec();
    payload.append(&mut in_out);

    Ok(base64::engine::general_purpose::STANDARD.encode(&payload))
}

fn decrypt_ciphertext(encoded: &str) -> Result<String, String> {
    let key = get_key()?;
    let payload = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("base64 decode failed: {}", e))?;

    if payload.len() < NONCE_LEN + 16 {
        // 至少 nonce + GCM tag (16 bytes)
        return Err("ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
    let nonce = Nonce::assume_unique_for_key(
        nonce_bytes.try_into().map_err(|_| "invalid nonce length".to_string())?,
    );

    let mut in_out = ciphertext.to_vec();
    let plain = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "decryption failed (wrong key or corrupted data)".to_string())?;

    String::from_utf8(plain.to_vec())
        .map_err(|e| format!("invalid UTF-8 after decryption: {}", e))
}

// ─── 加密/解密 ConnectionConfig 的 password 字段 ─────────────

fn encrypt_config(mut config: Value) -> Result<Value, String> {
    if let Value::Object(ref mut obj) = config {
        if let Some(pw) = obj.get("password").and_then(|v| v.as_str()) {
            if !pw.is_empty() {
                let encrypted = encrypt_plaintext(pw)?;
                obj.insert("password".to_string(), Value::String(encrypted));
            }
        }
    }
    Ok(config)
}

fn decrypt_config(mut config: Value) -> Result<Value, String> {
    if let Value::Object(ref mut obj) = config {
        if let Some(pw) = obj.get("password").and_then(|v| v.as_str()) {
            if !pw.is_empty() {
                // 尝试解密；如果看起来像明文（短密码）则保留原样
                match decrypt_ciphertext(pw) {
                    Ok(plain) => {
                        obj.insert("password".to_string(), Value::String(plain));
                    }
                    Err(_) => {
                        // 可能是旧明文数据，保持原样
                    }
                }
            }
        }
    }
    Ok(config)
}

// ─── 存储载荷 ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoragePayload {
    connections: Vec<SavedConnectionEntry>,
    #[serde(default)]
    groups: Vec<String>,
}

// ─── 文件读写 ───────────────────────────────────────────────

fn connections_path() -> Result<PathBuf, String> {
    workspace_dir().map(|d| d.join(CONNECTIONS_FILE))
}

/// 从磁盘加载 payload（解密密码）。向后兼容旧格式（纯数组）。
fn load_payload_raw() -> Result<StoragePayload, String> {
    let path = connections_path()?;
    if !path.exists() {
        return Ok(StoragePayload {
            connections: Vec::new(),
            groups: Vec::new(),
        });
    }
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("read connections: {}", e))?;

    // 先尝试新格式 { connections, groups }
    let payload: StoragePayload = match serde_json::from_slice(&bytes) {
        Ok(p) => p,
        Err(e1) => {
            // 旧格式：纯数组，自动迁移
            match serde_json::from_slice::<Vec<SavedConnectionEntry>>(&bytes) {
                Ok(entries) => StoragePayload {
                    connections: entries,
                    groups: Vec::new(),
                },
                Err(_e2) => {
                    tracing::warn!(
                        "connections.json is unreadable (new-format: {}, legacy: {}); starting fresh",
                        e1,
                        _e2
                    );
                    // Corrupted or empty — return empty, will be overwritten on next save
                    return Ok(StoragePayload {
                        connections: Vec::new(),
                        groups: Vec::new(),
                    });
                }
            }
        }
    };

    // 解密每条连接的密码
    let mut decrypted = Vec::with_capacity(payload.connections.len());
    for mut entry in payload.connections {
        entry.config = decrypt_config(entry.config)?;
        decrypted.push(entry);
    }
    Ok(StoragePayload {
        connections: decrypted,
        groups: payload.groups,
    })
}

/// 写入 payload 到磁盘（加密密码）。
fn save_payload_raw(payload: &StoragePayload) -> Result<(), String> {
    let path = connections_path()?;
    // 加密每条连接的密码
    let mut encrypted_conns = Vec::with_capacity(payload.connections.len());
    for entry in &payload.connections {
        let mut e = entry.clone();
        e.config = encrypt_config(e.config.clone())?;
        encrypted_conns.push(e);
    }
    let to_write = StoragePayload {
        connections: encrypted_conns,
        groups: payload.groups.clone(),
    };
    let json = serde_json::to_vec_pretty(&to_write)
        .map_err(|e| format!("serialize payload: {}", e))?;
    std::fs::write(&path, &json)
        .map_err(|e| format!("write connections: {}", e))?;
    Ok(())
}

// ─── Helper: entry → Value（保持 camelCase 对齐前端）───────

fn entry_to_value(entry: &SavedConnectionEntry) -> Result<Value, String> {
    let mut v = serde_json::to_value(entry)
        .map_err(|e| format!("serialize entry: {}", e))?;
    if let Value::Object(ref mut obj) = v {
        if !obj.contains_key("lastUsedAt") {
            if let Some(lua) = &entry.last_used_at {
                obj.insert("lastUsedAt".to_string(), Value::String(lua.clone()));
            }
        }
    }
    Ok(v)
}

// ─── Tauri Commands ─────────────────────────────────────────

/// 前端调用：加载所有连接和分组（密码已解密）。
/// 返回 `{ connections: [...], groups: [...] }`。
#[tauri::command]
pub async fn load_connections(_app: AppHandle) -> Result<Value, String> {
    let payload = load_payload_raw()?;
    let mut conn_values = Vec::with_capacity(payload.connections.len());
    for entry in &payload.connections {
        conn_values.push(entry_to_value(entry)?);
    }
    Ok(serde_json::json!({
        "connections": conn_values,
        "groups": payload.groups,
    }))
}

/// 前端调用：保存连接和分组（密码加密后写入磁盘）。
/// 接受 `{ connections: [...], groups: [...] }`。
#[tauri::command]
pub async fn save_connections(
    _app: AppHandle,
    payload: Value,
) -> Result<(), String> {
    let connections_raw = payload
        .get("connections")
        .ok_or_else(|| "missing 'connections' field".to_string())?;
    let empty_array = Value::Array(Vec::new());
    let groups_raw = payload
        .get("groups")
        .unwrap_or(&empty_array);

    let connections: Vec<Value> = serde_json::from_value(connections_raw.clone())
        .map_err(|e| format!("invalid connections: {}", e))?;
    let groups: Vec<String> = serde_json::from_value(groups_raw.clone())
        .map_err(|e| format!("invalid groups: {}", e))?;

    let mut entries = Vec::with_capacity(connections.len());
    for c in &connections {
        let entry: SavedConnectionEntry = serde_json::from_value(c.clone())
            .map_err(|e| format!("invalid connection entry: {}", e))?;
        entries.push(entry);
    }

    save_payload_raw(&StoragePayload {
        connections: entries,
        groups,
    })
}
