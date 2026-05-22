import { create } from 'zustand';
import type { SessionInfo, TerminalInstance } from '@/models/session';
import { generateSessionId, generateTerminalId } from '@/models/session';
import type { SessionMode } from '@/models/sessionData';
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionConfig } from '@/models/connection';
import { disposeCachedTerminal } from '@/hooks/useTerminal';

interface SessionState {
  sessions: Map<string, SessionInfo>;
  activeSessionId: string | null;

  /** Create a new session container (no backend connection). */
  addSession: (title?: string) => string;
  /** Remove a session and destroy all its terminals. */
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSessionStatus: (id: string, status: SessionInfo['status']) => void;
  setMode: (id: string, mode: SessionMode) => void;
  touch: (id: string) => void;

  /** Create a backend PTY and add it as a terminal tab in the given session. */
  addTerminal: (sessionId: string, config: ConnectionConfig, title?: string) => Promise<string>;
  /** Remove a terminal tab and destroy its backend PTY. */
  removeTerminal: (sessionId: string, terminalId: string) => Promise<void>;
  /** Switch the active terminal tab within a session. */
  setActiveTerminalIndex: (sessionId: string, index: number) => void;

  /** Move a terminal from position `fromIndex` to `toIndex` (no-op on backend). */
  moveTerminal: (sessionId: string, fromIndex: number, toIndex: number) => void;

  /**
   * Atomic operation: move hidden terminal into visible zone and activate it.
   * Moves the terminal at `fromIndex` (hidden) to `lastVisibleIdx` (last visible slot),
   * sets it as active, and shifts the displaced tab into the hidden zone.
   */
  cycleTerminalIntoView: (sessionId: string, fromIndex: number, lastVisibleIdx: number) => void;

  /** Toggle per-terminal logging for a tab. */
  toggleTerminalLogging: (sessionId: string, terminalId: string) => void;

  /** Resolve session/terminal metadata for a connectionId (used by logger). */
  resolveTerminalMeta: (connectionId: string) => {
    sessionName: string;
    terminalName: string;
    isLogging: boolean;
  } | null;

  /** Get the active terminal's backend connectionId, or null. */
  getActiveConnectionId: (sessionId: string) => string | null;

  /** Reconnect all saved terminals for a session (used on double-click / auto-restore). */
  restoreTerminals: (sessionId: string) => Promise<void>;

