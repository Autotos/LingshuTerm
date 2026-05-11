/**
 * Session 持久化订阅编排
 *
 * 3.0 changes:
 *  - Adds a 5th subscription for `sessionLogStore`, writing the unified
 *    SessionEvent timeline to `session.timeline.ndjson`.
 *  - The existing terminal.ndjson and blocks.json subscriptions are kept
 *    for backward compatibility and will be removed in a later cleanup phase.
 *
 * 职责：
 *  1) 监听 5 个 store 的变更，debounced 写回磁盘
 *  2) restoreAll(): 启动恢复 → hydrate stores
 *  3) flushAll(): 窗口关闭前强制落盘
 */
import type { CommandBlock } from '@/models/block';
import type { SessionInfo } from '@/models/session';
import type { BlocksData, EditorData, SessionMode, SessionEvent } from '@/models/sessionData';
import type { TaskGroup } from '@/models/task';

import {
  appendTerminalBatch,
  appendTimelineBatch,
  clearSession as clearSessionCmd,
  listSessions,
  loadSession,
  saveSessionBlocks,
  saveSessionEditor,
  saveSessionMeta,
  type SessionMetaPayload,
  type TerminalLogEntry,
} from './persistenceService';

import { useCommandStore } from '@/stores/commandStore';
import { useEditorStore } from '@/stores/editorStore';
import { useSessionLogStore } from '@/stores/sessionLogStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useTaskStore } from '@/stores/taskStore';

// ─── Global state ─────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 400;
const TERM_FLUSH_MS = 200;
const TERM_FLUSH_BYTES = 16 * 1024;

let paused = false;

