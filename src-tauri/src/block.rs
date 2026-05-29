use serde::Serialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tracing::{debug, warn};

// ---------------------------------------------------------------------------
// ShellType
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellType {
    Bash,
    Zsh,
    PowerShell,
    Cmd,
    Sh,
    Unknown,
}

impl ShellType {
    /// Detect shell type from the executable path / name.
    pub fn from_path(shell: &str) -> Self {
        let lower = shell.to_ascii_lowercase();
        // Check the basename (handle both `/usr/bin/zsh` and plain `zsh`)
        let base = lower.rsplit(&['/', '\\'][..]).next().unwrap_or(&lower);
        if base.starts_with("bash") {
            ShellType::Bash
        } else if base.starts_with("zsh") {
            ShellType::Zsh
        } else if base.starts_with("pwsh") || base.starts_with("powershell") {
            ShellType::PowerShell
        } else if base == "sh" || base == "sh.exe" {
            ShellType::Sh
        } else if base.starts_with("cmd") {
            ShellType::Cmd
        } else {
            ShellType::Unknown
        }
    }
}

// ---------------------------------------------------------------------------
// Command wrapping – embeds OSC 7701 markers around a user command
// ---------------------------------------------------------------------------

/// Build a shell-specific string that:
///   1. Emits  `\x1b]7701;S;<id>\x07`  (start marker)
///   2. Runs   the user command
///   3. Emits  `\x1b]7701;E;<id>;<exit_code>\x07`  (end marker)
pub fn wrap_command(shell_type: ShellType, command_id: &str, user_command: &str) -> String {
    match shell_type {
        ShellType::PowerShell => {
            // PowerShell: use [Console]::Write to emit raw bytes.
            // $LASTEXITCODE is set by native commands; $? covers cmdlet failures.
            format!(
                "[Console]::Write([char]27 + ']7701;S;{id}' + [char]7); \
                 {cmd}; \
                 $__ls_rc = $(if ($?) {{ if ($LASTEXITCODE -ne $null) {{ $LASTEXITCODE }} else {{ 0 }} }} else {{ 1 }}); \
                 [Console]::Write([char]27 + ']7701;E;{id};' + $__ls_rc + [char]7)\r\n",
                id = command_id,
                cmd = user_command,
            )
        }
        ShellType::Cmd => {
            // cmd.exe: embed literal ESC (0x1B) and BEL (0x07) bytes so that
            // echo writes the OSC 7701 markers directly to the console output.
            // %ERRORLEVEL% captures the exit code of the last command.
            format!(
                "echo \x1b]7701;S;{id}\x07 & ({cmd}) & echo \x1b]7701;E;{id};%ERRORLEVEL%\x07\r\n",
                id = command_id,
                cmd = user_command,
            )
        }
        ShellType::Bash | ShellType::Zsh | ShellType::Sh | ShellType::Unknown => {
            // POSIX shells: printf is the most portable way to emit arbitrary bytes.
            // Single-line semicolon chain avoids multi-line wrapper echo in the terminal.
            // PROMPT_COMMAND= clears the hook for this command only (no subshell leak).
            format!(
                "PROMPT_COMMAND= printf '\\033]7701;S;{id}\\007'; {cmd}; __ls_rc=$?; printf '\\033]7701;E;{id};%d\\007' \"$__ls_rc\"\n",
                id = command_id,
                cmd = user_command,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Command ID generation
// ---------------------------------------------------------------------------

static BLOCK_COUNTER: AtomicUsize = AtomicUsize::new(1);

pub fn generate_command_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = BLOCK_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("blk-{}-{}", ts, seq)
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct BlockCmdStartedPayload {
    pub session_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockCmdOutputPayload {
    pub session_id: String,
    pub command_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockCmdCompletedPayload {
    pub session_id: String,
    pub command_id: String,
    pub exit_code: i32,
}

// ---------------------------------------------------------------------------
// Marker types for the 3.0 callback-based API
// ---------------------------------------------------------------------------

/// Parsed OSC 7701 marker, returned to the caller via callback.
#[derive(Debug, Clone)]
pub enum Marker {
    Start {
        command_id: String,
        /// The raw user command extracted from the S marker payload.
        command: String,
    },
    End {
        command_id: String,
        exit_code: i32,
    },
}

// ---------------------------------------------------------------------------
// MarkerScanner – detects OSC 7701 markers inside raw PTY output chunks
// ---------------------------------------------------------------------------

/// OSC 7701 protocol prefix bytes: ESC ] 7 7 0 1 ;
const OSC_PREFIX: &[u8] = b"\x1b]7701;";
const OSC_TERMINATOR: u8 = 0x07; // BEL

pub struct MarkerScanner {
    /// Bytes carried over from a previous chunk where a partial OSC was detected
    leftover: Vec<u8>,
    /// Track the current command text between S and E markers.
    current_command: Option<String>,
}

impl MarkerScanner {
    pub fn new() -> Self {
        Self {
            leftover: Vec::new(),
            current_command: None,
        }
    }

    // ── 3.0 callback-based API (used by UnifiedStreamCore) ───────

    /// Scan a raw byte chunk for OSC 7701 markers, invoking `on_marker` for
    /// each complete marker found.  The callback receives the parsed `Marker`,
    /// the session id, and the app handle — it decides how to emit / route.
    pub fn scan_chunk_with_callback<F>(
        &mut self,
        chunk: &[u8],
        session_id: &str,
        app: &AppHandle,
        on_marker: F,
    ) where
        F: Fn(Marker, &str, &AppHandle),
    {
        let data = self.merge_leftover(chunk);
        let mut pos = 0;

        while pos < data.len() {
            let Some(offset) = memchr_esc(&data[pos..]) else {
                break;
            };
            let esc_pos = pos + offset;
            let remaining = &data[esc_pos..];

            if remaining.len() < OSC_PREFIX.len() {
                self.leftover = remaining.to_vec();
                return;
            }

            if remaining.starts_with(OSC_PREFIX) {
                let payload_start = esc_pos + OSC_PREFIX.len();
                let Some((bel_offset, _)) = find_osc_terminator(&data[payload_start..]) else {
                    self.leftover = remaining.to_vec();
                    return;
                };
                let bel_pos = payload_start + bel_offset;
                let payload = &data[payload_start..bel_pos];
                let payload_str = String::from_utf8_lossy(payload);

                if let Some(marker) = self.parse_marker(&payload_str) {
                    on_marker(marker, session_id, app);
                }

                pos = bel_pos + 1;
                continue;
            }

            pos = esc_pos + 1;
        }
    }

    /// Legacy API — kept for backward compatibility with shell.rs and
    /// connection.rs until they are migrated to UnifiedStreamCore.
    /// Emits block-cmd-started / block-cmd-completed directly.
    pub fn scan_chunk(&mut self, chunk: &[u8], session_id: &str, app: &AppHandle) {
        self.scan_chunk_with_callback(chunk, session_id, app, |marker, sid, app_handle| {
            match marker {
                Marker::Start { command_id, command: _ } => {
                    debug!("Block start marker: session={} cmd={}", sid, command_id);
                    let _ = app_handle.emit(
                        "block-cmd-started",
                        BlockCmdStartedPayload {
                            session_id: sid.to_string(),
                            command_id: command_id.clone(),
                        },
                    );
                }
                Marker::End { command_id, exit_code } => {
                    debug!("Block end marker: session={} cmd={} exit={}", sid, command_id, exit_code);
                    let _ = app_handle.emit(
                        "block-cmd-completed",
                        BlockCmdCompletedPayload {
                            session_id: sid.to_string(),
                            command_id,
                            exit_code,
                        },
                    );
                }
            }
        });
    }

    // ── Internals ───────────────────────────────────────────────

    fn merge_leftover(&mut self, chunk: &[u8]) -> Vec<u8> {
        if self.leftover.is_empty() {
            chunk.to_vec()
        } else {
            let mut combined = std::mem::take(&mut self.leftover);
            combined.extend_from_slice(chunk);
            combined
        }
    }

    fn parse_marker(&mut self, payload: &str) -> Option<Marker> {
        let parts: Vec<&str> = payload.splitn(3, ';').collect();
        match parts.as_slice() {
            ["S", command_id] => {
                let cmd = self.current_command.take().unwrap_or_default();
                Some(Marker::Start {
                    command_id: command_id.to_string(),
                    command: cmd,
                })
            }
            ["E", command_id, exit_code_str] => {
                let exit_code = exit_code_str.trim().parse::<i32>().unwrap_or(-1);
                Some(Marker::End {
                    command_id: command_id.to_string(),
                    exit_code,
                })
            }
            _ => {
                warn!("Unknown OSC 7701 payload: {}", payload);
                None
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

fn memchr_esc(haystack: &[u8]) -> Option<usize> {
    haystack.iter().position(|&b| b == 0x1b)
}

/// Find OSC terminator: BEL (0x07) or ESC\ (ST).
/// Returns (offset, terminator_len) or None.
fn find_osc_terminator(buf: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i < buf.len() {
        match buf[i] {
            OSC_TERMINATOR => return Some((i, 1)),
            0x1b if i + 1 < buf.len() && buf[i + 1] == b'\\' => return Some((i, 2)),
            _ => i += 1,
        }
    }
    None
}
