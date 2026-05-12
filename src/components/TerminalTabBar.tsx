import { X, Plus, Circle } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import type { TerminalInstance } from '@/models/session';

interface TerminalTabBarProps {
  sessionId: string | null;
}

/**
 * Horizontal tab bar displaying terminals for the active session.
 * Each tab has a logging toggle dot (green=pulsing when recording, gray=stopped).
 */
export function TerminalTabBar({ sessionId }: TerminalTabBarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const setActiveTerminalIndex = useSessionStore((s) => s.setActiveTerminalIndex);
  const removeTerminal = useSessionStore((s) => s.removeTerminal);
  const toggleTerminalLogging = useSessionStore((s) => s.toggleTerminalLogging);
  const openTerminalModal = useUiStore((s) => s.openTerminalModal);

  const session = sessionId ? sessions.get(sessionId) : undefined;
  const terminals: TerminalInstance[] = session?.terminals ?? [];
  const activeIndex = session?.activeTerminalIndex ?? -1;

  if (!sessionId) return null;

  const handleAdd = () => {
    openTerminalModal(sessionId);
  };

  const handleClose = (idx: number) => {
    const term = terminals[idx];
    if (term) removeTerminal(sessionId, term.id);
  };

  return (
    <div className="h-8 bg-[var(--deep)] border-b border-[var(--border)] flex items-center flex-shrink-0 overflow-x-auto scrollbar-thin">
      {terminals.map((term, idx) => {
        const isActive = idx === activeIndex;
        return (
          <div
            key={term.id}
            onClick={() => setActiveTerminalIndex(sessionId, idx)}
            className={`group flex items-center gap-1.5 h-full px-3 text-[11px] cursor-pointer whitespace-nowrap border-r border-[var(--border)] transition-colors ${
              isActive
                ? 'bg-[var(--void)] text-[var(--text-1)]'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
            }`}
          >
            {/* Logging toggle dot */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTerminalLogging(sessionId, term.id);
              }}
              title={term.isLogging ? 'Stop logging' : 'Start logging'}
              className="flex-shrink-0"
            >
              <Circle
                className={`w-2 h-2 ${
                  term.isLogging
                    ? 'text-[var(--green)] animate-pulse fill-current'
                    : 'text-[var(--text-4)]'
                }`}
              />
            </button>

            <span className="truncate max-w-[160px]">{term.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose(idx);
              }}
              className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--elevated)] transition-opacity flex-shrink-0"
              title="Close terminal"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}

      <button
        onClick={handleAdd}
        className="h-full px-2 flex items-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-colors flex-shrink-0"
        title="New terminal"
      >
        <Plus className="w-3 h-3" />
      </button>

      {terminals.length === 0 && (
        <span className="text-[10px] text-[var(--text-4)] px-2">
          Click + to add a terminal
        </span>
      )}
    </div>
  );
}
