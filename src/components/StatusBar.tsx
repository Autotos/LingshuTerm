import { useState, useEffect } from 'react';
import { useSessionStore } from '@/stores/sessionStore';

interface StatusBarProps {
  sessionId: string | null;
}

export function StatusBar({ sessionId }: StatusBarProps) {
  const { sessions } = useSessionStore();
  const [clock, setClock] = useState(new Date().toTimeString().slice(0, 8));

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date().toTimeString().slice(0, 8));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeSession = sessionId ? sessions.get(sessionId) : null;

  return (
    <div className="h-6 bg-[var(--deep)] border-t border-[var(--border)] px-4 flex items-center gap-6 text-[10px] text-[var(--text-4)] flex-shrink-0">
      <span className="flex items-center gap-1">~/project</span>
      <span className="w-px h-[10px] bg-[var(--border)]" />
      <span className="flex items-center gap-1">main</span>
      <span className="w-px h-[10px] bg-[var(--border)]" />
      <span className="flex items-center gap-1">UTF-8</span>
      {activeSession && activeSession.terminals.length > 0 && (
        <>
          <span className="w-px h-[10px] bg-[var(--border)]" />
          <span className="flex items-center gap-1 text-[var(--accent)]">
            {activeSession.terminals.length} terminal{activeSession.terminals.length !== 1 ? 's' : ''}
          </span>
        </>
      )}
      <span className="w-px h-[10px] bg-[var(--border)]" />
      <span className="flex items-center gap-1 tabular-nums">{clock}</span>
      <span className="ml-auto flex items-center gap-1">
        <span
          className={`w-[6px] h-[6px] rounded-full ${
            sessionId ? 'bg-[var(--green)]' : 'bg-[var(--text-4)]'
          }`}
        />
        {sessionId ? 'Ready' : 'Idle'}
      </span>
    </div>
  );
}
