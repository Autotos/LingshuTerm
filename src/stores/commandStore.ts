/**
 * @deprecated Since 3.0.  Use {@link useSessionLogStore} from `@/stores/sessionLogStore`
 * instead.  The unified SessionEvent timeline replaces the CommandBlock array.
 *
 * This store is kept for backward compatibility with legacy code; new features
 * should read from sessionLogStore and derive CommandGroup[] via
 * `deriveCommandGroups()`.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { CommandBlock, CommandBlockStatus } from '@/models/block';

interface CommandState {
  blocks: CommandBlock[];

  addCommand: (sessionId: string, commandId: string, command: string) => void;
  setCommandRunning: (commandId: string) => void;
  appendCommandOutput: (commandId: string, data: string) => void;
  setCommandCompleted: (commandId: string, exitCode: number) => void;
  setCommandError: (commandId: string, message: string) => void;
  clearSessionBlocks: (sessionId: string) => void;
  /** 用持久化数据全量替换某 session 的 blocks（启动恢复用） */
  setSessionBlocks: (sessionId: string, blocks: CommandBlock[]) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  blocks: [],

  addCommand: (sessionId, commandId, command) =>
    set((s) => ({
      blocks: [
        ...s.blocks,
        {
          id: commandId,
          sessionId,
          command,
          output: '',
          status: 'pending',
          exitCode: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    })),

  setCommandRunning: (commandId) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === commandId
          ? { ...b, status: 'running' as const, startedAt: new Date().toISOString() }
          : b,
      ),
    })),

  appendCommandOutput: (commandId, data) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === commandId ? { ...b, output: b.output + data } : b,
      ),
    })),

  setCommandCompleted: (commandId, exitCode) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === commandId
          ? {
              ...b,
              status: (exitCode === 0 ? 'success' : 'error') as CommandBlockStatus,
              exitCode,
              completedAt: new Date().toISOString(),
            }
          : b,
      ),
    })),

  setCommandError: (commandId, message) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === commandId
          ? {
              ...b,
              status: 'error' as const,
              output: b.output + '\n' + message,
              completedAt: new Date().toISOString(),
            }
          : b,
      ),
    })),

  clearSessionBlocks: (sessionId) =>
    set((s) => ({
      blocks: s.blocks.filter((b) => b.sessionId !== sessionId),
    })),

  setSessionBlocks: (sessionId, blocks) =>
    set((s) => ({
      blocks: [
        ...s.blocks.filter((b) => b.sessionId !== sessionId),
        ...blocks.filter((b) => b.sessionId === sessionId),
      ],
    })),
}));

/** Selector: get blocks for a specific session */
export function useSessionBlocks(sessionId: string | null) {
  // 订阅原始 blocks 数组（引用稳定，仅在 store 更新时变化）
  const blocks = useCommandStore((s) => s.blocks);
  // 在组件侧进行过滤并缓存结果，避免 selector 每次返回新引用导致 useSyncExternalStore 无限循环
  return useMemo(
    () => (sessionId ? blocks.filter((b) => b.sessionId === sessionId) : []),
    [blocks, sessionId],
  );
}
