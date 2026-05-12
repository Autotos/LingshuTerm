import { useState, useCallback, useEffect } from 'react';
import {
  X,
  ChevronRight,
  ChevronDown,
  FileText,
  FolderOpen,
  Folder,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSessionStore } from '@/stores/sessionStore';
import { LoggerService, type LogEntry } from '@/lib/loggerService';

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LogViewer({ isOpen, onClose }: LogViewerProps) {
  const { settings } = useSettingsStore();
  const { sessions } = useSessionStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tree, setTree] = useState<Map<string, LogEntry[]>>(new Map());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  // Refresh log tree when panel opens
  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      const map = new Map<string, LogEntry[]>();
      for (const [, s] of sessions) {
        const name = s.title || s.id;
        try {
          const entries = await LoggerService.list(settings.logging, name);
          if (entries.length > 0) map.set(name, entries);
        } catch { /* no logs for this session */ }
      }
      setTree(map);
    };
    load();
  }, [isOpen, sessions, settings.logging]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleOpenFile = useCallback(async (entry: LogEntry) => {
    try {
      const content = await LoggerService.read(entry.path);
      setSelectedPath(entry.path);
      setFileContent(content);
    } catch (err) {
      console.warn('Failed to read log:', err);
    }
  }, []);

  const handleOpenInExplorer = useCallback((entry: LogEntry) => {
    LoggerService.openInExplorer(entry.path);
  }, []);

  const handleCopyPath = useCallback(async (entry: LogEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path);
    } catch { /* clipboard denied */ }
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 z-50 w-[640px] bg-[var(--deep)] border-l border-[var(--border)] flex flex-row shadow-2xl">
        {/* Left: file tree */}
        <div className="w-[280px] flex-shrink-0 border-r border-[var(--border)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <span className="text-[12px] font-medium text-[var(--text-1)]">Logs</span>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2 px-2">
            {tree.size === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--text-4)]">
                <FileText className="w-8 h-8 opacity-30" />
                <span className="text-[11px]">No log files</span>
                <span className="text-[10px] opacity-70">Enable logging in Settings</span>
              </div>
            ) : (
              Array.from(tree.entries()).map(([sessionName, entries]) => {
                const isOpen = expanded.has(sessionName);
                const activeFiles = entries.filter((e) => !e.is_rotated);
                const rotatedFiles = entries.filter((e) => e.is_rotated);
                return (
                  <div key={sessionName}>
                    {/* Session node */}
                    <div
                      className="flex items-center gap-1 py-1.5 px-2 rounded cursor-pointer text-[11px] hover:bg-[var(--veil)]"
                      onClick={() => toggleExpand(sessionName)}
                    >
                      <span className="w-4 h-4 flex items-center justify-center">
                        {isOpen ? (
                          <ChevronDown className="w-3 h-3 text-[var(--text-4)]" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-[var(--text-4)]" />
                        )}
                      </span>
                      {isOpen ? (
                        <FolderOpen className="w-3.5 h-3.5 text-[var(--yellow)]" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-[var(--yellow)]" />
                      )}
                      <span className="flex-1 truncate text-[var(--text-2)]">{sessionName}</span>
                      <span className="text-[10px] text-[var(--text-4)]">{entries.length}</span>
                    </div>

                    {/* Children */}
                    {isOpen && (
                      <>
                        {activeFiles.map((e) => (
                          <LogFileRow
                            key={e.name}
                            entry={e}
                            depth={1}
                            onOpen={handleOpenFile}
                            onExplorer={handleOpenInExplorer}
                            onCopyPath={handleCopyPath}
                            formatSize={formatSize}
                          />
                        ))}
                        {rotatedFiles.length > 0 && (
                          <div className="text-[10px] text-[var(--text-4)] pl-10 py-1">History</div>
                        )}
                        {rotatedFiles.map((e) => (
                          <LogFileRow
                            key={e.name}
                            entry={e}
                            depth={1}
                            onOpen={handleOpenFile}
                            onExplorer={handleOpenInExplorer}
                            onCopyPath={handleCopyPath}
                            formatSize={formatSize}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: file content */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedPath ? (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
                <span className="text-[10px] text-[var(--text-3)] truncate">{selectedPath}</span>
                <button
                  onClick={() => handleOpenInExplorer({ name: '', path: selectedPath, size: 0, is_rotated: false })}
                  className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]"
                  title="Open in Explorer"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <pre className="flex-1 overflow-auto p-3 text-[11px] text-[var(--text-2)] font-mono whitespace-pre-wrap break-all select-text">
                {fileContent || '(empty)'}
              </pre>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-[var(--text-4)]">
              Select a log file to view
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LogFileRow({
  entry,
  depth,
  onOpen,
  onExplorer,
  onCopyPath,
  formatSize,
}: {
  entry: LogEntry;
  depth: number;
  onOpen: (e: LogEntry) => void;
  onExplorer: (e: LogEntry) => void;
  onCopyPath: (e: LogEntry) => void;
  formatSize: (n: number) => string;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <div
        className="group flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-[11px] text-[var(--text-3)] hover:bg-[var(--veil)] hover:text-[var(--text-1)]"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onOpen(entry)}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <FileText className="w-3 h-3 flex-shrink-0" />
        <span className="flex-1 truncate">{entry.name}</span>
        <span className="text-[10px] text-[var(--text-4)]">{formatSize(entry.size)}</span>
      </div>

      {ctxMenu && (
        <div
          className="fixed z-[100] py-1 w-[180px] rounded bg-[var(--deep)] border border-[var(--border)] shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={() => setCtxMenu(null)}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--veil)] hover:text-[var(--text-1)]"
            onClick={() => onExplorer(entry)}
          >
            <ExternalLink className="w-3 h-3" />
            Open in Explorer
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--veil)] hover:text-[var(--text-1)]"
            onClick={() => onCopyPath(entry)}
          >
            <Copy className="w-3 h-3" />
            Copy Path
          </button>
        </div>
      )}
    </>
  );
}
