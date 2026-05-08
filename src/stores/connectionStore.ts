import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  SavedConnection,
  ConnectionConfig,
  StoragePayload,
  TreeNode,
} from '@/models/connection';
import { generateConnectionId } from '@/models/connection';

interface ConnectionState {
  savedConnections: SavedConnection[];
  groups: string[];
  /** 标记数据是否已从磁盘加载完成 */
  ready: boolean;
  /** 从磁盘加载连接和分组（应用启动时调用一次） */
  loadFromDisk: () => Promise<void>;
  /** 保存连接并写入磁盘 */
  addConnection: (name: string, config: ConnectionConfig) => string;
  /** 删除连接并写入磁盘 */
  removeConnection: (id: string) => void;
  /** 更新连接并写入磁盘 */
  updateConnection: (id: string, name: string, config: ConnectionConfig) => void;
  /** 更新 lastUsedAt 并写入磁盘 */
  touchConnection: (id: string) => void;
  // ── 分组管理 ──
  /** 创建目录分组 */
  createGroup: (name: string) => void;
  /** 删除目录分组（子连接移至根级） */
  removeGroup: (name: string) => void;
  /** 重命名目录分组 */
  renameGroup: (oldName: string, newName: string) => void;
  /** 移动连接到指定分组（null = 根级） */
  moveToGroup: (connectionId: string, groupName: string | null) => void;
  /** 移动目录到另一个目录（该目录下所有连接 group 改为目标） */
  moveDirectoryToGroup: (dirName: string, targetGroup: string | null) => void;
}

/** 将内存中的连接列表和分组写入磁盘（内部 helper） */
async function persist(
  connections: SavedConnection[],
  groups: string[],
): Promise<void> {
  const payload: StoragePayload = { connections, groups };
  await invoke('save_connections', { payload });
}

/** 从 flat 连接列表和 groups 推导树形结构 */
export function buildTree(
  connections: SavedConnection[],
  groups: string[],
): TreeNode[] {
  const children: TreeNode[] = [];

  // 分组节点（仅当有连接归属时才展示）
  for (const g of groups) {
    const groupConns = connections.filter((c) => c.group === g);
    if (groupConns.length > 0) {
      children.push({
        id: `dir:${g}`,
        label: g,
        type: 'directory',
        children: groupConns.map((c) => ({
          id: c.id,
          label: c.name || connectionLabel(c.config),
          type: 'session' as const,
          sessionData: c,
        })),
      });
    }
  }

  // 根级连接（无 group 或 group 不在 groups 列表中）
  const rootConns = connections.filter(
    (c) => !c.group || !groups.includes(c.group),
  );
  for (const c of rootConns) {
    children.push({
      id: c.id,
      label: c.name || connectionLabel(c.config),
      type: 'session' as const,
      sessionData: c,
    });
  }

  return children;
}

/** 就地计算协议连接标签（避免循环依赖 connectionLabel） */
function connectionLabel(config: ConnectionConfig): string {
  switch (config.protocol) {
    case 'ssh':
      return `${config.username}@${config.host}:${config.port}`;
    case 'telnet':
      return `${config.host}:${config.port}`;
    case 'serial':
      return `${config.portName} @ ${config.baudRate}`;
    case 'local':
      return config.shell || 'local';
  }
}

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  savedConnections: [],
  groups: [],
  ready: false,

  loadFromDisk: async () => {
    try {
      const payload: StoragePayload = await invoke('load_connections');
      set({
        savedConnections: payload.connections,
        groups: payload.groups,
        ready: true,
      });
    } catch (err) {
      console.error('Failed to load connections from disk:', err);
      set({ ready: true });
    }
  },

  addConnection: (name, config) => {
    const id = generateConnectionId();
    const entry: SavedConnection = {
      id,
      name,
      config,
      createdAt: new Date().toISOString(),
    };
    const next = [...get().savedConnections, entry];
    set({ savedConnections: next });
    persist(next, get().groups).catch((err) =>
      console.error('Failed to persist connections:', err),
    );
    return id;
  },

  removeConnection: (id) => {
    const next = get().savedConnections.filter((c) => c.id !== id);
    set({ savedConnections: next });
    persist(next, get().groups).catch((err) =>
      console.error('Failed to persist connections:', err),
    );
  },

  updateConnection: (id, name, config) => {
    const next = get().savedConnections.map((c) =>
      c.id === id ? { ...c, name, config } : c,
    );
    set({ savedConnections: next });
    persist(next, get().groups).catch((err) =>
      console.error('Failed to persist connections:', err),
    );
  },

  touchConnection: (id) => {
    const now = new Date().toISOString();
    const next = get().savedConnections.map((c) =>
      c.id === id ? { ...c, lastUsedAt: now } : c,
    );
    set({ savedConnections: next });
    persist(next, get().groups).catch((err) =>
      console.error('Failed to persist connections:', err),
    );
  },

  // ── 分组管理 ──

  createGroup: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { groups } = get();
    if (groups.includes(trimmed)) return;
    const nextGroups = [...groups, trimmed];
    set({ groups: nextGroups });
    persist(get().savedConnections, nextGroups).catch((err) =>
      console.error('Failed to persist groups:', err),
    );
  },

  removeGroup: (name) => {
    const { savedConnections, groups } = get();
    // 将该分组下所有连接移回根级
    const nextConns = savedConnections.map((c) =>
      c.group === name ? { ...c, group: undefined } : c,
    );
    const nextGroups = groups.filter((g) => g !== name);
    set({ savedConnections: nextConns, groups: nextGroups });
    persist(nextConns, nextGroups).catch((err) =>
      console.error('Failed to persist after removeGroup:', err),
    );
  },

  renameGroup: (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const { savedConnections, groups } = get();
    if (groups.includes(trimmed)) return;
    // 更新该分组下所有连接的 group 引用
    const nextConns = savedConnections.map((c) =>
      c.group === oldName ? { ...c, group: trimmed } : c,
    );
    const nextGroups = groups.map((g) => (g === oldName ? trimmed : g));
    set({ savedConnections: nextConns, groups: nextGroups });
    persist(nextConns, nextGroups).catch((err) =>
      console.error('Failed to persist after renameGroup:', err),
    );
  },

  moveToGroup: (connectionId, groupName) => {
    const { savedConnections, groups } = get();
    // 如果目标分组不在 groups 列表中且非 null，则自动创建
    let nextGroups = groups;
    if (groupName && !groups.includes(groupName)) {
      nextGroups = [...groups, groupName];
    }
    const nextConns = savedConnections.map((c) =>
      c.id === connectionId ? { ...c, group: groupName ?? undefined } : c,
    );
    set({ savedConnections: nextConns, groups: nextGroups });
    persist(nextConns, nextGroups).catch((err) =>
      console.error('Failed to persist after moveToGroup:', err),
    );
  },

  moveDirectoryToGroup: (dirName, targetGroup) => {
    const { savedConnections, groups } = get();
    // 将该目录下所有连接移动到目标分组
    const nextConns = savedConnections.map((c) =>
      c.group === dirName
        ? { ...c, group: targetGroup ?? undefined }
        : c,
    );
    // 如果源目录不再有连接，则移除它
    const stillUsed = nextConns.some((c) => c.group === dirName);
    const nextGroups = stillUsed ? groups : groups.filter((g) => g !== dirName);
    set({ savedConnections: nextConns, groups: nextGroups });
    persist(nextConns, nextGroups).catch((err) =>
      console.error('Failed to persist after moveDirectoryToGroup:', err),
    );
  },
}));
