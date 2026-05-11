//! 有状态的 Blocks 模式流裁切器。
//!
//! 与 [`output_sanitizer`](crate::output_sanitizer) 的无状态"逐段降噪"不同，`StreamCleaner`
//! 跨 chunk 维护 OSC 133 状态机，对一条 PTY 输出流做**结构化切片**，只保留"命令真正的结
//! 果"交给前端的 Blocks 视图。
//!
//! ## 状态机（OSC 133 路径）
//! * `WaitingForPrompt` —— 冷启动 / 一个 block 刚结束；收到的字节全部丢弃。
//! * `InPrompt`         —— 提示符开始（`133;A`）到命令开始（`133;B`）之间；丢弃全部（含 `cyl@cyl:~$` / `ls` 回显）。
//! * `InCommand`        —— 命令开始（`133;B`）到命令结束（`133;D`）之间；**保留**全部字节。
//!
//! 转移：
//! ```text
//!                    133;A             133;B              133;D;<code>
//! WaitingForPrompt ─────────► InPrompt ────────► InCommand ─────────► WaitingForPrompt
//! ```
//!
//! ## 降级路径（未检测到 OSC 133）
//! 某些 shell 未安装 Warp 集成脚本。只要累计处理 >= N 字节且**从未**见到 `\x1b]133;`，
//! 便自动切换到**行过滤**模式：
//! * 含 `<user>@<host>` 形式的提示符行；
//! * `$` 或 `#` 作为末位字符的行（裸 bash / zsh 提示符）；
//! * 含 `printf` 且含 `7701` 的注入行；
//! * 仅含 `$?` / 空白的行。
//!
//! 这样无论 shell 是否注入 Warp 集成，Blocks 视图都能拿到"接近纯净"的输出。

use regex::Regex;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// ParseState
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseState {
    WaitingForPrompt,
    InPrompt,
    InCommand,
}

// ---------------------------------------------------------------------------
// Regex (降级路径专用，OnceLock 缓存)
// ---------------------------------------------------------------------------

/// 含 `user@host` 形式的提示符行（例如 `cyl@cyl:~$ ls`）。
fn re_prompt_userhost() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"[A-Za-z0-9_.\-]+@[A-Za-z0-9_.\-]+[:\s]").expect("userhost re"))
}

/// 以 `$` 或 `#` 结尾（允许尾随空白）的行 —— 裸提示符。
fn re_prompt_tail_sigil() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"[\$#]\s*$").expect("prompt tail re"))
}

/// `printf ... 7701 ...` —— 我们自己注入的 OSC 7701 回显行。
fn re_printf_7701() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"printf[^\n]*7701").expect("printf 7701 re"))
}

/// 整行仅剩 `$?` 或空白。
fn re_only_dollar_q() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*\$\?\s*$").expect("$? re"))
}

// ---------------------------------------------------------------------------
// StreamCleaner
// ---------------------------------------------------------------------------

const OSC_133_PREFIX: &[u8] = b"\x1b]133;";
const OSC_TERMINATOR_BEL: u8 = 0x07;
const OSC_TERMINATOR_ESC: u8 = 0x1b;

/// 当持续收到这么多字节仍未见到 OSC 133 时，判定"shell 未集成 Warp"，走降级路径。
const DEGRADE_THRESHOLD_BYTES: usize = 4096;

pub struct StreamCleaner {
    state: ParseState,
    /// 上一 chunk 末尾可能是半截 OSC 序列，保留下来与下 chunk 合并解析。
    leftover: Vec<u8>,
    /// 当前 InCommand 累计产出（由 `process_chunk` 返回后清空）。
    output_buffer: Vec<u8>,
    /// 降级路径的行缓冲（未写出到 pending_line 的尾部残片）。
    line_buffer: Vec<u8>,
    /// 是否在此 session 里见到过任何 `\x1b]133;` —— 一旦 true 即永久走状态机。
    seen_osc_133: bool,
    /// 降级前累计观察到的字节数。
    observed_bytes: usize,
}

