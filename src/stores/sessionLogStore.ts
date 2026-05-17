import { useMemo } from 'react';
import { create } from 'zustand';
import type { SessionEvent, SessionEventType, CommandGroup } from '@/models/sessionData';
import { deriveCommandGroups, generateEventId } from '@/models/sessionData';

// ─── Memory guards ────────────────────────────────────────────────

/** Max raw data bytes stored per output event (prevents OOM on massive output). */
const MAX_OUTPUT_DATA_BYTES = 256; // 256 bytes — enough for a preview
/** Max events per session before oldest are evicted. */
const MAX_EVENTS_PER_SESSION = 500;
/** Evict oldest N events when cap is exceeded. */
const EVICT_BATCH = 100;

function capOutputData(data: unknown): unknown {
  if (typeof data === 'object' && data !== null && 'data' in data) {
    const d = data as { data: string; [k: string]: unknown };
    if (typeof d.data === 'string' && d.data.length > MAX_OUTPUT_DATA_BYTES) {
      return { ...d, data: d.data.slice(0, MAX_OUTPUT_DATA_BYTES) + '…' };
    }
  }
  return data;
}

// ─── Store ────────────────────────────────────────────────────────
//
// Performance note: `appendLog` is called for every output chunk during
// high-throughput sessions (e.g. `du -h` can fire 1000+ times/sec).
// To avoid blocking the main thread:
//  1) Direct mutation of the events array (push) — O(1), no copy.
//  2) Zustand `set()` uses a shallow merge so only the changed ref propagates.
//  3) Eviction is O(k) where k = EVICT_BATCH, not O(n) total events.

interface SessionLogState {
  /** Per-session event timeline.  Keyed by sessionId.
   *  Each array is mutated in-place (push/shift) — selectors receive
   *  a new array reference only after eviction or explicit replace.
   */
  logs: Record<string, SessionEvent[]>;

  /** Append a single event to a session's timeline. O(1) — mutates in-place. */
  appendLog: (sessionId: string, type: SessionEventType, data: unknown) => void;

  /** Bulk-hydrate a session from persisted data. */
  hydrate: (sessionId: string, events: SessionEvent[]) => void;

  /** Clear all logs for a session. */
  clearSessionLogs: (sessionId: string) => void;

  /** Remove a session's log entry entirely. */
  removeSession: (sessionId: string) => void;
}

export const useSessionLogStore = create<SessionLogState>((set, get) => ({
  logs: {},

  appendLog: (sessionId, type, data) => {
    const capped = type === 'output' || type === 'block-output'
      ? capOutputData(data)
      : data;
    const event: SessionEvent = {
      id: generateEventId(),
      sessionId,
      type,
      data: capped,
      ts: Date.now(),
    };

    // Direct mutation — O(1) push, no array copy.
    const state = get();
    let events = state.logs[sessionId];
    if (!events) {
      events = [];
      // Create new reference so Zustand subscribers get notified.
      set((s) => ({
        logs: {
          ...s.logs,
          [sessionId]: events,
        },
      }));
    }

    events.push(event);

    // Evict oldest events when cap exceeded — O(EVICT_BATCH), not O(n).
    if (events.length > MAX_EVENTS_PER_SESSION) {
      const removeCount = events.length - MAX_EVENTS_PER_SESSION + EVICT_BATCH;
      // splice is O(n) but only shifts the tail, which is faster than full copy.
      events.splice(0, removeCount);
      // Notify subscribers of the new truncated array.
      set((s) => ({
        logs: {
          ...s.logs,
          [sessionId]: [...events], // new reference after eviction
        },
      }));
    }
  },

  hydrate: (sessionId, events) =>
    set((state) => ({
      logs: {
        ...state.logs,
        [sessionId]: events.slice(-MAX_EVENTS_PER_SESSION),
      },
    })),

  clearSessionLogs: (sessionId) =>
    set((state) => ({
      logs: {
        ...state.logs,
        [sessionId]: [],
      },
    })),

  removeSession: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.logs)) return state;
      const next = { ...state.logs };
      delete next[sessionId];
      return { logs: next };
    }),
}));

// ─── Selectors ─────────────────────────────────────────────────

/** Get raw events for a session. */
export function useSessionLogs(sessionId: string | null): SessionEvent[] {
  const logs = useSessionLogStore((s) => s.logs);
  return useMemo(
    () => (sessionId ? logs[sessionId] ?? [] : []),
    [logs, sessionId],
  );
}

/** Get derived command groups for Blocks view. */
export function useDerivedCommandGroups(sessionId: string | null): CommandGroup[] {
  const events = useSessionLogs(sessionId);
  return useMemo(() => deriveCommandGroups(events), [events]);
}
