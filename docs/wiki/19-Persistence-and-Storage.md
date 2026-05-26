# 19 — 持久化与加密存储

## 功能职责

持久化系统负责将会话数据、连接配置、用户设置保存到磁盘。加密存储保证敏感信息（SSH 密码等）在磁盘上以密文形式存在。

## 核心数据结构

### 持久化文件布局

```
{HOME}/.LingShuTerm/workspace/
├── .key                           ← AES-256 密钥（256-bit 随机生成）
├── connections.json               ← 加密的连接配置
├── settings.json                  ← 用户设置备份
├── logs/                          ← 终端录制日志
│   └── {sessionName}/
│       └── {terminalName}.log
└── sessions/
    └── {session_id}/
        ├── meta.json              ← 会话元信息
        ├── session.timeline.ndjson ← 会话日志（每行一个 JSON）
        └── editor.json            ← 编辑器状态
```

### 加密方案 ([storage.rs](../src-tauri/src/storage.rs))

```
加密：AES-256-GCM (ring crate)
  - 密钥：首次运行时随机生成 256-bit，持久化到 .key 文件
  - Nonce：每次加密随机生成 96-bit
  - 密文格式：base64(nonce || ciphertext || tag)
  - 存储格式：
    {
      "connections": [{ id, name, config: { ..., password: "base64(...)" } }],
      "groups": ["GroupA", "GroupB"]
    }
```

## 代码逻辑框架

### 持久化命令 ([persistence.rs](../src-tauri/src/persistence.rs))

| Tauri Command | 文件 | 说明 |
|--------------|------|------|
| `save_session_meta` | `sessions/{id}/meta.json` | 保存会话标题、Shell、时间 |
| `save_session_blocks` | `sessions/{id}/blocks.json` | 保存 Blocks 视图数据 |
| `save_session_editor` | `sessions/{id}/editor.json` | 保存编辑器 Tab 状态 |
| `append_terminal_log` | `sessions/{id}/terminal.log` | 追加终端输出 |
| `append_terminal_batch` | `sessions/{id}/terminal.log` | 批量追加终端输出 |
| `append_timeline_batch` | `sessions/{id}/session.timeline.ndjson` | NDJSON 格式会话日志 |
| `load_session` | `sessions/{id}/` | 加载完整会话数据 |
| `list_sessions` | `sessions/` | 列出所有已保存会话 |
| `clear_session` | `sessions/{id}/` | 删除会话数据 |
| `save_settings` | `settings.json` | 保存用户设置 |
| `load_settings` | `settings.json` | 加载用户设置 |
| `read_memory_file` | `sessions/{id}/{filename}` | 读取记忆文件 |
| `write_memory_file` | `sessions/{id}/{filename}` | 写入记忆文件 |
| `save_session_export` | 用户选择路径 | 导出会话数据 |
| `load_sessions` | `sessions.json` | 批量加载会话列表 |
| `save_sessions` | `sessions.json` | 批量保存会话列表 |

### 连接存储 ([storage.rs](../src-tauri/src/storage.rs))

```rust
#[tauri::command]
fn load_connections() -> Result<StoragePayload, String> {
    // 1. 读取 connections.json
    // 2. 读取 .key 获取 AES 密钥
    // 3. 对每个连接的 password 字段进行 AES-256-GCM 解密
    // 4. 返回解密后的 StoragePayload
}

#[tauri::command]
fn save_connections(payload: StoragePayload) -> Result<(), String> {
    // 1. 对每个连接的 password 字段进行 AES-256-GCM 加密
    // 2. base64(nonce || ciphertext || tag) → password 字段
    // 3. 序列化写入 connections.json
}
```

### 前端持久化订阅 ([persistenceSubscribe.ts](../src/lib/persistenceSubscribe.ts))

应用启动和运行期间，通过 Zustand Store 的 `subscribe` API 自动将关键状态变更同步到磁盘：

```typescript
// 四路订阅
sessionStore.subscribe(...)  → save_session_meta / append_terminal_batch
sessionLogStore.subscribe(...) → append_timeline_batch
editorStore.subscribe(...)   → save_session_editor
settingsStore.subscribe(...) → save_settings (debounced 500ms)
```

## 扩展点与约束

### 约束

- **密钥存储**：`.key` 文件与加密数据存储在同一目录，仅提供存储级保护（非传输级）
- **旧格式迁移**：旧版本的纯数组连接格式自动迁移为 `StoragePayload { connections, groups }` 结构
- **NDJSON 格式**：`session.timeline.ndjson` 为追加写入，不支持随机修改或删除单条记录
- **工作空间路径**：通过 `crate::utils::workspace_dir()` 获取，不同平台路径不同
