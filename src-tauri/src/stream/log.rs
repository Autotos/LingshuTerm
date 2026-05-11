//! Session timeline persistence — NDJSON append-only log.
//!
//! Each session gets a single `session.timeline.ndjson` file under its
//! workspace directory.  Every `SessionEvent` emitted from the unified stream
//! core is serialised to one JSON line and appended.
//!
//! ## File layout
//!
//! ```text
//! {workspace}/sessions/{session_id}/
//!   ├─ meta.json                 # session metadata (unchanged)
//!   ├─ session.timeline.ndjson   # ★ unified event log (replaces terminal.ndjson + blocks.json)
//!   └─ editor.json               # editor state (unchanged)
//! ```
//!
//! ## Migration from 2.0
//!
//! On first load, if `session.timeline.ndjson` does not exist but the 2.0
//! `terminal.ndjson` and/or `blocks.json` do, a migration routine merges them
//! into the new format.

use std::path::Path;

use serde::Serialize;
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;

use crate::persistence;

const TIMELINE_FILE: &str = "session.timeline.ndjson";

/// A single entry in the NDJSON timeline.
///
/// Mirrors the frontend `SessionEvent` type in `src/models/sessionData.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntry {
    /// Unique event id (e.g. "evt-1715328000000-001")
    pub id: String,
    /// The session this event belongs to
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// Event variant discriminator
    #[serde(rename = "type")]
    pub event_type: TimelineEventType,
    /// Variant-specific payload
    pub data: serde_json::Value,
    /// Unix timestamp in milliseconds
    pub ts: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TimelineEventType {
    Input,
    Output,
    CommandStart,
    CommandEnd,
    System,
}

/// Append a batch of timeline entries to the session's NDJSON file.
///
/// Each entry is written as one JSON line followed by `\n`.  The file is
/// opened in append mode — no read-modify-write round-trip.
pub async fn append_timeline_entries(
    app: &tauri::AppHandle,
    session_id: &str,
    entries: &[String],
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }

    let dir = persistence::session_dir_public(app, session_id)?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create_dir_all failed: {}", e))?;

    let path = dir.join(TIMELINE_FILE);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| format!("open {:?} failed: {}", path, e))?;

    let mut buf = String::with_capacity(entries.iter().map(|e| e.len() + 1).sum());
    for entry in entries {
        let s = entry.trim_end_matches(['\r', '\n']);
        buf.push_str(s);
        buf.push('\n');
    }
    file.write_all(buf.as_bytes())
        .await
        .map_err(|e| format!("write to {:?} failed: {}", path, e))?;

    Ok(())
}

/// Read the tail of the timeline file (last `limit` lines).
pub async fn read_timeline_tail(path: &Path, limit: usize) -> Result<Vec<String>, String> {
    persistence::read_terminal_tail_public(path, limit).await
}