const metaTimers = new Map<string, ReturnType<typeof setTimeout>>();
const blocksTimers = new Map<string, ReturnType<typeof setTimeout>>();
const editorTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface TermBuffer {
  entries: TerminalLogEntry[];
  byteCount: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const termBuffers = new Map<string, TermBuffer>();

/** 3.0: Timeline buffer — collects SessionEvent JSON strings for session.timeline.ndjson. */
interface TimelineBuffer {
  lines: string[];
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const timelineBuffers = new Map<string, TimelineBuffer>();

const disposers: Array<() => void> = [];
let started = false;

// ─── Scheduling helpers ───────────────────────────────────────

function schedule(
  map: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
  fn: () => Promise<void> | void,
) {
  if (paused) return;
  const prev = map.get(key);
  if (prev) clearTimeout(prev);
  const handle = setTimeout(async () => {
    map.delete(key);
    try {
      await fn();
    } catch (e) {
      console.error(`[persistence] save ${key} failed:`, e);
    }
  }, SAVE_DEBOUNCE_MS);
  map.set(key, handle);
}

async function flushTimers(
  map: Map<string, ReturnType<typeof setTimeout>>,
  executors: Map<string, () => Promise<void> | void>,
) {
  const keys = Array.from(map.keys());
  for (const k of keys) {
    const h = map.get(k);
    if (h) clearTimeout(h);
    map.delete(k);
  }
  await Promise.allSettled(keys.map((k) => executors.get(k)?.()));
}

function toMetaPayload(info: SessionInfo): SessionMetaPayload {
  const now = new Date().toISOString();
  return {
    id: info.id,
    name: info.title || info.id,
    mode: (info.mode as SessionMode) ?? 'terminal',
    createdAt: info.createdAt ?? now,
    lastAccessed: info.lastAccessed ?? now,
    status: info.status,
    terminals: info.terminals.map((t) => ({
      id: t.id,
      title: t.title,
      connectionId: t.connectionId,
      config: t.config,
    })),
  };
}

function buildBlocksData(sessionId: string): BlocksData {
  const blocks = useCommandStore
    .getState()
    .blocks.filter((b) => b.sessionId === sessionId);
  const groups = useTaskStore
    .getState()
    .groups.filter((g) => g.sessionId === sessionId);
  return {
    type: 'blocks',
    tasks: blocks,
    currentFlow: groups[0]?.query ?? '',
    taskGroups: groups,
  };
}

// ─── Timeline buffer ──────────────────────────────────────────

function flushTimelineBuffer(sessionId: string): void {
  const buf = timelineBuffers.get(sessionId);
  if (!buf) return;
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  if (buf.lines.length === 0) return;
  const lines = buf.lines;
  buf.lines = [];
  buf.count = 0;
  appendTimelineBatch(sessionId, lines).catch((e) =>
    console.debug('[persistence] append_timeline_batch failed:', e),
  );
}

function persistTimelineEvent(sessionId: string, eventJson: string): void {
  if (paused || !sessionId || !eventJson) return;
  let buf = timelineBuffers.get(sessionId);
  if (!buf) {
    buf = { lines: [], count: 0, timer: null };
    timelineBuffers.set(sessionId, buf);
  }
  buf.lines.push(eventJson);
  buf.count++;

  if (buf.count >= 64) {
    flushTimelineBuffer(sessionId);
    return;
  }
  if (!buf.timer) {
    buf.timer = setTimeout(() => {
      flushTimelineBuffer(sessionId);
    }, SAVE_DEBOUNCE_MS);
  }
}

// ─── SessionEvent → JSON ──────────────────────────────────────

function serializeSessionEvent(ev: SessionEvent): string {
  return JSON.stringify({
    id: ev.id,
    sessionId: ev.sessionId,
    type: ev.type,
    data: ev.data,
    ts: ev.ts,
  });
}

// ─── Subscription management ──────────────────────────────────

export function startPersistenceSubscriptions() {
  if (started) return;
  started = true;

  // -- 1) sessionStore → meta.json --
  const unsubSession = useSessionStore.subscribe((state, prev) => {
    if (state.sessions === prev.sessions) return;
    for (const [id, session] of state.sessions) {
      if (prev.sessions.get(id) !== session) {
        schedule(metaTimers, id, () => saveSessionMeta(id, toMetaPayload(session)));
      }
    }
    for (const [id] of prev.sessions) {
      if (!state.sessions.has(id)) {
        cancelPendingFor(id);
        clearSessionCmd(id).catch((e) =>
          console.error(`[persistence] clear_session(${id}) failed:`, e),
        );
      }
    }
  });
  disposers.push(unsubSession);

  // -- 2) commandStore → blocks.json (2.0 compat) --
  const unsubCommand = useCommandStore.subscribe((state, prev) => {
    if (state.blocks === prev.blocks) return;
    const changed = diffSessionIds(prev.blocks, state.blocks, (b) => b.sessionId, (b) => b.id);
    for (const sid of changed) {
      schedule(blocksTimers, sid, () => saveSessionBlocks(sid, buildBlocksData(sid)));
    }
  });
  disposers.push(unsubCommand);

  // -- 3) taskStore → blocks.json (2.0 compat) --
  const unsubTask = useTaskStore.subscribe((state, prev) => {
    if (state.groups === prev.groups) return;
    const changed = diffSessionIds(prev.groups, state.groups, (g) => g.sessionId, (g) => g.id);
    for (const sid of changed) {
      schedule(blocksTimers, sid, () => saveSessionBlocks(sid, buildBlocksData(sid)));
    }
  });
  disposers.push(unsubTask);

  // -- 4) editorStore → editor.json --
  const unsubEditor = useEditorStore.subscribe((state, prev) => {
    if (state.bySession === prev.bySession) return;
    const keys = new Set<string>([
      ...Object.keys(state.bySession),
      ...Object.keys(prev.bySession),
    ]);
    for (const sid of keys) {
      if (state.bySession[sid] !== prev.bySession[sid]) {
        const data = state.bySession[sid];
        if (data) {
          schedule(editorTimers, sid, () => saveSessionEditor(sid, data));
        }
      }
    }
  });
  disposers.push(unsubEditor);

  // -- 5) sessionLogStore → session.timeline.ndjson (3.0) --
  const unsubLog = useSessionLogStore.subscribe((state, prev) => {
    if (state.logs === prev.logs) return;
    // Diff: find which sessions have new events appended
    const allKeys = new Set([
      ...Object.keys(state.logs),
      ...Object.keys(prev.logs),
    ]);
    for (const sid of allKeys) {
      const cur = state.logs[sid] ?? [];
      const old = prev.logs[sid] ?? [];
      if (cur.length > old.length) {
        // Append only new events
        const newEvents = cur.slice(old.length);
        for (const ev of newEvents) {
          persistTimelineEvent(sid, serializeSessionEvent(ev));
        }
      }
    }
  });
  disposers.push(unsubLog);
}

export function stopPersistenceSubscriptions() {
  for (const d of disposers) {
    try { d(); } catch { /* ignore */ }
  }
  disposers.length = 0;
  started = false;
}

// ─── Diff helpers ─────────────────────────────────────────────

function diffSessionIds<T>(
  prev: T[],
  next: T[],
  sidOf: (x: T) => string,
  idOf: (x: T) => string,
): Set<string> {
  const changed = new Set<string>();
  const prevById = new Map(prev.map((x) => [idOf(x), x]));
  const nextById = new Map(next.map((x) => [idOf(x), x]));
  for (const [k, v] of nextById) {
    if (prevById.get(k) !== v) changed.add(sidOf(v));
  }
  for (const [k, v] of prevById) {
    if (!nextById.has(k)) changed.add(sidOf(v));
  }
  return changed;
}

// ─── Restore ──────────────────────────────────────────────────

export async function restoreAllSessions(options?: { terminalTailLimit?: number }) {
  paused = true;
  try {
    const ids = await listSessions();
    if (ids.length === 0) return { restoredCount: 0, activeId: null };

    const snapshots = await Promise.all(
      ids.map((id) =>
        loadSession(id, options?.terminalTailLimit).catch((e) => {
          console.error(`[persistence] loadSession(${id}) failed:`, e);
          return null;
        }),
      ),
    );

    const sessionInfos: SessionInfo[] = [];
    for (const snap of snapshots) {
      if (!snap || !snap.meta) continue;
      const m = snap.meta;
      const info: SessionInfo = {
        id: m.id,
        status: (m.status as SessionInfo['status']) ?? 'disconnected',
        title: m.name ?? m.id,
        createdAt: m.createdAt ?? new Date().toISOString(),
        mode: m.mode,
        lastAccessed: m.lastAccessed,
        terminals: (m as any).terminals ?? [],
        activeTerminalIndex: -1,
      };
      sessionInfos.push(info);

      // 2.0 compat: blocks.json → commandStore + taskStore
      if (snap.blocks) {
        const bd = snap.blocks;
        useCommandStore.getState().setSessionBlocks(m.id, bd.tasks as CommandBlock[]);
        useTaskStore.getState().setSessionGroups(m.id, (bd.taskGroups ?? []) as TaskGroup[]);
      }

      // editor.json
      if (snap.editor) {
        useEditorStore.getState().hydrate(m.id, snap.editor as EditorData);
      }

      // 3.0: restore timeline from session.timeline.ndjson tail
      const timelineLines = snap.timeline_tail ?? snap.terminal_tail ?? [];
      if (timelineLines.length > 0) {
        const events = parseTimelineLines(timelineLines, m.id);
        if (events.length > 0) {
          useSessionLogStore.getState().hydrate(m.id, events);
        }
      }
    }

    sessionInfos.sort((a, b) =>
      (b.lastAccessed ?? '').localeCompare(a.lastAccessed ?? ''),
    );
    const activeId = sessionInfos[0]?.id ?? null;
    useSessionStore.getState().hydrateSessions(sessionInfos, activeId);

    return { restoredCount: sessionInfos.length, activeId };
  } finally {
    paused = false;
  }
}

// ─── Parse timeline NDJSON ────────────────────────────────────

function parseTimelineLines(lines: string[], sessionId: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj.type === 'string' && obj.sessionId === sessionId) {
        events.push({
          id: obj.id ?? `evt-${obj.ts ?? Date.now()}`,
          sessionId: obj.sessionId,
          type: obj.type,
          data: obj.data,
          ts: obj.ts ?? Date.now(),
        });
      }
    } catch {
      // skip corrupted lines
    }
  }
  return events;
}