impl StreamCleaner {
    pub fn new() -> Self {
        Self {
            state: ParseState::WaitingForPrompt,
            leftover: Vec::new(),
            output_buffer: Vec::new(),
            line_buffer: Vec::new(),
            seen_osc_133: false,
            observed_bytes: 0,
        }
    }

    /// 处理一段 PTY 原始字节，返回该 chunk 对应的**纯净 UTF-8 文本**。
    ///
    /// * 若已见过 OSC 133：按状态机裁切；`InCommand` 以外的数据全部丢弃。
    /// * 若从未见 OSC 133 且累计观察字节超阈值：按行过滤降级。
    /// * 否则（尚在"观察期"）暂时原样返回，让后续可能出现的 OSC 133 被捕获。
    pub fn process_chunk(&mut self, bytes: &[u8]) -> String {
        self.observed_bytes = self.observed_bytes.saturating_add(bytes.len());

        // 快速路径：粗扫描本 chunk 是否含 `\x1b]133;`；一旦出现就一直走状态机。
        if !self.seen_osc_133 && contains_subsequence(bytes, OSC_133_PREFIX) {
            self.seen_osc_133 = true;
        }
        // 合并 leftover + 本 chunk
        let combined = if self.leftover.is_empty() {
            bytes.to_vec()
        } else {
            let mut v = std::mem::take(&mut self.leftover);
            v.extend_from_slice(bytes);
            v
        };

        if self.seen_osc_133 {
            self.process_via_state_machine(&combined)
        } else if self.observed_bytes >= DEGRADE_THRESHOLD_BYTES {
            // 降级：按行过滤
            self.process_via_line_filter(&combined)
        } else {
            // 观察期：暂原样输出，但仍做 `__ls_rc` / `printf 7701` / 独立 `$?` 行裁切兜底
            self.process_via_line_filter(&combined)
        }
    }

    /// 重置状态（切换 session 或 block 外部手动重置时用）。
    pub fn reset(&mut self) {
        self.state = ParseState::WaitingForPrompt;
        self.leftover.clear();
        self.output_buffer.clear();
        self.line_buffer.clear();
    }

    // ---- 状态机路径 -------------------------------------------------------

    fn process_via_state_machine(&mut self, data: &[u8]) -> String {
        self.output_buffer.clear();
        let mut i = 0;
        while i < data.len() {
            if let Some(off) = find_esc(&data[i..]) {
                let esc = i + off;

                // ESC 之前的字节：按当前 state 决定吞/吐
                if esc > i {
                    self.emit_range(&data[i..esc]);
                }

                let remain = &data[esc..];
                if remain.len() < OSC_133_PREFIX.len() {
                    // 半截前缀 —— 存 leftover
                    self.leftover = remain.to_vec();
                    return flush_string(&mut self.output_buffer);
                }

                if remain.starts_with(OSC_133_PREFIX) {
                    let payload_start = esc + OSC_133_PREFIX.len();
                    match find_osc_terminator(&data[payload_start..]) {
                        Some((term_off, term_len)) => {
                            let payload = &data[payload_start..payload_start + term_off];
                            self.apply_133_payload(payload);
                            i = payload_start + term_off + term_len;
                            continue;
                        }
                        None => {
                            // terminator 未到 —— 保存整段 leftover
                            self.leftover = remain.to_vec();
                            return flush_string(&mut self.output_buffer);
                        }
                    }
                } else {
                    // 其它 ESC 序列：不由 133 协议处理，按当前 state 决定是否透传
                    // 简化起见：透传一个 ESC 字节即可（下一轮循环继续处理）
                    self.emit_range(&data[esc..esc + 1]);
                    i = esc + 1;
                    continue;
                }
            } else {
                self.emit_range(&data[i..]);
                break;
            }
        }
        flush_string(&mut self.output_buffer)
    }

