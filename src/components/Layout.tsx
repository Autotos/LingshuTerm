import { useEffect, useCallback, useRef } from 'react';
import { Terminal as TerminalIcon, Code, Layers } from 'lucide-react';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { TerminalPanel } from './TerminalPanel';
import { EditorPanel } from './EditorPanel';
import { BlocksPanel } from './BlocksPanel';
import { BottomInputArea } from './BottomInputArea';
import { SettingsModal } from './SettingsModal';
import { SessionTypeModal } from './SessionTypeModal';
import { SessionManager } from './SessionManager';
import { StatusBar } from './StatusBar';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useBlockSession } from '@/hooks/useBlockSession';
import { useAiSubmit } from '@/hooks/useAiSubmit';
import { useTaskQueue } from '@/hooks/useTaskQueue';
import { usePersistenceBootstrap } from '@/hooks/usePersistenceBootstrap';
import { createSession as createSessionCmd } from '@/lib/sessionService';
import type { SessionMode } from '@/models/sessionData';

export function Layout() {
  // 直接订阅 activeSessionId，不再维护局部 sessionId state
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const setMode = useSessionStore((s) => s.setMode);
  const { activeView, setActiveView } = useUiStore();

  // 启动持久化：restore -> subscribe（只在顶层组件挂载一次）
  const persistence = usePersistenceBootstrap();

  // 启动时从磁盘加载已保存连接（加密存储）
  const loadConnections = useConnectionStore((s) => s.loadFromDisk);
  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // 避免 StrictMode 双挂载时重复 create_session
  const bootstrappedRef = useRef(false);

  const createSession = useCallback(async () => {
    try {
      // Bootstrap default local PTY session via the unified entry point.
      // Empty `shell` lets Rust fall back to `PtyManager::default_shell()`.
      const newSessionId: string = await createSessionCmd({
        protocol: 'local',
        shell: '',
      });
      addSession({
        id: newSessionId,
        status: 'connected',
        shell: 'default',
        cwd: '~',
        title: newSessionId,
        createdAt: new Date().toISOString(),
        connectionType: 'local',
      });
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [addSession]);

  // 首次挂载：等持久化恢复完成后，若仍无任何 session 才自动创建
  useEffect(() => {
    if (!persistence.ready) return;
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    if (!activeSessionId && sessions.size === 0) {
      createSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence.ready]);

  // 当 activeSessionId 变化（用户点 Sidebar 切 session）：根据该 session 的 mode 恢复主区域视图
  useEffect(() => {
    if (!activeSessionId) return;
    const info = sessions.get(activeSessionId);
    if (info?.mode && info.mode !== activeView) {
      setActiveView(info.mode);
    }
    // 仅在 activeSessionId 变化时触发，避免用户切视图时回涌
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // 用户点视图 tab 时，回写到当前 session 的 mode，保证下次切回依然在这个视图
  const handleViewChange = useCallback(
    (view: SessionMode) => {
      setActiveView(view);
      if (activeSessionId) {
        setMode(activeSessionId, view);
      }
    },
    [activeSessionId, setActiveView, setMode],
  );

  // Mount the block session hook at Layout level so events are always captured
  const { executeCommand, isExecuting } = useBlockSession({ sessionId: activeSessionId });

  // Mount AI submit hook
  const { submitAiQuery, isLoading: isAiLoading, error: aiError, clearError: clearAiError } = useAiSubmit({ sessionId: activeSessionId });

  // Mount task queue execution engine
  useTaskQueue({ sessionId: activeSessionId });

  const shortSessionId = activeSessionId ?? 'no session';

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--void)] text-[var(--text-1)] overflow-hidden font-mono">
      {/* Title Bar */}
      <TitleBar sessionName={shortSessionId} />

      {/* Shell: Sidebar + Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0 bg-[var(--void)]">
          {/* Sub titlebar with view tabs */}
          <div className="h-9 bg-[var(--deep)] border-b border-[var(--border)] flex items-center gap-1 px-4 flex-shrink-0">
            <ViewTab
              icon={<TerminalIcon className="w-3.5 h-3.5" />}
              label="Terminal"
              active={activeView === 'terminal'}
              onClick={() => handleViewChange('terminal')}
            />
            <ViewTab
              icon={<Layers className="w-3.5 h-3.5" />}
              label="Blocks"
              active={activeView === 'blocks'}
              onClick={() => handleViewChange('blocks')}
            />
            <ViewTab
              icon={<Code className="w-3.5 h-3.5" />}
              label="Editor"
              active={activeView === 'editor'}
              onClick={() => handleViewChange('editor')}
            />
            <span className="text-[10px] text-[var(--text-4)] ml-2">&middot;</span>
            <span className="text-[11px] text-[var(--text-3)] ml-2">{shortSessionId}</span>
          </div>

          {/* Content area — 每个会话的 Terminal 始终挂载（CSS 隐藏非活跃），
              保留 xterm.js 实例和 scrollback buffer。Blocks/Editor 仅渲染当前会话 */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* Terminal：每个已打开会话保留一个 TerminalPanel 实例 */}
            {Array.from(sessions.values()).map((s) => (
              <div
                key={`term-${s.id}`}
                className={
                  s.id === activeSessionId && activeView === 'terminal'
                    ? 'flex-1 min-h-0 flex flex-col'
                    : 'hidden'
                }
              >
                <TerminalPanel
                  sessionId={s.id}
                  isVisible={s.id === activeSessionId && activeView === 'terminal'}
                />
              </div>
            ))}

            {/* Blocks / Editor：仅当前活跃会话 */}
            <div className={activeView === 'blocks' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
              <BlocksPanel sessionId={activeSessionId} />
            </div>
            <div className={activeView === 'editor' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
              <EditorPanel sessionId={activeSessionId} />
            </div>
          </div>

          {/* Bottom fixed input bar: 终端命令 / Blocks 命令（Editor 模式隐藏） */}
          <BottomInputArea
            sessionId={activeSessionId}
            activeView={activeView}
            executeCommand={executeCommand}
            isExecuting={isExecuting}
            onAiSubmit={submitAiQuery}
            isAiLoading={isAiLoading}
            aiError={aiError}
            onClearAiError={clearAiError}
          />

          {/* Status Bar */}
          <StatusBar sessionId={activeSessionId} />
        </main>
      </div>

      {/* Settings Modal */}
      <SettingsModal />

      {/* Unified New Session Modal (Remote SSH/Telnet/Serial + Local) */}
      <SessionTypeModal />

      {/* Session Manager (tree view, drag & drop groups) */}
      <SessionManager />
    </div>
  );
}

function ViewTab({
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] transition-all ${
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
