import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import {
  X,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Wifi,
  Terminal,
  Cable,
  Network,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useConnectionStore, buildTree } from '@/stores/connectionStore';
import type { TreeNode, SavedConnection } from '@/models/connection';
import { connectionLabel } from '@/models/connection';

// ─── SessionManager (Panel) ──────────────────────────────────

export function SessionManager() {
  const isVisible = useUiStore((s) => s.isSessionManagerVisible);
  const toggleSessionManager = useUiStore((s) => s.toggleSessionManager);
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const groups = useConnectionStore((s) => s.groups);
  const createGroup = useConnectionStore((s) => s.createGroup);

  const treeData = useMemo(
    () => buildTree(savedConnections, groups),
    [savedConnections, groups],
  );

  // ── 空白区域右键菜单 ──
  const [blankCtxMenu, setBlankCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const closeBlankCtxMenu = useCallback(() => setBlankCtxMenu(null), []);

  const handleBlankContextMenu = useCallback((e: React.MouseEvent) => {
    // 仅在点击容器自身空白处时触发（不冒泡到子节点右键）
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    setBlankCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!blankCtxMenu) return;
    const handler = () => closeBlankCtxMenu();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [blankCtxMenu, closeBlankCtxMenu]);

  const handleCreateGroup = useCallback(() => {
    const name = window.prompt('Enter group name:');
    if (name && name.trim()) {
      createGroup(name.trim());
    }
    closeBlankCtxMenu();
  }, [createGroup, closeBlankCtxMenu]);

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={toggleSessionManager}
      />

      {/* 滑出面板 */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-50 w-[320px] bg-[var(--deep)] border-l border-[var(--border)] flex flex-col shadow-2xl transition-transform duration-300 ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <span className="text-[12px] font-medium text-[var(--text-1)]">
            Session Manager
          </span>
          <button
            onClick={toggleSessionManager}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tree Content — 空白区域右键弹出"新建分组"菜单 */}
        <div
          className="flex-1 overflow-y-auto py-2 px-2"
          onContextMenu={handleBlankContextMenu}
        >
          {treeData.length === 0 ? (
            <EmptyState />
          ) : (
            treeData.map((node) => (
              <TreeNodeRow key={node.id} node={node} depth={0} />
            ))
          )}

          {/* 空白区域右键菜单 */}
          {blankCtxMenu && (
            <BlankAreaContextMenu
              x={blankCtxMenu.x}
              y={blankCtxMenu.y}
              onCreateGroup={handleCreateGroup}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ─── Empty State ────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--text-4)]">
      <Network className="w-8 h-8 opacity-30" />
      <span className="text-[11px]">No saved sessions yet</span>
      <span className="text-[10px] opacity-70">
        Create sessions via the New Session modal
      </span>
    </div>
  );
}

// ─── Blank-Area Context Menu ────────────────────────────────

