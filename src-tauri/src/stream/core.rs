//! Unified Stream Core — the heart of the 3.0 architecture.
//!
//! Replaces the old three-channel approach (MarkerScanner → block-cmd-*,
//! StreamCleaner → block-output, sanitize → pty-output) with a **single
//! pipeline** that processes each raw chunk and emits typed `SessionEvent`s
//! on one `session-event` Tauri channel.
//!
//! ## Pipeline (per chunk)
//!
//! ```text
//! raw_bytes
//!   ├─ 1. MarkerScanner  ──► OSC 7701 markers  ──► CommandStart / CommandEnd
//!   ├─ 2. StreamCleaner  ──► pure command output ──► BlockOutput
//!   └─ 3. sanitize_output ──► terminal-safe text  ──► Output
//! ```
//!
//! The three stages are independent — a single chunk can produce zero or more
//! events from each stage.  Events are emitted immediately via the provided
//! `AppHandle`.

use tauri::{AppHandle, Emitter};

use crate::block::MarkerScanner;
use crate::output_sanitizer::sanitize_output;
use crate::stream::event::SessionEvent;
use crate::stream_cleaner::StreamCleaner;

/// Holds the per-session state needed by the unified stream pipeline.
pub struct UnifiedStreamCore {
    marker_scanner: MarkerScanner,
    stream_cleaner: StreamCleaner,
    /// Debug-only: counts chunks processed for diagnostics.
    #[allow(dead_code)]
    chunk_count: u64,
}

impl UnifiedStreamCore {
    pub fn new() -> Self {
        Self {
            marker_scanner: MarkerScanner::new(),
            stream_cleaner: StreamCleaner::new(),
            chunk_count: 0,
        }
    }

    /// Process a raw byte chunk from PTY / SSH / Telnet / Serial.
    ///
    /// Events are emitted on `app` via the unified `session-event` channel.
    /// Call this for every chunk that arrives from the underlying I/O reader.
    pub fn process_chunk(
        &mut self,
        chunk: &[u8],
        session_id: &str,
        app: &AppHandle,
    ) {
        self.chunk_count = self.chunk_count.wrapping_add(1);
        self.emit_events(chunk, session_id, app);
    }

    /// Process a raw byte chunk with throttling (for SSH async loops).
    ///
    /// The throttle is applied AFTER emitting events, using tokio::sleep.
    /// This is called from SSH's tokio::select! loop to avoid blocking
    /// user input (rx.recv()) while still rate-limiting frontend events.
    pub async fn process_chunk_throttled(
        &mut self,
        chunk: &[u8],
        session_id: &str,
        app: &AppHandle,
    ) {
        self.chunk_count = self.chunk_count.wrapping_add(1);
        self.emit_events(chunk, session_id, app);

        // Apply throttle AFTER emitting — this sleeps the async task,
        // NOT the select! loop. User input (rx.recv()) is handled by
        // a different branch in the select!, so it's NOT blocked.
        let len = chunk.len();
        if len >= 2048 {
            tokio::time::sleep(tokio::time::Duration::from_millis(8)).await;
        } else if len >= 512 {
            tokio::time::sleep(tokio::time::Duration::from_millis(4)).await;
        } else if len >= 128 {
            tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
        } else {
            tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
        }
    }

    /// Common event emission logic (shared by process_chunk and process_chunk_throttled).
    fn emit_events(
        &mut self,
        chunk: &[u8],
        session_id: &str,
        app: &AppHandle,
    ) {
        self.chunk_count = self.chunk_count.wrapping_add(1);

        // ── Stage 1: OSC 7701 Marker Scanner ──────────────────────
        //
        // Must run on RAW bytes BEFORE sanitization, because sanitize_output
        // strips the OSC 7701 escape sequences.  The scanner emits
        // CommandStart / CommandEnd events.
        //
        // Pass a callback that receives the marker payload so we can also
        // capture the user command for CommandStart.
        self.marker_scanner
            .scan_chunk_with_callback(chunk, session_id, app, |marker, sid, app_handle| {
                match marker {
                    crate::block::Marker::Start { command_id, command } => {
                        SessionEvent::CommandStart {
                            session_id: sid.to_string(),
                            command_id,
                            command,
                        }
                        .emit(app_handle);
                    }
                    crate::block::Marker::End {
                        command_id,
                        exit_code,
                    } => {
                        SessionEvent::CommandEnd {
                            session_id: sid.to_string(),
                            command_id,
                            exit_code,
                        }
                        .emit(app_handle);
                    }
                }
            });

        // ── Stage 2: Stream Cleaner (OSC 133 state machine) ────────
        //
        // Extracts "pure" command output by stripping prompts, echoed input,
        // and shell-integration noise.  The result is the Blocks-view stream.
        let block_text = self.stream_cleaner.process_chunk(chunk);
        if !block_text.is_empty() {
            let _ = app.emit(
                "session-event",
                &SessionEvent::BlockOutput {
                    session_id: session_id.to_string(),
                    data: block_text,
                },
            );
        }

        // ── Stage 3: Sanitize and emit terminal output ─────────────
        //
        // Produces a faithful interactive stream for xterm.js: SGR colours
        // are preserved, but OSC sequences / printf echoes / `__ls_rc` lines
        // are stripped.
        let raw = String::from_utf8_lossy(chunk).to_string();
        let data = sanitize_output(raw);
        if !data.is_empty() {
            // Strip lines containing internal CWD query markers.
            // Must preserve all newlines (\n, \r\n) — the terminal relies on
            // them for correct line rendering.  Do NOT trim the result.
            let filtered = if data.contains("__CWD_") {
                data.lines()
                    .filter(|line| !line.contains("__CWD_"))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                data
            };
            if !filtered.is_empty() {
                let _ = app.emit(
                    "session-event",
                    &SessionEvent::Output {
                        session_id: session_id.to_string(),
                        data: filtered,
                    },
                );
            }
        }
    }

    /// Reset state (e.g. after a session reset / clear).
    pub fn reset(&mut self) {
        self.marker_scanner = MarkerScanner::new();
        self.stream_cleaner.reset();
    }
}
