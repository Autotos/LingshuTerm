import { ChevronLeft, ChevronRight, Monitor, ListTodo, Plus, Save, Trash2 } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import { saveSessions } from '@/lib/persistenceService';
import { TaskBoard } from './TaskBoard';

export function Sidebar() {
  const { sessions, activeSessionId, setActiveSession, removeSession, restoreTerminals } =
    useSessionStore();
  const {
    sidebarCollapsed,
    toggleSidebar,
    sidebarTab,
    setSidebarTab,
    openCreateSessionModal,
    openTerminalModal,
  } = useUiStore();

  return (
    <aside
      className={`flex flex-col flex-shrink-0 bg-[var(--deep)] border-r border-[var(--border)] overflow-hidden transition-[width] duration-200 ${
        sidebarCollapsed ? 'w-[44px]' : 'w-[260px]'
      }`}
    >
      {/* Header with tabs */}
      <div
        className={`flex items-center border-b border-[var(--border)] min-h-[44px] ${
          sidebarCollapsed ? 'justify-center px-3' : 'justify-between px-2'
        }`}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-0.5">
            <SidebarTabBtn
              icon={<Monitor className="w-3 h-3" />}
              label="Sessions"
              active={sidebarTab === 'sessions'}
              onClick={() => setSidebarTab('sessions')}
            />
            <SidebarTabBtn
              icon={<ListTodo className="w-3 h-3" />}
              label="Tasks"
              active={sidebarTab === 'tasks'}
              onClick={() => setSidebarTab('tasks')}
            />
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="w-7 h-7 flex items-center justify-center rounded border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] hover:border-[var(--border)] transition-all"
          title={sidebarCollapsed ? 'Expand' : 'Collapse'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Content: Sessions or Tasks */}
      {sidebarTab === 'sessions' ? (
        <>
          {/* Session list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {Array.from(sessions.values()).map((session) => (
              <div
                key={session.id}
                onDoubleClick={() => {
                  setActiveSession(session.id);
                  restoreTerminals(session.id);
                }}
                className={`group flex items-center gap-1 rounded cursor-pointer text-xs whitespace-nowrap overflow-hidden transition-all ${
                  session.id === activeSessionId
                    ? 'bg-[var(--veil)] border border-[var(--border)] text-[var(--text-1)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--veil)] hover:text-[var(--text-1)]'
                } ${sidebarCollapsed ? 'justify-center px-2 py-2' : 'px-2 py-2'}`}
              >
                <div
                  className="flex items-center gap-2 flex-1 min-w-0"
                  onClick={() => setActiveSession(session.id)}
                >
                  <span
                    className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${
                      session.status === 'connected' ? 'bg-[var(--green)]' : 'bg-[var(--accent)]'
                    }`}
                  />
                  {!sidebarCollapsed && (
                    <span className="truncate">{session.title || session.id}</span>
                  )}
                </div>
                {!sidebarCollapsed && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openTerminalModal(session.id);
                      }}
                      title="Add terminal"
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Save ALL live sessions to the unified session.json
                        const allSessions = useSessionStore.getState().sessions;
                        const entries = Array.from(allSessions.values()).map((s) => ({
                          id: s.id,
                          name: s.title || s.id,
                          terminals: s.terminals.map((t) => {
                            const cfg = t.config as unknown as Record<string, unknown> | null;
                            return {
                              id: t.id,
                              name: t.title,
                              type: cfg?.protocol as string ?? 'unknown',
                              host: cfg?.host as string | undefined,
                              port: cfg?.port as number | undefined,
                              user: cfg?.username as string | undefined,
                              config: t.config,
                            };
                          }),
                        }));
                        saveSessions({ sessions: entries }).catch((err) =>
                          console.error('Failed to save sessions:', err),
                        );
                      }}
                      title="Save all sessions"
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--green)] hover:bg-[var(--veil)] transition-all"
                    >
                      <Save className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete session "${session.title || session.id}"?`)) {
                          removeSession(session.id);
                        }
                      }}
                      title="Delete session"
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--red)] hover:bg-[var(--veil)] transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Footer: "New Session" button */}
          <div className="p-2 border-t border-[var(--border)]">
            <button
              onClick={openCreateSessionModal}
              className={`w-full rounded bg-[var(--veil)] border border-[var(--border)] text-[var(--text-2)] text-[11px] tracking-wide cursor-pointer hover:text-[var(--text-1)] hover:border-[var(--border-hi)] transition-all ${
                sidebarCollapsed ? 'px-2 py-2 text-center' : 'px-3 py-2'
              }`}
              title="New session (Remote or Local)"
            >
              {sidebarCollapsed ? '+' : '+ New Session'}
            </button>
          </div>
        </>
      ) : (
        <TaskBoard sessionId={activeSessionId} collapsed={sidebarCollapsed} />
      )}
    </aside>
  );
}

function SidebarTabBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all ${
        active
          ? 'bg-[var(--veil)] border border-[var(--border)] text-[var(--text-1)]'
          : 'border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
