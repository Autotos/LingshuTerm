import { useEffect, useRef, useState } from 'react';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { EditorPanel } from './EditorPanel';
import { SftpPanel } from './SftpPanel';
import { TerminalTabBar } from './TerminalTabBar';
import { UnifiedSessionPanel } from './UnifiedSessionPanel';
import { BottomInputArea } from './BottomInputArea';
import { OutputPanel } from './OutputPanel';
import { SettingsModal } from './SettingsModal';
import { SessionTypeModal } from './SessionTypeModal';
import { TerminalConnectModal } from './TerminalConnectModal';
import { SessionManager } from './SessionManager';
import { LogViewer } from './LogViewer';
import { ServerManagementModal } from './ServerManagementModal';
import { StatusBar } from './StatusBar';
import { ConfirmDialog } from './ConfirmDialog';
import { Resizer } from './Resizer';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useBlockSession } from '@/hooks/useBlockSession';
import { useAiSubmit } from '@/hooks/useAiSubmit';
import { useTaskQueue } from '@/hooks/useTaskQueue';
import { usePersistenceBootstrap } from '@/hooks/usePersistenceBootstrap';

export function Layout() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const {
    isEditorVisible,
    isSftpVisible,
    toggleEditor,
    toggleSftp,
    sidebarWidth,
    setSidebarWidth,
    outputHeight,
    setOutputHeight,
  } = useUiStore();
  const [logsOpen, setLogsOpen] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Reactive selector: re-renders when activeTerminalIndex or terminals change
  const activeConnectionId = useSessionStore((s) => {
    if (!activeSessionId) return null;
    const session = s.sessions.get(activeSessionId);
    if (!session || session.activeTerminalIndex < 0) return null;
    return session.terminals[session.activeTerminalIndex]?.connectionId ?? null;
  });

  const persistence = usePersistenceBootstrap();

  const loadConnections = useConnectionStore((s) => s.loadFromDisk);
  const loadSettings = useSettingsStore((s) => s.loadFromDisk);
  useEffect(() => {
    loadConnections();
    loadSettings();
  }, [loadConnections, loadSettings]);

  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!persistence.ready) return;
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence.ready]);

  // ── Hooks for BottomInputArea (use backend connection ID) ──
  const { executeCommand, isExecuting } = useBlockSession({ sessionId: activeConnectionId });
  const {
    submitAiQuery,
    cancelAiQuery,
    isLoading: isAiLoading,
    error: aiError,
    clearError: clearAiError,
    confirmDialog,
  } = useAiSubmit({ sessionId: activeConnectionId });
  useTaskQueue({ sessionId: activeConnectionId });

  const sessionLabel = activeSessionId
    ? (sessions.get(activeSessionId)?.title ?? activeSessionId)
    : 'no session';

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--void)] text-[var(--text-1)] overflow-hidden font-mono">
      <TitleBar
        sessionName={sessionLabel}
        isEditorVisible={isEditorVisible}
        isSftpVisible={isSftpVisible}
        onToggleEditor={toggleEditor}
        onToggleSftp={toggleSftp}
        onToggleLogs={() => setLogsOpen((v) => !v)}
        onToggleServers={() => setServersOpen((v) => !v)}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar ref={sidebarRef} sidebarWidth={sidebarWidth} />

        {/* Sidebar resizer — vertical dragger */}
        <Resizer
          axis="x"
          currentSize={sidebarWidth}
          minSize={200}
          maxSize={500}
          onResize={setSidebarWidth}
          targetRef={sidebarRef}
        />

        <main className="flex-1 flex flex-col min-w-0 bg-[var(--void)]">
          {/* ── Terminal tab bar ── */}
          <TerminalTabBar sessionId={activeSessionId} />

          {/* ── Terminal + Editor drawer ── */}
          <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
            {/* Stack terminals with absolute positioning — inactive ones render
                offscreen to keep WebGL contexts alive, avoiding "context not restored"
                errors and blank screens on tab switch. */}
            <div className="flex-1 min-w-0 overflow-hidden relative">
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
                          className={`absolute flex flex-col min-h-0 ${
                            isActiveTerm
                              ? 'inset-0 z-10'
                              : 'z-0'
                          }`}
                          style={
                            isActiveTerm
                              ? undefined
                              : { top: 0, left: '-9999px', width: '100%', height: '100%' }
                          }
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

            {/* SFTP file explorer drawer — only relevant for SSH sessions */}
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                isSftpVisible
                  ? 'w-[320px] border-l border-[var(--border)]'
                  : 'w-0 border-l-0'
              }`}
            >
              <div className="w-[320px] h-full flex flex-col">
                <SftpPanel sessionId={activeConnectionId} />
              </div>
            </div>
          </div>

          {/* Output resizer — horizontal dragger */}
          <Resizer
            axis="y"
            currentSize={outputHeight}
            minSize={100}
            maxSize={600}
            onResize={setOutputHeight}
            targetRef={outputRef}
          />

          {/* Output panel */}
          <OutputPanel ref={outputRef} outputHeight={outputHeight} />

          {/* Bottom input bar */}
          <BottomInputArea
            sessionId={activeConnectionId}
            executeCommand={executeCommand}
            isExecuting={isExecuting}
            onAiSubmit={submitAiQuery}
            onAiCancel={cancelAiQuery}
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
      <LogViewer isOpen={logsOpen} onClose={() => setLogsOpen(false)} />
      <ServerManagementModal isOpen={serversOpen} onClose={() => setServersOpen(false)} />

      {/* Harness permission confirm dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        command={confirmDialog.step?.command ?? ''}
        description={confirmDialog.step?.description ?? ''}
        reason={confirmDialog.guardResult?.auditEntry?.reason}
        onChoose={confirmDialog.onChoose}
        onDismiss={confirmDialog.onDismiss}
      />
    </div>
  );
}
