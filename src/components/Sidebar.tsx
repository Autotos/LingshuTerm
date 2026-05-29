import { forwardRef } from 'react';
import { ChevronLeft, ChevronRight, Monitor, ListTodo, Plus, Trash2 } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import { TaskBoard } from './TaskBoard';

interface SidebarProps {
  sidebarWidth: number;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { sidebarWidth },
  ref,
) {
  const { sessions, activeSessionId, setActiveSession, removeSession } =
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
      ref={ref}
      className="flex flex-col flex-shrink-0 bg-[var(--deep)] border-r border-[var(--border)] overflow-hidden"
      style={{ width: sidebarCollapsed ? 44 : sidebarWidth }}
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
          className="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-colors"
          title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Content */}
      {!sidebarCollapsed && (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
            {sidebarTab === 'sessions' ? (
              <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={setActiveSession}
                onRemove={removeSession}
                onCreateSession={openCreateSessionModal}
              />
            ) : (
              <TaskBoard sessionId={activeSessionId} collapsed={false} />
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-[var(--border)] px-2 py-1.5 flex items-center gap-1">
            <button
              onClick={() => activeSessionId && openTerminalModal(activeSessionId)}
              disabled={!activeSessionId}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="新建终端"
            >
              <Plus className="w-3 h-3" />
              Terminal
            </button>
            <button
              onClick={() => {
                if (activeSessionId) {
                  removeSession(activeSessionId);
                }
              }}
              disabled={!activeSessionId}
              className="p-1 rounded text-[var(--text-3)] hover:text-[var(--red)] hover:bg-[var(--veil)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="删除会话"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
});

// ── Internal helpers ──────────────────────────────────────────────

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
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
        active
          ? 'bg-[var(--veil)] text-[var(--text-1)]'
          : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface SessionListProps {
  sessions: ReturnType<typeof useSessionStore.getState>['sessions'];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onCreateSession: () => void;
}

function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onRemove,
  onCreateSession,
}: SessionListProps) {
  if (sessions.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
        <span className="text-[11px] text-[var(--text-4)] text-center leading-relaxed">
          No sessions yet.
          <br />
          Create one to get started.
        </span>
        <button
          onClick={onCreateSession}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hi)] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Session
        </button>
      </div>
    );
  }

  return (
    <div className="py-1">
      {Array.from(sessions.values()).map((s) => (
        <div
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[11px] transition-colors ${
            s.id === activeSessionId
              ? 'bg-[var(--veil)] text-[var(--text-1)] border-r-2 border-[var(--accent)]'
              : 'text-[var(--text-2)] hover:bg-[var(--veil)] border-r-2 border-transparent'
          }`}
        >
          <Monitor className="w-3 h-3 flex-shrink-0 text-[var(--text-4)]" />
          <span className="flex-1 truncate">{s.title || s.id}</span>
          <span className="text-[9px] text-[var(--text-4)] tabular-nums">
            {s.terminals.length}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(s.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--text-4)] hover:text-[var(--red)] transition-all"
            title="删除会话"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