function BlankAreaContextMenu({
  x,
  y,
  onCreateGroup,
}: {
  x: number;
  y: number;
  onCreateGroup: () => void;
}) {
  // 调整菜单位置防止溢出
  const [adjX, adjY] = useMemo(() => {
    let ax = x;
    let ay = y;
    if (typeof window !== 'undefined') {
      if (ax + 160 > window.innerWidth) ax = window.innerWidth - 168;
      if (ay + 160 > window.innerHeight) ay = window.innerHeight - 168;
    }
    return [ax, ay];
  }, [x, y]);

  return (
    <div
      className="fixed z-[100] py-1 w-[160px] rounded bg-[var(--deep)] border border-[var(--border)] shadow-xl"
      style={{ left: adjX, top: adjY }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCreateGroup();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-colors"
      >
        <Plus className="w-3 h-3" />
        New Group
      </button>
    </div>
  );
}

// ─── TreeNode Row ───────────────────────────────────────────

interface DragPayload {
  nodeId: string;
  nodeType: 'directory' | 'session';
}

function TreeNodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(node.type === 'directory');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const {
    touchConnection,
    renameGroup,
  } = useConnectionStore();

  const isDirectory = node.type === 'directory';
  const hasChildren = isDirectory && node.children && node.children.length > 0;

  // Expand if children present
  const toggleExpand = useCallback(() => {
    if (isDirectory) setExpanded((v) => !v);
  }, [isDirectory]);

  // ── Context Menu ──
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => closeCtxMenu();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [ctxMenu, closeCtxMenu]);

  // ── Drag & Drop ──
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const payload: DragPayload = {
        nodeId: node.id,
        nodeType: node.type,
      };
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    },
    [node.id, node.type],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      // 只允许放入目录节点（或根级空白区域）
      if (!isDirectory) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    },
    [isDirectory],
  );

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (!isDirectory) return;

      try {
        const raw = e.dataTransfer.getData('application/json');
        const payload: DragPayload = JSON.parse(raw);

        // 禁止拖入会话节点（已由 isDirectory 守卫）
        // 禁止将目录拖入自身或其子目录（循环）
        // 禁止拖入自身

        // Extract group name from directory node id ("dir:GroupName")
        const targetGroup =
          node.id === 'root' ? null : node.id.startsWith('dir:')
            ? node.id.slice(4)
            : null;

        const store = useConnectionStore.getState();

        if (payload.nodeType === 'session') {
          store.moveToGroup(payload.nodeId, targetGroup);
        } else if (payload.nodeType === 'directory') {
          // Moving a directory into another directory
          const srcGroup = payload.nodeId.startsWith('dir:')
            ? payload.nodeId.slice(4)
            : null;
          if (srcGroup && srcGroup !== targetGroup) {
            store.moveDirectoryToGroup(srcGroup, targetGroup);
          }
        }
      } catch {
        // ignore parse errors
      }
    },
    [isDirectory, node.id],
  );

  // ── Rename ──
  const startRename = useCallback(() => {
    setRenameValue(node.label);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [node.label]);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.label && isDirectory) {
      renameGroup(node.label, trimmed);
    }
    setRenaming(false);
  }, [renameValue, node.label, isDirectory, renameGroup]);

  // ── Render ──
  const indent = depth * 16;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-[11px] transition-colors ${
          dragOver
            ? 'bg-[var(--accent)]/20 ring-1 ring-[var(--accent)]/40'
            : 'hover:bg-[var(--veil)]'
        }`}
        style={{ paddingLeft: 8 + indent }}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
        onClick={isDirectory ? toggleExpand : undefined}
        onDoubleClick={
          isDirectory
            ? undefined
            : () => {
                if (node.sessionData) {
                  touchConnection(node.sessionData.id);
                  // Fill form: could emit event; handled via Sidebar integration
                }
              }
        }
      >
        {/* Expand chevron */}
        {isDirectory ? (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-[var(--text-4)]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[var(--text-4)]" />
            )}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        {/* Icon */}
        <span className="flex-shrink-0">
          {isDirectory ? (
            expanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-[var(--yellow)]" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-[var(--yellow)]" />
            )
          ) : node.sessionData ? (
            <ProtocolIcon config={node.sessionData.config} />
          ) : (
            <Terminal className="w-3.5 h-3.5 text-[var(--text-4)]" />
          )}
        </span>

        {/* Label */}
        {renaming ? (
          <input
            ref={renameInputRef}
            className="flex-1 min-w-0 px-1 py-0.5 rounded bg-[var(--void)] border border-[var(--accent)] text-[11px] text-[var(--text-1)] outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={() => setTimeout(() => setRenaming(false), 150)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[var(--text-2)] group-hover:text-[var(--text-1)]">
            {node.label}
          </span>
        )}

        {/* Child count badge (directories) */}
        {isDirectory && hasChildren && (
          <span className="text-[10px] text-[var(--text-4)] flex-shrink-0">
            {node.children!.length}
          </span>
        )}

        {/* Session sub-label */}
        {!isDirectory && node.sessionData && (
          <span className="text-[10px] text-[var(--text-4)] truncate flex-shrink-0 max-w-[100px] ml-2">
            {connectionLabel(node.sessionData.config)}
          </span>
        )}
      </div>

      {/* Children */}
      {isDirectory && expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenuLayer
          x={ctxMenu.x}
          y={ctxMenu.y}
          node={node}
          close={closeCtxMenu}
          onStartRename={startRename}
        />
      )}
    </div>
  );
}

// ─── Protocol Icon ──────────────────────────────────────────

function ProtocolIcon({
  config,
}: {
  config: SavedConnection['config'];
}) {
  switch (config.protocol) {
    case 'ssh':
      return <Wifi className="w-3.5 h-3.5 text-[var(--accent)]" />;
    case 'telnet':
      return <Terminal className="w-3.5 h-3.5 text-[var(--green)]" />;
    case 'serial':
      return <Cable className="w-3.5 h-3.5 text-[var(--purple)]" />;
    default:
      return <Terminal className="w-3.5 h-3.5 text-[var(--text-4)]" />;
  }
}

// ─── Context Menu ───────────────────────────────────────────

function ContextMenuLayer({
  x,
  y,
  node,
  close,
  onStartRename,
}: {
  x: number;
  y: number;
  node: TreeNode;
  close: () => void;
  onStartRename: () => void;
}) {
  const { createGroup, removeGroup, removeConnection } = useConnectionStore();
  const isDirectory = node.type === 'directory';
  const groupName = isDirectory
    ? node.id.startsWith('dir:')
      ? node.id.slice(4)
      : node.label
    : null;
  const connId = !isDirectory ? node.id : null;

  // 调整菜单位置防止溢出
  const [adjX, adjY] = useMemo(() => {
    let ax = x;
    let ay = y;
    if (typeof window !== 'undefined') {
      if (ax + 160 > window.innerWidth) ax = window.innerWidth - 168;
      if (ay + 160 > window.innerHeight) ay = window.innerHeight - 168;
    }
    return [ax, ay];
  }, [x, y]);

  const promptCreateGroup = useCallback(() => {
    const name = window.prompt('Enter group name:');
    if (name && name.trim()) {
      createGroup(name.trim());
    }
    close();
  }, [createGroup, close]);

  const items: { label: string; icon: React.ReactNode; action: () => void; danger?: boolean }[] = [];

  if (isDirectory) {
    items.push({
      label: 'New Group',
      icon: <Plus className="w-3 h-3" />,
      action: promptCreateGroup,
    });
    items.push({
      label: 'Rename',
      icon: <Pencil className="w-3 h-3" />,
      action: () => {
        close();
        onStartRename();
      },
    });
    items.push({
      label: 'Delete Directory',
      icon: <Trash2 className="w-3 h-3" />,
      danger: true,
      action: () => {
        if (groupName) removeGroup(groupName);
        close();
      },
    });
  } else {
    items.push({
      label: 'New Group',
      icon: <Plus className="w-3 h-3" />,
      action: promptCreateGroup,
    });
    items.push({
      label: 'Remove Session',
      icon: <Trash2 className="w-3 h-3" />,
      danger: true,
      action: () => {
        if (connId) removeConnection(connId);
        close();
      },
    });
  }

  return (
    <div
      className="fixed z-[100] py-1 w-[160px] rounded bg-[var(--deep)] border border-[var(--border)] shadow-xl"
      style={{ left: adjX, top: adjY }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            item.action();
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-[var(--veil)] transition-colors ${
            item.danger
              ? 'text-[var(--red)] hover:text-[var(--red)]'
              : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
