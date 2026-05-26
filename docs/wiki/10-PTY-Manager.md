# 10 — 本地 PTY 管理 (Rust)

## 功能职责

基于 `portable-pty` 的跨平台伪终端管理系统，支持自动检测当前操作系统可用的 Shell（cmd/powershell/bash/zsh），管理 PTY 进程的创建、输入/输出和生命周期。

## 核心数据结构

### PtyManager ([shell.rs](../src-tauri/src/shell.rs))

```rust
pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, PtySession>>>,
    next_id: AtomicUsize,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    stream_cores: Arc<Mutex<HashMap<String, UnifiedStreamCore>>>,
}
```

管理本地 PTY 会话的生命周期，内部维护所有活跃 PTY 进程的 Map。

### Shell 自动检测 ([session_commands.rs:68-134](../src-tauri/src/session_commands.rs))

| 平台 | 检测的 Shell | 路径来源 |
|------|-------------|---------|
| Windows | cmd.exe | `%ComSpec%` 环境变量 |
| Windows | PowerShell | `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` |
| macOS/Linux | bash | `/bin/bash`, `/usr/bin/bash`, `/usr/local/bin/bash` |
| macOS/Linux | zsh | `/bin/zsh`, `/usr/bin/zsh`, `/usr/local/bin/zsh` |
| 其他 Unix | sh | `/bin/sh` (回退) |

## 代码逻辑框架

### PTY 创建流程

```
create_session(shell_path?, cwd?)
  │
  ├─ 1. 生成 session_id = "session-{N}"
  │
  ├─ 2. 检测可用 Shell
  │     ├─ shell_path 指定 → 使用指定 Shell
  │     └─ shell_path 为空 → 平台默认 Shell 检测
  │
  ├─ 3. portable-pty 创建 PTY
  │     ├─ pty_process = PtySystem::new()
  │     ├─ 设置 working directory (如果提供了 cwd)
  │     └─ spawn shell
  │
  ├─ 4. 注册 UnifiedStreamCore
  │
  ├─ 5. 启动 PTY 输出读取线程
  │     loop {
  │       pty.try_read(&mut buf)
  │       → output_sanitizer::sanitize()
  │       → UnifiedStreamCore.process_chunk()
  │       → emit pti-output / block-* events
  │     }
  │
  └─ 6. 返回 session_id
```

### 命令块执行 ([commands.rs](../src-tauri/src/commands.rs))

```rust
#[tauri::command]
pub fn execute_block_command(
    pty: State<'_, PtyManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    command: String,
) -> Result<String, String> {
    // 根据 session_id 前缀路由
    match session_id.starts_with("session-") {
        true  → pty.execute_block_command(&session_id, &command),
        false → conn.execute_block_command(&session_id, &command),
    }
}
```

## 扩展点与约束

### 约束

- **Windows 路径中的空格**：`cmd.exe` 路径可能包含空格（`C:\Windows\System32\cmd.exe`），已通过环境变量正确获取
- **PTY 列/行数**：已废弃 `portable-pty` 中错误的列/行计算，前端通过 `xterm.js ResizeObserver` 管理终端尺寸
- **Shell 回退**：当所有候选路径都不存在时，Unix 回退到 `/bin/sh`，Windows 保证至少有 cmd.exe 和 powershell.exe
