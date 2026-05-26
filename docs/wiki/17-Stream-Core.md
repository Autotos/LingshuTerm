# 17 — 流处理核心 (UnifiedStreamCore)

## 功能职责

`UnifiedStreamCore` 是 Rust 后端输出处理的统一入口，将原本分散的 MarkerScanner、StreamCleaner 和 output_sanitizer 合并为单一处理管线。所有 PTY/SSH 输出在被发送到前端之前都经过此核心处理。

## 核心数据结构

### UnifiedStreamCore ([stream/core.rs](../src-tauri/src/stream/core.rs))

```rust
pub struct UnifiedStreamCore {
    marker_scanner: MarkerScanner,       // OSC 7701 命令块标记检测
    stream_cleaner: StreamCleaner,       // OSC 133 状态机（Prompt/Command 区域识别）
}
```

## 代码逻辑框架

### 输出处理管线

```
UnifiedStreamCore.process_chunk(bytes, session_id, app)
  │
  ├─ 1. MarkerScanner.scan_chunk_with_callback()
  │     │
  │     ├─ 扫描 OSC 7701 前缀: ESC ] 7 7 0 1 ;
  │     │
  │     ├─ Start Marker: S;<command_id>
  │     │   → emit block-cmd-started { session_id, command_id }
  │     │
  │     └─ End Marker: E;<command_id>;<exit_code>
  │         → emit block-cmd-completed { session_id, command_id, exit_code }
  │
  ├─ 2. StreamCleaner.process_chunk()
  │     │
  │     ├─ OSC 133 状态机: WaitingForPrompt → InPrompt → InCommand
  │     ├─ 提取 InCommand 区域的纯输出
  │     └─ emit block-output { session_id, clean_text }
  │
  └─ 3. output_sanitizer::sanitize()
        │
        ├─ re_printf_7701_line: 清除 printf '\033]7701;...' 包装器残留
        ├─ re_ls_rc_line:        清除 __ls_rc 变量赋值行
        ├─ re_standalone_dollar_question: 清除孤立的 $? 行
        ├─ re_osc_7701:          清除原始 OSC 7701 转义序列
        ├─ re_osc_133:            清除 OSC 133 标记
        ├─ re_bracketed_paste:    清除括号粘贴标记
        │
        └─ emit pti-output { session_id, clean_data }
```

### 跨块缓冲 ([block.rs:140-168](../src-tauri/src/block.rs))

```rust
fn merge_leftover(&mut self, chunk: &[u8]) -> Vec<u8> {
    // 如果上次有未完成的 OSC 序列片段，拼接到当前 chunk 前面
    if self.leftover.is_empty() {
        chunk.to_vec()
    } else {
        let mut combined = std::mem::take(&mut self.leftover);
        combined.extend_from_slice(chunk);
        combined
    }
}
```

## 前端事件流 ([useSessionStream.ts](../src/hooks/useSessionStream.ts))

```typescript
// 监听 Rust 后端事件
listen('pti-output', ({ payload }) => {
  terminal.write(payload);                      // xterm.js 渲染
  persistTerminalChunk(sessionId, 'output', payload);
});

listen('block-cmd-started', ({ payload }) => {
  sessionLogStore.appendLog({
    type: 'command-start',
    data: { commandId: payload.command_id },
  });
});

listen('block-cmd-completed', ({ payload }) => {
  sessionLogStore.appendLog({
    type: 'command-end',
    data: { commandId: payload.command_id, exitCode: payload.exit_code },
  });
});
```

## 扩展点与约束

### 约束

- **OSC 7701 协议专有**：MarkerScanner 仅识别 ESC ] 7701 ; 前缀，不兼容其他标记方案
- **BEL 终止符**：OSC 序列以 BEL (0x07) 或 ST (ESC \) 终止，其他终止符不被识别
- **跨 chunk 扫描**：MarkerScanner 维护 `leftover` 缓冲区，一个 OSC 序列可能跨两个 read 事件
- **Sanitizer 顺序**：清洗正则按固定顺序执行，后续的清洗不会回退前面的结果
