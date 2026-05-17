import { useCallback, useRef, useEffect } from 'react';
import { ChevronRight, File, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { useSftpStore, type SftpFileEntry } from '@/stores/sftpStore';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'rs', 'js', 'ts', 'tsx', 'jsx', 'json', 'toml', 'yaml', 'yml',
  'html', 'css', 'scss', 'xml', 'svg', 'py', 'rb', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'conf', 'cfg',
  'ini', 'log', 'lock', 'gitignore', 'env', 'vue', 'svelte', 'sql', 'graphql',
  'Makefile', 'Dockerfile', 'Rakefile',
]);

interface FileTreeNodeProps {
  entry: SftpFileEntry;
  sessionId: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  loading: Set<string>;
  onContextMenu: (e: React.MouseEvent, entry: SftpFileEntry) => void;
  /** Set when this entry is being renamed (inline edit mode) */
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

export function FileTreeNode({
  entry,
  sessionId,
  depth,
  selectedPath,
  onSelect,
  onNavigate,
  onOpenFile,
  expandedPaths,
  onToggleExpand,
  loading,
  onContextMenu,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: FileTreeNodeProps) {
  const isExpanded = expandedPaths.has(entry.path);
  const isLoading = loading.has(entry.path);
  const isSelected = selectedPath === entry.path;

  const children = useSftpStore((s) =>
    isExpanded ? s.listings[`${sessionId}:${entry.path}`] : undefined,
  );

  const handleClick = useCallback(() => {
    onSelect(entry.path);
    if (entry.isDir) {
      onToggleExpand(entry.path);
      onNavigate(entry.path);
    }
  }, [entry, onSelect, onToggleExpand, onNavigate]);

  const handleDoubleClick = useCallback(() => {
    if (!entry.isDir) {
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
      if (TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(entry.name)) {
        onOpenFile(entry.path);
      }
    }
  }, [entry, onOpenFile]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, entry);
    },
    [onContextMenu, entry],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-sftp-path', entry.path);
      e.dataTransfer.setData('application/x-sftp-session', sessionId);
      e.dataTransfer.setData('application/x-sftp-name', entry.name);
      e.dataTransfer.setData('application/x-sftp-isdir', String(entry.isDir));
      e.dataTransfer.effectAllowed = 'copy';
    },
    [entry, sessionId],
  );

  const isTextFile = !entry.isDir && (
    TEXT_EXTENSIONS.has(entry.name.split('.').pop()?.toLowerCase() ?? '') ||
    TEXT_EXTENSIONS.has(entry.name)
  );

  // Inline rename input ref
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  return (
    <div data-file-tree-node>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer text-[12px] select-none rounded group
          ${isSelected ? 'bg-[var(--veil)] text-[var(--text-1)]' : 'text-[var(--text-3)] hover:bg-[var(--veil)] hover:text-[var(--text-1)]'}
        `}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={entry.path}
      >
        {entry.isDir ? (
          <>
            <ChevronRight
              className={`w-3 h-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-[var(--accent)]" />
            ) : isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-[var(--yellow)]" />
            ) : (
              <Folder className="w-3.5 h-3.5 flex-shrink-0 text-[var(--yellow)]" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            <File
              className={`w-3.5 h-3.5 flex-shrink-0 ${isTextFile ? 'text-[var(--blue)]' : 'text-[var(--text-4)]'}`}
            />
          </>
        )}

        {/* Inline rename or normal display */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameSubmit}
            className="flex-1 bg-[var(--elevated)] text-[var(--text-1)] text-[11px] px-1 py-0 rounded outline-none border border-[var(--accent)]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{entry.name}</span>
        )}

        {!entry.isDir && !isRenaming && (
          <span className="ml-auto text-[10px] text-[var(--text-4)] flex-shrink-0 opacity-70 group-hover:opacity-0 transition-opacity">
            {formatSize(entry.size)}
          </span>
        )}
      </div>

      {/* Render children when expanded */}
      {entry.isDir && isExpanded && (
        <>
          {isLoading && !children ? (
            <div
              className="flex items-center gap-1.5 text-[11px] text-[var(--text-4)] py-0.5"
              style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading...
            </div>
          ) : !children || children.length === 0 ? (
            <div
              className="text-[11px] text-[var(--text-4)] py-0.5"
              style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
            >
              Empty
            </div>
          ) : (
            children.map((child) => (
              <FileTreeNode
                key={child.path}
                entry={child}
                sessionId={sessionId}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onNavigate={onNavigate}
                onOpenFile={onOpenFile}
                expandedPaths={expandedPaths}
                onToggleExpand={onToggleExpand}
                loading={loading}
                onContextMenu={onContextMenu}
                isRenaming={false}
                renameValue=""
                onRenameChange={() => {}}
                onRenameSubmit={() => {}}
                onRenameCancel={() => {}}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