    fn emit_range(&mut self, slice: &[u8]) {
        if matches!(self.state, ParseState::InCommand) {
            self.output_buffer.extend_from_slice(slice);
        }
        // WaitingForPrompt / InPrompt：丢弃
    }

    fn apply_133_payload(&mut self, payload: &[u8]) {
        // payload 举例：`A`、`B`、`C`、`D;0`、`A;special=...`
        let first = payload.first().copied();
        match first {
            Some(b'A') => self.state = ParseState::InPrompt,
            Some(b'B') | Some(b'C') => self.state = ParseState::InCommand,
            Some(b'D') => self.state = ParseState::WaitingForPrompt,
            _ => { /* 未知子码：维持当前 state */ }
        }
    }

    // ---- 降级路径：行过滤 -------------------------------------------------

    fn process_via_line_filter(&mut self, data: &[u8]) -> String {
        // 把 leftover 行 + 新 data 按行切；留一条尾行（未遇到 \n）作为新 line_buffer
        let mut combined = std::mem::take(&mut self.line_buffer);
        combined.extend_from_slice(data);

        let mut out = String::new();
        let mut start = 0;
        for (i, &b) in combined.iter().enumerate() {
            if b == b'\n' {
                let line_bytes = &combined[start..=i]; // 含 \n
                let line = String::from_utf8_lossy(line_bytes);
                if !is_noise_line(line.trim_end_matches(&['\r', '\n'][..])) {
                    out.push_str(&line);
                }
                start = i + 1;
            }
        }
        // 尾部未完成的一行保留
        self.line_buffer = combined[start..].to_vec();
        out
    }
}

fn is_noise_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false; // 保留真正的空行（命令输出中可能有）
    }
    // `cyl@cyl` 这种提示符特征
    if re_prompt_userhost().is_match(trimmed) {
        return true;
    }
    // 以 `$` / `#` 结尾（裸提示符，如 `bash-5.1$`）
    if re_prompt_tail_sigil().is_match(trimmed) {
        return true;
    }
    // 注入回显：`printf ... 7701`
    if re_printf_7701().is_match(trimmed) {
        return true;
    }
    // 整行只是 `$?`
    if re_only_dollar_q().is_match(trimmed) {
        return true;
    }
    // `__ls_rc=…` / `$__ls_rc = …`
    if trimmed.starts_with("__ls_rc") || trimmed.starts_with("$__ls_rc") {
        return true;
    }
    // `PROMPT_COMMAND=…` (block command wrapper echo)
    if trimmed.contains("PROMPT_COMMAND=") {
        return true;
    }
    false
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

fn find_esc(haystack: &[u8]) -> Option<usize> {
    haystack.iter().position(|&b| b == 0x1b)
}

fn contains_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// 在 OSC payload 中寻找终止符：BEL(0x07) 或 ESC\ (ST)。
/// 返回 (偏移, 终止符长度)。
fn find_osc_terminator(buf: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i < buf.len() {
        match buf[i] {
            OSC_TERMINATOR_BEL => return Some((i, 1)),
            OSC_TERMINATOR_ESC if i + 1 < buf.len() && buf[i + 1] == b'\\' => return Some((i, 2)),
            _ => i += 1,
        }
    }
    None
}

