import { useMemo } from 'react';
import { create } from 'zustand';
import type { SessionEvent, SessionEventType, CommandGroup } from '@/models/sessionData';
import { deriveCommandGroups, generateEventId } from '@/models/sessionData';

interface SessionLogState {
  /** Per-session event timeline.  Keyed by sessionId. */
  logs: Record<string, SessionEvent[]>;

  /** Append a single event to a session's timeline. */
  appendLog: (sessionId: string, type: SessionEventType, data: unknown) => void;

  /** Bulk-hydrate a session from persisted data. */
  hydrate: (sessionId: string, events: SessionEvent[]) => void;

  /** Clear all logs for a session. */
  clearSessionLogs: (sessionId: string) => void;

  /** Remove a session's log entry entirely. */
  removeSession: (sessionId: string) => void;
}

export const useSessionLogStore = create<SessionLogState>((set) => ({
  logs: {},

  appendLog: (sessionId, type, data) =>
    set((state) => {
      const event: SessionEvent = {
        id: generateEventId(),
        sessionId,
        type,
        data,
        ts: Date.now(),
      };
      const prev = state.logs[sessionId] ?? [];
      return {
        logs: {
          ...state.logs,
          [sessionId]: [...prev, event],
        },
      };
    }),

  hydrate: (sessionId, events) =>
    set((state) => ({
      logs: {
        ...state.logs,
        [sessionId]: events,
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
