import { useRef, useEffect, useCallback, useMemo } from 'react';
import { FileText, X, Plus } from 'lucide-react';
import { useEditor } from '@/hooks/useEditor';
import { useEditorStore, useSessionEditor } from '@/stores/editorStore';

interface EditorPanelProps {
  sessionId: string | null;
  isVisible?: boolean;
}

const WELCOME_PATH = 'welcome.md';
const WELCOME_CONTENT = `# Welcome to LingshuTerm 2.0 Editor

This virtual workspace is scoped to the current session.
- Changes are persisted to local app data on the fly.
- Switch sessions from the sidebar to load the respective workspace.
`;

export function EditorPanel({ sessionId, isVisible }: EditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const editorData = useSessionEditor(sessionId);
  const { ensureSession, openFile, updateFile, closeFile, setActiveFile } = useEditorStore();

  // 首次进入 / 切 session：确保有 EditorData；若没有任何文件则打开一个欢迎文件
  useEffect(() => {
    if (!sessionId) return;
    ensureSession(sessionId);
    const data = useEditorStore.getState().bySession[sessionId];
    if (data && data.openFiles.length === 0 && Object.keys(data.files).length === 0) {
      openFile(sessionId, WELCOME_PATH, WELCOME_CONTENT);
    }
  }, [sessionId, ensureSession, openFile]);

  const activePath = editorData.activeFile;
  const activeContent = useMemo(
    () => (activePath ? editorData.files[activePath] ?? '' : ''),
    [activePath, editorData.files],
  );

  // 将内容变更写回 editorStore（由 useEditor 的 onChange 转发而来）
  const handleChange = useCallback(
    (value: string) => {
      if (!sessionId || !activePath) return;
      updateFile(sessionId, activePath, value);
    },
    [sessionId, activePath, updateFile],
  );

  const { setValue, layout } = useEditor({
    containerRef,
    language: 'plaintext',
    value: activeContent,
    onChange: handleChange,
  });

  // Trigger layout when editor becomes visible (prevents blank/glitched rendering)
  useEffect(() => {
    if (isVisible) {
      const raf = requestAnimationFrame(() => layout());
      return () => cancelAnimationFrame(raf);
    }
  }, [isVisible, layout]);

  // 切换 activeFile 或外部内容变化时，同步到 Monaco
  useEffect(() => {
    setValue(activeContent);
  }, [activeContent, setValue]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tabs */}
      <div className="h-8 flex items-center gap-px border-b border-[var(--border)] bg-[var(--deep)] overflow-x-auto scrollbar-thin">
        {editorData.openFiles.map((path) => {
          const isActive = path === activePath;
          return (
            <div
              key={path}
              onClick={() => sessionId && setActiveFile(sessionId, path)}
              className={`group flex items-center gap-1.5 h-full px-3 text-[11px] cursor-pointer whitespace-nowrap border-r border-[var(--border)] ${
                isActive
                  ? 'bg-[var(--void)] text-[var(--text-1)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
              }`}
            >
              <FileText className="w-3 h-3 flex-shrink-0" />
              <span className="truncate max-w-[160px]">{path}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (sessionId) closeFile(sessionId, path);
                }}
                className="opacity-0 group-hover:opacity-100 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-[var(--elevated)] transition-opacity"
                title="Close"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => {
            if (!sessionId) return;
            const name = `untitled-${Date.now()}.txt`;
            openFile(sessionId, name, '');
          }}
          className="h-full px-2 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] flex items-center"
          title="New file"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Editor area */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
