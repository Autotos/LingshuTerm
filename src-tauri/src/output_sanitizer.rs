//! 输出清洗器：把 Warp 集成脚本注入的控制序列 / 辅助命令回显从 PTY 输出里剥掉。
//!
//! 设计原则：
//! * 只动"垃圾"；不动 SGR（`\x1b[...m`）等正常颜色与格式序列；
//! * 逐事件输入流水线调用，必须轻量，因此所有正则都用 `OnceLock` 缓存；
//! * 不破坏 OSC 7701 协议链路 —— 调用方（`shell.rs` / `connection.rs`）必须先把
//!   原始字节交给 `MarkerScanner` 扫描，再把 UTF-8 文本传入本模块清洗。
//!
//! 清洗内容：
//! 1. ANSI 模式切换：`\x1b[?2004h`、`\x1b[?2004l`（bracketed-paste 开关）；
//! 2. Warp OSC 序列：`\x1b]7701;...\x07` 与 `\x1b]133;...\x07`；
//! 3. Shell 辅助命令回显：包含 `printf ... 7701` 的行、以 `__ls_rc=`/`$__ls_rc` 起头的行。
//!
//! 以上均为"可以安全丢弃"的流量 —— Blocks 模式需要它们被消除，Terminal 模式也不
//! 依赖它们做视觉渲染。

use regex::Regex;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Regex 缓存
// ---------------------------------------------------------------------------

/// `\x1b[?2004h` / `\x1b[?2004l` —— bracketed-paste DECSET/DECRST。
fn re_bracketed_paste() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\x1b\[\?2004[hl]").expect("bracketed-paste regex"))
}

/// `\x1b]7701;<payload>\x07` —— Warp 自定义状态 OSC。
fn re_osc_7701() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\x1b\]7701;[^\x07]*\x07").expect("osc 7701 regex"))
}

/// `\x1b]133;<payload>\x07` —— Warp/iTerm2 Prompt 标记。
fn re_osc_133() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\x1b\]133;[^\x07]*\x07").expect("osc 133 regex"))
}

/// 含 `printf ... 7701` 的整行（shell 把我们注入的辅助命令回显出来的形式）。
/// 使用 `(?m)` 让 `^` / `$` 作用于每一行。
fn re_printf_7701_line() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(?m)^.*printf[^\n]*7701[^\n]*\r?\n?")
            .expect("printf 7701 line regex")
    })
}

/// 以 `__ls_rc=` 或 `$__ls_rc =` 起头或位于行中任意位置的整行
///（POSIX / PowerShell 变量赋值回显）。
/// 使用 `^.*` 开头而非 `^[ \t]*`，以兼容交互式 shell 在行首 echo
/// 出的 prompt 前缀（如 `~ $ __ls_rc=$?`）。
fn re_ls_rc_line() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(?m)^.*\$?__ls_rc[ \t]*=.*?\r?\n?")
            .expect("__ls_rc line regex")
    })
}

/// 孤立的 `$?` 行 —— 当 `__ls_rc=$?` 被 PTY chunk 边界切分时，
/// `$?` 可能单独出现在新 chunk 的行首而成为逃逸字符。
/// 也处理 Shell PROMPT_COMMAND / xtrace 泄露的 `$?`。
fn re_standalone_dollar_question() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(?m)^\s*\$\?\s*\r?\n?")
            .expect("standalone $? regex")
    })
}

