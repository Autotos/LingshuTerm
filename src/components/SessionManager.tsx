import { useState, useCallback, useEffect } from 'react';
import {
  X,
  ChevronRight,
  ChevronDown,
  Wifi,
  Terminal,
  Cable,
  Trash2,
  Plus,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import {
  loadSessions,
  saveSessions,
  type SessionJsonEntry,
} from '@/lib/persistenceService';
import type { ConnectionConfig } from '@/models/connection';

// ─── SessionManager (Panel) ──────────────────────────────────

export function SessionManager() {
  const isVisible = useUiStore((s) => s.isSessionManagerVisible);
  const toggleSessionManager = useUiStore((s) => s.toggleSessionManager);
  const openTerminalModal = useUiStore((s) => s.openTerminalModal);
  const { sessions, addSession, setActiveSession, addTerminal } =
    useSessionStore();

  const [tree, setTree] = useState<SessionJsonEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load session.json when panel opens
  useEffect(() => {
    if (!isVisible) return;
    loadSessions()
      .then((data) => setTree(data.sessions ?? []))
      .catch((err) => console.warn('Failed to load session.json:', err));
  }, [isVisible]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Actions ────────────────────────────────────────────────

  /** Build a ConnectionConfig from a saved terminal entry. */
  const buildConfigFromEntry = useCallback(
    (t: SessionJsonEntry['terminals'][number]): ConnectionConfig => {
      if (t.config) return t.config as unknown as ConnectionConfig;
      // Fallback: reconstruct from flat fields
      const flat = t as Record<string, unknown>;
      switch (t.type) {
        case 'ssh':
          return {
            protocol: 'ssh',
            host: (flat.host as string) ?? '',
            port: (flat.port as number) ?? 22,
            username: (flat.user as string) ?? 'root',
            password: (flat.password as string) ?? '',
          };
        case 'telnet':
          return {
            protocol: 'telnet',
            host: (flat.host as string) ?? '',
            port: (flat.port as number) ?? 23,
          };
        case 'serial':
          return {
            protocol: 'serial',
            portName: (flat.portName as string) ?? '',
            baudRate: (flat.baudRate as number) ?? 115200,
            dataBits: (flat.dataBits as number) ?? 8,
            stopBits: (flat.stopBits as number) ?? 1,
            parity: (flat.parity as string) ?? 'none',
          };
        default:
          return { protocol: 'local', shell: '' };
      }
    },
    [],
  );

  /** Ensure session exists in the live store, return its id. */
  const ensureSession = useCallback(
    (entry: SessionJsonEntry): string => {
      const liveMap = useSessionStore.getState().sessions;
      if (!liveMap.has(entry.id)) {
        return addSession(entry.name);
      }
      return entry.id;
    },
    [addSession],
  );

  /** Double-click session: restore ALL its terminals. */
  const handleOpenSession = useCallback(
    async (entry: SessionJsonEntry) => {
      // 清除 dblclick 触发的浏览器文本选择，避免 Selection 存在时
      // xterm.textarea 虽已 focus 但键盘输入被 Selection 截获。
      window.getSelection()?.removeAllRanges();

      const sessionId = ensureSession(entry);
      setActiveSession(sessionId);
      toggleSessionManager();

      for (const t of entry.terminals) {
        const config = buildConfigFromEntry(t);
        await addTerminal(sessionId, config, t.name).catch((err) =>
          console.warn('Failed to restore terminal:', err),
        );
      }
    },
    [ensureSession, setActiveSession, toggleSessionManager, addTerminal, buildConfigFromEntry],
  );

  /** Double-click single terminal: open just that terminal with auto-connect. */
  const handleOpenTerminal = useCallback(
    async (entry: SessionJsonEntry, term: SessionJsonEntry['terminals'][number]) => {
      // 同 handleOpenSession：清除 dblclick 产生的 Selection。
      window.getSelection()?.removeAllRanges();

      const sessionId = ensureSession(entry);
      setActiveSession(sessionId);
      toggleSessionManager();

      const config = buildConfigFromEntry(term);
      await addTerminal(sessionId, config, term.name).catch((err) =>
        console.warn('Failed to connect terminal:', err),
      );
    },
    [ensureSession, setActiveSession, toggleSessionManager, addTerminal, buildConfigFromEntry],
  );

  const handleDeleteSession = useCallback(
    (entry: SessionJsonEntry) => {
      const next = tree.filter((s) => s.id !== entry.id);
      setTree(next);
      saveSessions({ sessions: next }).catch((err) =>
        console.warn('Failed to save session.json:', err),
      );
    },
    [tree],
  );

  const handleDeleteTerminal = useCallback(
    (sessionEntry: SessionJsonEntry, termIdx: number) => {
      const next = tree.map((s) => {
        if (s.id !== sessionEntry.id) return s;
        return {
          ...s,
          terminals: s.terminals.filter((_, i) => i !== termIdx),
        };
      });
      setTree(next);
      saveSessions({ sessions: next }).catch((err) =>
        console.warn('Failed to save session.json:', err),
      );
    },
    [tree],
  );

  const handleSaveCurrentSession = useCallback(() => {
    const liveMap = useSessionStore.getState().sessions;
    const activeId = useSessionStore.getState().activeSessionId;
    if (!activeId) return;
    const session = liveMap.get(activeId);
    if (!session) return;

    const entry: SessionJsonEntry = {
      id: session.id,
      name: session.title || session.id,
      terminals: session.terminals.map((t) => ({
        id: t.id,
        name: t.title,
        type: (t.config as any)?.protocol ?? 'unknown',
        config: t.config,
        ...(typeof t.config === 'object' ? (t.config as unknown as Record<string, unknown>) : {}),
      })),
    };

    const next = tree.some((s) => s.id === entry.id)
      ? tree.map((s) => (s.id === entry.id ? entry : s))
      : [...tree, entry];
    setTree(next);
    saveSessions({ sessions: next }).catch((err) =>
      console.warn('Failed to save session.json:', err),
    );
  }, [tree]);

  // ── Session label from live store ────────────────────────────

  const getLiveTitle = useCallback(
    (id: string) => {
      const s = sessions.get(id);
      return s?.title || id;
    },
    [sessions],
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={toggleSessionManager}
      />

      <div
        className={`fixed right-0 top-0 bottom-0 z-50 w-[320px] bg-[var(--deep)] border-l border-[var(--border)] flex flex-col shadow-2xl transition-transform duration-300 ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <span className="text-[12px] font-medium text-[var(--text-1)]">
            Session Manager
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleSaveCurrentSession}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--green)] hover:bg-[var(--veil)] transition-all"
              title="Save current session"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={toggleSessionManager}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--text-4)]">
              <Terminal className="w-8 h-8 opacity-30" />
              <span className="text-[11px]">No saved sessions</span>
              <span className="text-[10px] opacity-70">
                Save a session from the sidebar to see it here
              </span>
            </div>
          ) : (
            tree.map((entry) => {
              const isOpen = expanded.has(entry.id);
              return (
                <div key={entry.id}>
                  {/* Session row */}
                  <div
                    className="group flex items-center gap-1 py-1.5 px-2 rounded cursor-pointer text-[11px] hover:bg-[var(--veil)] transition-colors select-none"
                    onDoubleClick={() => handleOpenSession(entry)}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(entry.id);
                      }}
                      className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-3 h-3 text-[var(--text-4)]" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-[var(--text-4)]" />
                      )}
                    </button>
                    <span className="flex-1 min-w-0 truncate text-[var(--text-2)] group-hover:text-[var(--text-1)]">
                      {entry.name || getLiveTitle(entry.id)}
                    </span>
                    <span className="text-[10px] text-[var(--text-4)]">
                      {entry.terminals.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(entry);
                      }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--text-4)] hover:text-[var(--red)] hover:bg-[var(--veil)] transition-all"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Terminal children */}
                  {isOpen &&
                    entry.terminals.map((term, idx) => (
                      <div
                        key={term.id || idx}
                        className="group flex items-center gap-1 py-1 px-2 pl-8 rounded cursor-pointer text-[11px] text-[var(--text-3)] hover:bg-[var(--veil)] hover:text-[var(--text-1)] transition-colors select-none"
                        onDoubleClick={() => handleOpenTerminal(entry, term)}
                      >
                        {term.type === 'ssh' || term.type === 'telnet' ? (
                          <Wifi className="w-3 h-3 text-[var(--accent)] flex-shrink-0" />
                        ) : term.type === 'serial' ? (
                          <Cable className="w-3 h-3 text-[var(--purple)] flex-shrink-0" />
                        ) : (
                          <Terminal className="w-3 h-3 text-[var(--green)] flex-shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 truncate">{term.name || `Terminal ${idx + 1}`}</span>
                        <span className="text-[10px] text-[var(--text-4)] truncate max-w-[100px]">
                          {term.type}
                          {(term as any).host ? ` · ${(term as any).host}` : ''}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTerminal(entry, idx);
                          }}
                          className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded text-[var(--text-4)] hover:text-[var(--red)] transition-all"
                          title="Remove terminal"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}

                  {isOpen && (
                    <div
                      className="flex items-center gap-1 py-1 px-2 pl-8 rounded cursor-pointer text-[11px] text-[var(--text-4)] hover:bg-[var(--veil)] hover:text-[var(--text-1)] transition-colors"
                      onClick={() => {
                        // Ensure session exists for the modal
                        if (!sessions.has(entry.id)) {
                          addSession(entry.name);
                        }
                        openTerminalModal(entry.id);
                      }}
                    >
                      <Plus className="w-3 h-3" />
                      <span>New Terminal</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
