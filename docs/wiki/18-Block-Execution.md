# 18 — 命令块执行系统

## 功能职责

命令块执行系统在用户的 Shell 命令周围注入不可见的 OSC 7701 标记（开始/结束/退出码），使得前端能够精确追踪每个命令的执行边界和结果。这是 Blocks 视图和 Harness 验证循环的基础。

## 核心数据结构

### Block 标记协议 ([block.rs:44-88](../src-tauri/src/block.rs))

```
OSC 7701 Start:  \x1b]7701;S;<command_id>\x07
OSC 7701 End:    \x1b]7701;E;<command_id>;<exit_code>\x07
```

### Command ID 生成 ([block.rs:81-88](../src-tauri/src/block.rs))

```rust
fn generate_command_id() -> String {
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).as_millis();
    let seq = BLOCK_COUNTER.fetch_add(1, Ordering::Relaxed); // AtomicUsize
    format!("blk-{}-{}", ts, seq)
}
```

### Shell 类型 ([block.rs:11-38](../src-tauri/src/block.rs))

```rust
enum ShellType { Bash, Zsh, PowerShell, Sh, Unknown }

impl ShellType {
    fn from_path(shell: &str) -> Self {
        // 从路径中检测 shell 类型
        // bash → Bash, zsh → Zsh, pwsh/powershell → PowerShell, sh → Sh
    }
}
```

## 时序图

### 命令块执行全生命周期

```mermaid
sequenceDiagram
    participant HP as harnessPipeline / useAiSubmit
    participant CMD as Rust commands.rs<br/>execute_block_command
    participant CTRL as ConnectionManager<br/>/ PtyManager
    participant PTY as PTY / SSH Channel
    participant SCAN as MarkerScanner<br/>UnifiedStreamCore
    participant FE as useSessionStream<br/>(前端)

    HP->>CMD: invoke('execute_block_command',<br/>{ sessionId, command: "npm install" })

    CMD->>CMD: 1. 生成 command_id<br/> blk-{timestamp}-{seq}
    CMD->>CMD: 2. 检测 shell 类型<br/>ShellType::from_path(shell)
    CMD->>CMD: 3. 包装命令<br/>wrap_command(shell, id, command)

    Note over CMD: POSIX 包装结果:<br/>PROMPT_COMMAND= printf '\033]7701;S;blk-123;...\007';<br/>npm install;<br/>__ls_rc=$?;<br/>printf '\033]7701;E;blk-123;%d\007' "$__ls_rc"

    CMD->>CTRL: write_input(sessionId, wrapped_command)

    CTRL->>PTY: 写入 PTY / SSH channel

    Note over PTY: Shell 执行中...

    PTY-->>SCAN: stdout chunk 1<br/>包含 ESC ] 7 7 0 1 ; S ; blk-123 BEL

    SCAN->>SCAN: scan_chunk_with_callback()<br/>检测到 OSC 7701 Start Marker
    SCAN->>SCAN: parse_marker("S;blk-123")
    SCAN-->>FE: emit block-cmd-started<br/>{ session_id, command_id: "blk-123" }
    FE->>FE: sessionLogStore.appendLog<br/>{ type: 'command-start' }

    Note over PTY: npm install 继续输出...

    PTY-->>SCAN: stdout chunk 2<br/>"added 150 packages in 10s"

    SCAN->>SCAN: StreamCleaner 提取<br/>InCommand 区域纯输出
    SCAN-->>FE: emit block-output<br/>{ session_id, data: "added 150 packages..." }
    FE->>FE: 追加到 Blocks UI 输出

    Note over PTY: 命令结束

    PTY-->>SCAN: stdout chunk 3<br/>包含 ESC ] 7 7 0 1 ; E ; blk-123 ; 0 BEL

    SCAN->>SCAN: parse_marker("E;blk-123;0")
    SCAN-->>FE: emit block-cmd-completed<br/>{ session_id, command_id: "blk-123", exit_code: 0 }
    FE->>FE: sessionLogStore.appendLog<br/>{ type: 'command-end', exitCode: 0 }
    FE->>FE: Block UI 状态更新<br/>status: 'running' → 'success'
```

## 代码逻辑框架

### 命令包装 ([block.rs:48-72](../src-tauri/src/block.rs))

```
wrap_command(shell_type, command_id, user_command) → String
  │
  ├─ POSIX Shell (Bash/Zsh/Sh):
  │     "PROMPT_COMMAND= printf '\033]7701;S;{id}\007';
  │      {cmd};
  │      __ls_rc=$?;
  │      printf '\033]7701;E;{id};%d\007' \"$__ls_rc\"\n"
  │
  └─ PowerShell:
        "[Console]::Write([char]27 + ']7701;S;{id}' + [char]7);
         {cmd};
         $__ls_rc = $(if ($?) { if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 } } else { 1 });
         [Console]::Write([char]27 + ']7701;E;{id};' + $__ls_rc + [char]7)\r\n"
```

### 执行分发 ([commands.rs](../src-tauri/src/commands.rs))

```rust
#[tauri::command]
pub fn execute_block_command(
    pty: State<'_, PtyManager>,
    conn: State<'_, ConnectionManager>,
    session_id: String,
    command: String,
) -> Result<String, String> {
    // 1. 生成 command_id
    // 2. 检测 shell 类型
    // 3. 调用 wrap_command() 包装
    // 4. 通过 PtyManager 或 ConnectionManager 写入 PTY
    // 5. 返回 command_id（前端通过事件监听结果）
}
```

### 标记检测 ([block.rs:209-235](../src-tauri/src/block.rs))

```rust
fn parse_marker(&mut self, payload: &str) -> Option<Marker> {
    match payload.splitn(3, ';').collect::<Vec<_>>().as_slice() {
        ["S", command_id] → Marker::Start { command_id, command }
        ["E", command_id, exit_code_str] → Marker::End { command_id, exit_code }
        _ → None
    }
}
```

### 前端事件监听

| 事件 | Payload | 触发动作 |
|------|---------|---------|
| `block-cmd-started` | `{ session_id, command_id }` | sessionLogStore.appendLog |
| `block-cmd-completed` | `{ session_id, command_id, exit_code }` | 更新 Block UI 状态 |
| `block-output` | `{ session_id, data }` | 追加到命令输出缓冲区 |

## 扩展点与约束

### 约束

- **OSC 7701 是自定义协议**：不是任何行业标准，仅 LingshuTerm 内部使用
- **PROMPT_COMMAND 副作用**：Bash/Zsh 中设置 `PROMPT_COMMAND=` 会清除已有的 PROMPT_COMMAND 钩子
- **PowerShell 退出码**：`$?` 和 `$LASTEXITCODE` 的组合逻辑需要同时覆盖 cmdlet 错误和外部程序退出码
- **命令中的分号**：如果用户命令包含分号，可能导致包装器的命令链提前结束（如 `for i in 1 2; do echo $i; done`）
