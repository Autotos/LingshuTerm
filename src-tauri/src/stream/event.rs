//! Unified session event types for the 3.0 architecture.
//!
//! Instead of three separate Tauri event channels (`pty-output`, `block-output`,
//! `block-cmd-*`), the backend emits a single `session-event` carrying one of
//! these variants.  The frontend `useSessionStream` hook routes each variant to
//! the correct consumer (TerminalRenderer / BlocksRenderer / sessionLogStore).

use serde::Serialize;
use tauri::Emitter;

/// Top-level event emitted on the `session-event` Tauri channel.
///
/// Serialized as a tagged enum so the frontend can discriminate with a simple
/// `event.payload.type` check.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SessionEvent {
    /// Raw terminal output (after sanitization — SGR colours preserved,
    /// OSC / printf / `__ls_rc` noise removed).  Intended for xterm.js.
    Output {
        session_id: String,
        data: String,
    },

    /// A wrapped block command has started executing.
    /// Emitted when the OSC 7701 `S;<id>` marker is detected.
    CommandStart {
        session_id: String,
        command_id: String,
        command: String,
    },

    /// A wrapped block command has finished.
    /// Emitted when the OSC 7701 `E;<id>;<exit_code>` marker is detected.
    CommandEnd {
        session_id: String,
        command_id: String,
        exit_code: i32,
    },

    /// Pure command output (prompts, echoed input, and shell-integration noise
    /// removed by StreamCleaner).  Intended for Blocks view.
    BlockOutput {
        session_id: String,
        data: String,
    },

    /// The session has ended (PTY EOF / SSH channel close / error).
    SessionEnded {
        session_id: String,
    },

    /// A non-fatal error occurred on the session.
    SessionError {
        session_id: String,
        error: String,
    },
}

impl SessionEvent {
    /// Convenience: emit this event on an `AppHandle`.
    pub fn emit(&self, app: &tauri::AppHandle) {
        let _ = app.emit("session-event", self);
    }
}

// ---------------------------------------------------------------------------
// Internal helpers for constructing events
// ---------------------------------------------------------------------------

pub fn output(session_id: impl Into<String>, data: impl Into<String>) -> SessionEvent {
    SessionEvent::Output {
        session_id: session_id.into(),
        data: data.into(),
    }
}

pub fn command_start(
    session_id: impl Into<String>,
    command_id: impl Into<String>,
    command: impl Into<String>,
) -> SessionEvent {
    SessionEvent::CommandStart {
        session_id: session_id.into(),
        command_id: command_id.into(),
        command: command.into(),
    }
}

pub fn command_end(
    session_id: impl Into<String>,
    command_id: impl Into<String>,
    exit_code: i32,
) -> SessionEvent {
    SessionEvent::CommandEnd {
        session_id: session_id.into(),
        command_id: command_id.into(),
        exit_code,
    }
}

pub fn block_output(session_id: impl Into<String>, data: impl Into<String>) -> SessionEvent {
    SessionEvent::BlockOutput {
        session_id: session_id.into(),
        data: data.into(),
    }
}

pub fn session_ended(session_id: impl Into<String>) -> SessionEvent {
    SessionEvent::SessionEnded {
        session_id: session_id.into(),
    }
}

pub fn session_error(session_id: impl Into<String>, error: impl Into<String>) -> SessionEvent {
    SessionEvent::SessionError {
        session_id: session_id.into(),
        error: error.into(),
    }
}
