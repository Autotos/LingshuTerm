import { useEffect, useRef } from 'react';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { EditorPanel } from './EditorPanel';
import { TerminalTabBar } from './TerminalTabBar';
import { UnifiedSessionPanel } from './UnifiedSessionPanel';
import { BottomInputArea } from './BottomInputArea';
import { SettingsModal } from './SettingsModal';
import { SessionTypeModal } from './SessionTypeModal';
import { TerminalConnectModal } from './TerminalConnectModal';
import { SessionManager } from './SessionManager';
import { StatusBar } from './StatusBar';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useBlockSession } from '@/hooks/useBlockSession';
import { useAiSubmit } from '@/hooks/useAiSubmit';
import { useTaskQueue } from '@/hooks/useTaskQueue';
import { usePersistenceBootstrap } from '@/hooks/usePersistenceBootstrap';

export function Layout() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const restoreTerminals = useSessionStore((s) => s.restoreTerminals);
  const { isEditorVisible, toggleEditor } = useUiStore();

  // Reactive selector: re-renders when activeTerminalIndex or terminals change
  const activeConnectionId = useSessionStore((s) => {
    if (!activeSessionId) return null;
    const session = s.sessions.get(activeSessionId);
    if (!session || session.activeTerminalIndex < 0) return null;
    return session.terminals[session.activeTerminalIndex]?.connectionId ?? null;
  });

  const persistence = usePersistenceBootstrap();

  const loadConnections = useConnectionStore((s) => s.loadFromDisk);
  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!persistence.ready) return;
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    const currentSessions = useSessionStore.getState().sessions;
    const currentActiveId = useSessionStore.getState().activeSessionId;

    if (currentSessions.size === 0) {
      // No restored sessions — create a Default session
      addSession('Default');
    } else if (currentActiveId) {
      // Restored sessions exist — auto-reconnect terminals for the active session
      const activeSession = currentSessions.get(currentActiveId);
      if (activeSession && activeSession.terminals.length > 0) {
        restoreTerminals(currentActiveId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence.ready]);

  // ── Hooks for BottomInputArea (use backend connection ID) ──
  const { executeCommand, isExecuting } = useBlockSession({ sessionId: activeConnectionId });
  const { submitAiQuery, isLoading: isAiLoading, error: aiError, clearError: clearAiError } =
    useAiSubmit({ sessionId: activeConnectionId });
  useTaskQueue({ sessionId: activeConnectionId });

  const sessionLabel = activeSessionId
    ? (sessions.get(activeSessionId)?.title ?? activeSessionId)
    : 'no session';

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--void)] text-[var(--text-1)] overflow-hidden font-mono">
      <TitleBar
        sessionName={sessionLabel}
        isEditorVisible={isEditorVisible}
        onToggleEditor={toggleEditor}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 flex flex-col min-w-0 bg-[var(--void)]">
          {/* ── Terminal tab bar ── */}
          <TerminalTabBar sessionId={activeSessionId} />

          {/* ── Terminal + Editor drawer ── */}
          <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
            <div className="flex-1 min-w-0 overflow-hidden">
              {/* One xterm.js instance per terminal tab — only active is visible */}
              {Array.from(sessions.values()).map((s) => {
                const isSessionActive = s.id === activeSessionId;
                return (
                  <div
                    key={`session-${s.id}`}
                    className={isSessionActive ? 'contents' : 'hidden'}
                  >
                    {s.terminals.map((term, idx) => {
                      const isActiveTerm = idx === s.activeTerminalIndex;
                      return (
                        <div
                          key={`term-${term.id}`}
                          className={isActiveTerm ? 'h-full flex flex-col' : 'hidden'}
                        >
                          <UnifiedSessionPanel
                            sessionId={term.connectionId}
                            isVisible={isActiveTerm}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Editor drawer */}
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                isEditorVisible
                  ? 'w-[500px] border-l border-[var(--border)]'
                  : 'w-0 border-l-0'
              }`}
            >
              <div className="w-[500px] h-full flex flex-col">
                <EditorPanel
                  sessionId={activeSessionId}
                  isVisible={isEditorVisible}
                />
              </div>
            </div>
          </div>

          {/* Bottom input bar */}
          <BottomInputArea
            sessionId={activeConnectionId}
            executeCommand={executeCommand}
            isExecuting={isExecuting}
            onAiSubmit={submitAiQuery}
            isAiLoading={isAiLoading}
            aiError={aiError}
            onClearAiError={clearAiError}
          />

          <StatusBar sessionId={activeSessionId} />
        </main>
      </div>

      <SettingsModal />
      <SessionTypeModal />
      <TerminalConnectModal />
      <SessionManager />
    </div>
  );
}