// ─── Flush ────────────────────────────────────────────────────

export async function flushAll() {
  const metaExecutors = new Map<string, () => Promise<void>>();
  for (const id of metaTimers.keys()) {
    const session = useSessionStore.getState().sessions.get(id);
    if (session) {
      metaExecutors.set(id, () => saveSessionMeta(id, toMetaPayload(session)));
    }
  }
  const blocksExecutors = new Map<string, () => Promise<void>>();
  for (const id of blocksTimers.keys()) {
    blocksExecutors.set(id, () => saveSessionBlocks(id, buildBlocksData(id)));
  }
  const editorExecutors = new Map<string, () => Promise<void>>();
  for (const id of editorTimers.keys()) {
    const data = useEditorStore.getState().bySession[id];
    if (data) editorExecutors.set(id, () => saveSessionEditor(id, data));
  }

  // 3.0: Flush all timeline buffers
  const timelineFlushes = Array.from(timelineBuffers.keys()).map((sid) => {
    const buf = timelineBuffers.get(sid);
    if (!buf) return Promise.resolve();
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = null;
    if (buf.lines.length === 0) return Promise.resolve();
    const lines = [...buf.lines];
    buf.lines = [];
    buf.count = 0;
    return appendTimelineBatch(sid, lines);
  });

  await Promise.allSettled([
    flushTimers(metaTimers, metaExecutors),
    flushTimers(blocksTimers, blocksExecutors),
    flushTimers(editorTimers, editorExecutors),
    ...Array.from(termBuffers.keys()).map((sid) => flushTerminalBuffer(sid)),
    ...timelineFlushes,
  ]);
}