  /** Bulk-hydrate sessions from persistence. */
  hydrateSessions: (list: SessionInfo[], activeId?: string | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,

  addSession: (title?: string) => {
    const id = generateSessionId();
    const session: SessionInfo = {
      id,
      status: 'disconnected',
      title: title ?? id,
      createdAt: new Date().toISOString(),
      terminals: [],
      activeTerminalIndex: -1,
      lastAccessed: new Date().toISOString(),
    };
    set((state) => {
      const next = new Map(state.sessions);
      next.set(id, session);
      return { sessions: next, activeSessionId: id };
    });
    return id;
  },

  removeSession: (id) =>
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(id);
      // Destroy all PTY connections for this session
      if (session) {
        for (const term of session.terminals) {
          disposeCachedTerminal(term.connectionId);
          invoke('destroy_session', { sessionId: term.connectionId }).catch(() => {});
        }
      }
      next.delete(id);
      const activeSessionId =
        state.activeSessionId === id
          ? (next.keys().next().value ?? null)
          : state.activeSessionId;
      return { sessions: next, activeSessionId };
    }),

  setActiveSession: (id) =>
    set((state) => {
      if (!id) return { activeSessionId: null };
      const session = state.sessions.get(id);
      if (!session) return { activeSessionId: id };
      const next = new Map(state.sessions);
      next.set(id, { ...session, lastAccessed: new Date().toISOString() });
      return { activeSessionId: id, sessions: next };
    }),

  updateSessionStatus: (id, status) =>
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...session, status });
      return { sessions: next };
    }),

  setMode: (id, mode) =>
    set((state) => {
      const session = state.sessions.get(id);
      if (!session || session.mode === mode) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...session, mode });
      return { sessions: next };
    }),

  touch: (id) =>
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...session, lastAccessed: new Date().toISOString() });
      return { sessions: next };
    }),

  addTerminal: async (sessionId, config, title) => {
    // Create backend PTY/connection
    const connectionId: string = await invoke('create_session', { config });
    const termId = generateTerminalId();
    const baseTitle = title ?? `Terminal ${connectionId}`;

    // Deduplicate: if same title exists, append " (2)", " (3)", etc.
    const state = get();
    const session = state.sessions.get(sessionId);
    let deduped = baseTitle;
    if (session) {
      const existing = new Set(session.terminals.map((t) => t.title));
      if (existing.has(deduped)) {
        let n = 2;
        while (existing.has(`${baseTitle} (${n})`)) n++;
        deduped = `${baseTitle} (${n})`;
      }
    }

    const instance: TerminalInstance = {
      id: termId,
      title: deduped,
      connectionId,
      config,
      isLogging: false,
    };
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const next = new Map(state.sessions);
      const terminals = [...session.terminals, instance];
      next.set(sessionId, {
        ...session,
        status: 'connected',
        terminals,
        activeTerminalIndex: terminals.length - 1,
      });
      return { sessions: next };
    });
    return connectionId;
  },

  removeTerminal: async (sessionId, terminalId) => {
    const state = get();
    const session = state.sessions.get(sessionId);
    if (!session) return;
    const term = session.terminals.find((t) => t.id === terminalId);
    if (!term) return;
    // Destroy backend PTY and frontend terminal cache
    disposeCachedTerminal(term.connectionId);
    await invoke('destroy_session', { sessionId: term.connectionId }).catch(() => {});
    set((s) => {
      const cur = s.sessions.get(sessionId);
      if (!cur) return s;
      const next = new Map(s.sessions);
      const terminals = cur.terminals.filter((t) => t.id !== terminalId);
      const newIndex = Math.min(cur.activeTerminalIndex, terminals.length - 1);
      next.set(sessionId, {
        ...cur,
        terminals,
        activeTerminalIndex: newIndex,
        status: terminals.length === 0 ? 'disconnected' : cur.status,
      });
      return { sessions: next };
    });
  },

  setActiveTerminalIndex: (sessionId, index) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(sessionId, { ...session, activeTerminalIndex: index });
      return { sessions: next };
    }),

  moveTerminal: (sessionId, fromIndex, toIndex) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const terms = [...session.terminals];
      if (fromIndex < 0 || fromIndex >= terms.length) return state;
      if (toIndex < 0 || toIndex >= terms.length) return state;
      const [item] = terms.splice(fromIndex, 1);
      terms.splice(toIndex, 0, item);
      // Adjust activeTerminalIndex
      let newActive = session.activeTerminalIndex;
      if (session.activeTerminalIndex === fromIndex) {
        newActive = toIndex;
      } else if (fromIndex < session.activeTerminalIndex && toIndex >= session.activeTerminalIndex) {
        newActive = session.activeTerminalIndex - 1;
      } else if (fromIndex > session.activeTerminalIndex && toIndex <= session.activeTerminalIndex) {
        newActive = session.activeTerminalIndex + 1;
      }
      const next = new Map(state.sessions);
      next.set(sessionId, { ...session, terminals: terms, activeTerminalIndex: newActive });
      return { sessions: next };
    }),

  // Atomic: move hidden tab into view + activate — single set() avoids race
  cycleTerminalIntoView: (sessionId, fromIndex, lastVisibleIdx) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const terms = [...session.terminals];
      if (fromIndex < 0 || fromIndex >= terms.length) return state;
      const toIdx = Math.max(0, Math.min(lastVisibleIdx, terms.length - 1));
      if (fromIndex === toIdx) {
        // Already in position; just activate
        const next = new Map(state.sessions);
        next.set(sessionId, { ...session, activeTerminalIndex: toIdx });
        return { sessions: next };
      }
      const [item] = terms.splice(fromIndex, 1);
      terms.splice(toIdx, 0, item);
      const next = new Map(state.sessions);
      next.set(sessionId, { ...session, terminals: terms, activeTerminalIndex: toIdx });
      return { sessions: next };
    }),

  toggleTerminalLogging: (sessionId, terminalId) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(sessionId, {
        ...session,
        terminals: session.terminals.map((t) =>
          t.id === terminalId ? { ...t, isLogging: !t.isLogging } : t,
        ),
      });
      return { sessions: next };
    }),

  resolveTerminalMeta: (connectionId) => {
    for (const [, s] of get().sessions) {
      const term = s.terminals.find((t) => t.connectionId === connectionId);
      if (term) {
        return {
          sessionName: s.title || s.id,
          terminalName: term.title,
          isLogging: term.isLogging,
        };
      }
    }
    return null;
  },

  getActiveConnectionId: (sessionId) => {
    const session = get().sessions.get(sessionId);
    if (!session || session.activeTerminalIndex < 0) return null;
    return session.terminals[session.activeTerminalIndex]?.connectionId ?? null;
  },

  restoreTerminals: async (sessionId) => {
    const state = get();
    const session = state.sessions.get(sessionId);
    if (!session) return;

    // Destroy any existing (stale) terminals first
    for (const term of session.terminals) {
      disposeCachedTerminal(term.connectionId);
      invoke('destroy_session', { sessionId: term.connectionId }).catch(() => {});
    }

    // Clear terminals before reconnecting
    set((s) => {
      const cur = s.sessions.get(sessionId);
      if (!cur) return s;
      const next = new Map(s.sessions);
      next.set(sessionId, { ...cur, terminals: [], activeTerminalIndex: -1, status: 'disconnected' });
      return { sessions: next };
    });

    // Reconnect each saved terminal from its config
    const savedTerminals = [...session.terminals];
    for (const saved of savedTerminals) {
      if (saved.config) {
        try {
          await get().addTerminal(sessionId, saved.config, saved.title);
        } catch (e) {
          console.error(`[sessionStore] restoreTerminals: failed to reconnect ${saved.title}:`, e);
        }
      }
    }
  },

  hydrateSessions: (list, activeId) =>
    set(() => {
      const map = new Map<string, SessionInfo>();
      for (const s of list) map.set(s.id, s);
      return {
        sessions: map,
        activeSessionId: activeId ?? (list[0]?.id ?? null),
      };
    }),
}));
