/**
 * Session 持久化薄封装
 *
 * 对应 src-tauri/src/persistence.rs 中的 invoke 命令。
 *
 * 3.0 新增:
 *   - append_timeline_batch  →  批量追加 session.timeline.ndjson
 *   - load_timeline          →  读取 timeline 尾部行
 *   - save_timeline_snapshot →  全量替换 timeline (用于 flush)
 *
 * 旧命令保留兼容 2.0 代码路径。
 */
import { invoke } from '@tauri-apps/api/core';

import type { BlocksData, EditorData, SessionMode } from '@/models/sessionData';

// ─── Meta / Blocks / Editor (2.0 compat) ──────────────────────

export interface SessionMetaPayload {
  id: string;
  name: string;
  mode: SessionMode;
  createdAt: string;
  lastAccessed: string;
  status?: string;
  terminals?: Array<{ id: string; title: string; connectionId: string; config: any }>;
}

export interface TerminalLogEntry {
  ts: number;
  stream: 'stdout' | 'stderr' | 'input' | 'system';
  data: string;
}

export interface SessionSnapshot {
  session_id: string;
  meta: SessionMetaPayload | null;
  blocks: BlocksData | null;
  editor: EditorData | null;
  terminal_tail: string[];
  /** 3.0: timeline ndjson tail lines (if available). */
  timeline_tail?: string[];
}

// ─── 2.0 commands (kept for backward compat) ──────────────────

export function saveSessionMeta(sessionId: string, meta: SessionMetaPayload): Promise<void> {
  return invoke('save_session_meta', { sessionId, meta });
}

export function saveSessionBlocks(sessionId: string, blocks: BlocksData): Promise<void> {
  return invoke('save_session_blocks', { sessionId, blocks });
}

export function saveSessionEditor(sessionId: string, editor: EditorData): Promise<void> {
  return invoke('save_session_editor', { sessionId, editor });
}

export function appendTerminalLog(sessionId: string, entry: TerminalLogEntry): Promise<void> {
  return invoke('append_terminal_log', {
    sessionId,
    entry: JSON.stringify(entry),
  });
}

export function appendTerminalBatch(
  sessionId: string,
  entries: TerminalLogEntry[],
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  return invoke('append_terminal_batch', {
    sessionId,
    entries: entries.map((e) => JSON.stringify(e)),
  });
}

export function loadSession(sessionId: string, tailLimit?: number): Promise<SessionSnapshot> {
  return invoke('load_session', { sessionId, tailLimit });
}

export function listSessions(): Promise<string[]> {
  return invoke('list_sessions');
}

export function clearSession(sessionId: string): Promise<void> {
  return invoke('clear_session', { sessionId });
}

/** Export session data to a standalone JSON file in the workspace root. */
export function saveSessionExport(
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  return invoke('save_session_export', { sessionId, data });
}

// ─── 4.0 Unified session.json ──────────────────────────────────

export interface SessionJsonEntry {
  id: string;
  name: string;
  terminals: Array<{
    id: string;
    name: string;
    type: string;
    config?: unknown;
    [key: string]: unknown;
  }>;
}

export interface SessionJsonFile {
  sessions: SessionJsonEntry[];
}

/** Load the unified session.json from the workspace root. */
export function loadSessions(): Promise<SessionJsonFile> {
  return invoke<SessionJsonFile>('load_sessions');
}

/** Save the unified session.json to the workspace root (atomic). */
export function saveSessions(data: SessionJsonFile): Promise<void> {
  return invoke('save_sessions', { data });
}

// ─── 3.0 Timeline commands ────────────────────────────────────

/**
 * Batch-append timeline entries to session.timeline.ndjson.
 * Each entry is already a single-line JSON string.
 */
export function appendTimelineBatch(
  sessionId: string,
  entries: string[],
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  return invoke('append_timeline_batch', {
    sessionId,
    entries,
  });
}

/**
 * Load timeline tail lines from session.timeline.ndjson.
 * Reuses the Rust `load_session` pipeline — timeline_tail is the
 * terminal_tail field under the new filename.
 */
export async function loadTimeline(
  sessionId: string,
  tailLimit?: number,
): Promise<{ lines: string[] }> {
  const snap = await invoke<SessionSnapshot>('load_session', {
    sessionId,
    tailLimit,
  });
  return {
    lines: snap.timeline_tail ?? snap.terminal_tail ?? [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Safely parse NDJSON lines into TerminalLogEntry[].
 * Invalid lines are skipped rather than throwing.
 */
export function parseTerminalTail(lines: string[]): TerminalLogEntry[] {
  const out: TerminalLogEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as TerminalLogEntry;
      if (typeof obj?.data === 'string') out.push(obj);
    } catch {
      out.push({ ts: Date.now(), stream: 'stdout', data: trimmed });
    }
  }
  return out;
}