fn flush_string(buf: &mut Vec<u8>) -> String {
    let s = String::from_utf8_lossy(buf).into_owned();
    buf.clear();
    s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_machine_extracts_only_command_output() {
        let mut c = StreamCleaner::new();
        // 模拟 Warp 集成 shell 的完整一轮：提示符 + 用户输入回显 + 命令输出 + 完成
        let chunk = b"\x1b]133;A\x07\
                      cyl@cyl:~$ ls\r\n\
                      \x1b]133;B\x07\
                      file1  file2\r\n\
                      \x1b]133;D;0\x07";
        let out = c.process_chunk(chunk);
        assert_eq!(out, "file1  file2\r\n");
        assert_eq!(c.state, ParseState::WaitingForPrompt);
    }

    #[test]
    fn state_machine_drops_prompt_and_echo() {
        let mut c = StreamCleaner::new();
        // 开启状态机模式
        c.process_chunk(b"\x1b]133;A\x07");
        // InPrompt：这一段必须被全部丢弃
        let out = c.process_chunk(b"cyl@cyl:~$ pwd\r\n");
        assert_eq!(out, "");
        assert_eq!(c.state, ParseState::InPrompt);
    }

    #[test]
    fn state_machine_handles_chunk_boundary_in_osc() {
        let mut c = StreamCleaner::new();
        // 一个 OSC 序列被切成两个 chunk
        let out1 = c.process_chunk(b"before\x1b]133;A");
        let out2 = c.process_chunk(b"\x07visible\x1b]133;B\x07real");
        // before 在状态机第一次处理时属于 WaitingForPrompt → 丢弃
        assert_eq!(out1, "");
        // visible 在 InPrompt → 丢弃；real 在 InCommand → 保留
        assert_eq!(out2, "real");
    }

    #[test]
    fn state_machine_handles_multiple_blocks() {
        let mut c = StreamCleaner::new();
        let chunk = b"\x1b]133;A\x07prompt1\x1b]133;B\x07out1\x1b]133;D;0\x07\
                      \x1b]133;A\x07prompt2\x1b]133;B\x07out2\x1b]133;D;0\x07";
        let out = c.process_chunk(chunk);
        assert_eq!(out, "out1out2");
    }

    #[test]
    fn fallback_filters_prompt_lines() {
        let mut c = StreamCleaner::new();
        // 没有 OSC 133，并先灌入 > 阈值字节触发降级（不必，但阈值不影响本行过滤）
        let input = b"cyl@cyl:~$ ls\nfile1  file2\nbash-5.1$\n__ls_rc=$?\nlast line\n";
        let out = c.process_chunk(input);
        assert_eq!(out, "file1  file2\nlast line\n");
    }

    #[test]
    fn fallback_drops_printf_7701_line() {
        let mut c = StreamCleaner::new();
        let input = b"printf '\\033]7701;S;blk-1\\007'\nresult\n";
        let out = c.process_chunk(input);
        assert_eq!(out, "result\n");
    }

    #[test]
    fn fallback_drops_dollar_q_only_line() {
        let mut c = StreamCleaner::new();
        let input = b"data\n$?\nmore\n";
        let out = c.process_chunk(input);
        assert_eq!(out, "data\nmore\n");
    }

    #[test]
    fn fallback_buffers_trailing_partial_line() {
        let mut c = StreamCleaner::new();
        // 无换行结尾 → 尾部保留，不马上输出
        let out1 = c.process_chunk(b"partial ");
        assert_eq!(out1, "");
        // 下一 chunk 补完 \n → 输出合并行
        let out2 = c.process_chunk(b"line\n");
        assert_eq!(out2, "partial line\n");
    }

    #[test]
    fn reset_clears_state() {
        let mut c = StreamCleaner::new();
        c.process_chunk(b"\x1b]133;A\x07\x1b]133;B\x07");
        assert_eq!(c.state, ParseState::InCommand);
        c.reset();
        assert_eq!(c.state, ParseState::WaitingForPrompt);
        assert!(c.leftover.is_empty());
        assert!(c.line_buffer.is_empty());
    }

    #[test]
    fn osc_terminated_by_st_also_works() {
        let mut c = StreamCleaner::new();
        // 终止符是 ESC \ 而不是 BEL
        let chunk = b"\x1b]133;A\x1b\\prompt\x1b]133;B\x1b\\real\x1b]133;D;0\x1b\\";
        let out = c.process_chunk(chunk);
        assert_eq!(out, "real");
    }
}