/// 以 `PROMPT_COMMAND=` 起头的行 —— block command wrapper echo。
/// `wrap_command` 注入 `PROMPT_COMMAND= printf ...` 来屏蔽 prompt hook，
/// 这一整行会在终端回显，需整体裁切。
fn re_prompt_command_line() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(?m)^.*\bPROMPT_COMMAND=[^\n]*\r?\n?")
            .expect("PROMPT_COMMAND line regex")
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// 对一段 UTF-8 文本执行所有清洗规则，返回清洗后的新字符串。
///
/// 调用约定：
/// * 入参通常是 `String::from_utf8_lossy(chunk).to_string()`；
/// * 调用前请确保原始 `chunk` 已经被 `MarkerScanner::scan_chunk` 扫描过，
///   否则会丢失 OSC 7701 协议事件；
/// * 该函数幂等 —— 对一段已经清洗过的文本再次调用结果不变。
pub fn sanitize_output(raw_output: String) -> String {
    // ═══ 步骤顺序至关重要 ═══
    //
    // 1) 先应用行级模式（printf 7701、__ls_rc= 赋值）。
    //    必须在剥离 OSC 序列之前执行，否则 printf 行中的 OSC 内容
    //    被移除后"7701"标识丢失，re_printf_7701_line 永远匹配不到。
    let s = re_printf_7701_line().replace_all(&raw_output, "").into_owned();
    let s = re_ls_rc_line().replace_all(&s, "").into_owned();

    // 1.5) 清理孤立的 `$?` 行（当 `__ls_rc=$?` 被 chunk 边界切分时，
    //      `$?` 单独落在下一块；也处理 PROMPT_COMMAND / xtrace 泄露）。
    let s = re_standalone_dollar_question().replace_all(&s, "").into_owned();

    // 1.6) 清理 block command wrapper 回显行（`PROMPT_COMMAND= printf ...`）。
    let s = re_prompt_command_line().replace_all(&s, "").into_owned();

    // 2) 再剥 OSC 序列（BEL 结尾的复杂结构）。
    let s = re_osc_7701().replace_all(&s, "").into_owned();
    let s = re_osc_133().replace_all(&s, "").into_owned();

    // 3) DECSET/DECRST（bracketed paste）
    let s = re_bracketed_paste().replace_all(&s, "").into_owned();

    s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_bracketed_paste_mode() {
        let input = "hello\x1b[?2004hworld\x1b[?2004l!".to_string();
        assert_eq!(sanitize_output(input), "helloworld!");
    }

    #[test]
    fn removes_osc_7701_markers() {
        let input = "\x1b]7701;S;blk-123\x07output\x1b]7701;E;blk-123;0\x07".to_string();
        assert_eq!(sanitize_output(input), "output");
    }

    #[test]
    fn removes_osc_133_prompts() {
        let input = "\x1b]133;A\x07$ ls\x1b]133;C\x07file".to_string();
        assert_eq!(sanitize_output(input), "$ lsfile");
    }

    #[test]
    fn strips_printf_7701_echo_line() {
        let input = "printf '\\033]7701;E;blk-1;0\\007'\nreal output\n".to_string();
        assert_eq!(sanitize_output(input), "real output\n");
    }

    #[test]
    fn strips_ls_rc_assignment_line() {
        // POSIX 形式
        let input = "total 3\n__ls_rc=$?\nfile.txt\n".to_string();
        assert_eq!(sanitize_output(input), "total 3\nfile.txt\n");
    }

    #[test]
    fn strips_powershell_ls_rc_assignment_line() {
        let input = "output\n$__ls_rc = 0\nnext\n".to_string();
        assert_eq!(sanitize_output(input), "output\nnext\n");
    }

    #[test]
    fn strips_ls_rc_with_prompt_prefix() {
        // 交互式 shell echo 出的行带 prompt 前缀
        let input = "~ $ __ls_rc=$?\nfile.txt\n".to_string();
        assert_eq!(sanitize_output(input), "file.txt\n");
    }

    #[test]
    fn preserves_sgr_colors() {
        let input = "plain \x1b[32mgreen\x1b[0m tail".to_string();
        assert_eq!(sanitize_output(input), "plain \x1b[32mgreen\x1b[0m tail");
    }

    #[test]
    fn preserves_crlf_line_endings() {
        let input = "a\r\nb\r\n".to_string();
        assert_eq!(sanitize_output(input), "a\r\nb\r\n");
    }

    #[test]
    fn end_to_end_warp_ls_output() {
        // 复刻用户反馈的现象：OSC + bracketed-paste + printf 回显 + __ls_rc 混杂
        let input = "\x1b[?2004l\x1b]7701;S;blk-1\x07\
                     file1  file2  file3\n\
                     __ls_rc=$?\n\
                     printf '\\033]7701;E;blk-1;%d\\007' \"$__ls_rc\"\n\
                     \x1b]7701;E;blk-1;0\x07\x1b[?2004h"
            .to_string();
        assert_eq!(
            sanitize_output(input),
            "file1  file2  file3\n"
        );
    }

    #[test]
    fn strips_standalone_dollar_question() {
        // 孤立的 `$?` 行（chunk 边界导致 `__ls_rc=$?` 被切分后，
        // `$?` 落在新 chunk 行首）
        let input = "$?\nfile.txt\n".to_string();
        assert_eq!(sanitize_output(input), "file.txt\n");
    }

    #[test]
    fn strips_dollar_question_with_whitespace() {
        // 带前导空白字符的 `$?`
        let input = "output\n  $?  \nnext\n".to_string();
        assert_eq!(sanitize_output(input), "output\nnext\n");
    }

    #[test]
    fn dollar_question_within_legitimate_text_is_preserved() {
        // 如果 `$?` 是用户命令输出的一部分（非孤立行），不要误删
        let input = "value: $? is 0\n".to_string();
        assert_eq!(sanitize_output(input), "value: $? is 0\n");
    }

    #[test]
    fn end_to_end_chunk_split_recovery() {
        // 模拟 chunk 边界切分场景：
        //   Chunk 1: "...\n__ls_rc="  (re_ls_rc_line 匹配后只剩 "...\n")
        //   Chunk 2: "$?\nprintf ..." (孤立 $? + printf 行)
        // 第二个 chunk 的 sanitize 应同时清除 $? 行和 printf 行
        let input = "$?\nprintf '\\033]7701;E;blk-1;0\\007'\noutput\n".to_string();
        assert_eq!(sanitize_output(input), "output\n");
    }

    #[test]
    fn idempotent() {
        let input = "\x1b[?2004h\x1b]7701;S;x\x07hi\x1b]7701;E;x;0\x07".to_string();
        let once = sanitize_output(input);
        let twice = sanitize_output(once.clone());
        assert_eq!(once, twice);
    }
}