// ─── Terminal chunk (kept for backward compat) ────────────────

export function persistTerminalChunk(
  sessionId: string,
  stream: 'stdout' | 'stderr' | 'input' | 'system',
  data: string,
) {
  if (paused || !sessionId || !data) return;
  let buf = termBuffers.get(sessionId);
  if (!buf) {
    buf = { entries: [], byteCount: 0, timer: null };
    termBuffers.set(sessionId, buf);
  }
  buf.entries.push({ ts: Date.now(), stream, data });
  buf.byteCount += data.length;

  if (buf.byteCount >= TERM_FLUSH_BYTES) {
    void flushTerminalBuffer(sessionId);
    return;
  }
  if (!buf.timer) {
    buf.timer = setTimeout(() => {
      void flushTerminalBuffer(sessionId);
    }, TERM_FLUSH_MS);
  }
}

async function flushTerminalBuffer(sessionId: string) {
  const buf = termBuffers.get(sessionId);
  if (!buf) return;
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  if (buf.entries.length === 0) return;
  const entries = buf.entries;
  buf.entries = [];
  buf.byteCount = 0;
  try {
    await appendTerminalBatch(sessionId, entries);
  } catch (e) {
    console.debug('[persistence] append_terminal_batch failed:', e);
  }
}

function cancelPendingFor(sessionId: string) {
  for (const map of [metaTimers, blocksTimers, editorTimers]) {
    const h = map.get(sessionId);
    if (h) {
      clearTimeout(h);
      map.delete(sessionId);
    }
  }
  const termBuf = termBuffers.get(sessionId);
  if (termBuf) {
    if (termBuf.timer) clearTimeout(termBuf.timer);
    termBuffers.delete(sessionId);
  }
  const tlBuf = timelineBuffers.get(sessionId);
  if (tlBuf) {
    if (tlBuf.timer) clearTimeout(tlBuf.timer);
    timelineBuffers.delete(sessionId);
  }
}
