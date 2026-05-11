import { useMemo } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useCommandStore } from '@/stores/commandStore';
import { useTaskStore } from '@/stores/taskStore';
import { useEditorStore } from '@/stores/editorStore';
import type { Session } from '@/models/sessionData';
import {
  emptyBlocksData,
  emptyEditorData,
  emptyTerminalData,
} from '@/models/sessionData';

/**
 * 聚合 hook：把分散在各个 store 中的切片按 sessionId 组装成一个只读的 Session 视图。
 *
 * 注意事项：
 * 1. 每一个 useXxxStore 只订阅稳定引用字段（`s => s.sessions / s.blocks / ...`），避免 selector
 *    返回新引用导致 React 19 `useSyncExternalStore` 触发 Maximum update depth exceeded。
 * 2. 派生结果用 useMemo 依赖去重，任何一个切片不变都能复用上一次结果。
 * 3. 这是一个只读快照，写操作请继续调用原 store 的 action。
 */
export function useSession(sessionId: string | null): Session | null {
  const sessions = useSessionStore((s) => s.sessions);
  const blocks = useCommandStore((s) => s.blocks);
  const groups = useTaskStore((s) => s.groups);
  const editorBySession = useEditorStore((s) => s.bySession);

  return useMemo(() => {
    if (!sessionId) return null;
    const info = sessions.get(sessionId);
    if (!info) return null;

    const tasks = blocks.filter((b) => b.sessionId === sessionId);
    // currentFlow 从最近一条 TaskGroup.query 取，没有则置空
    const latestGroup = groups.find((g) => g.sessionId === sessionId);
    const currentFlow = latestGroup?.query ?? '';

    const terminal = emptyTerminalData();
    const editor = editorBySession[sessionId] ?? emptyEditorData();
    const blocksData = { ...emptyBlocksData(), tasks, currentFlow };

    return {
      id: info.id,
      name: info.title || info.id,
      mode: info.mode ?? 'terminal',
      createdAt: info.createdAt,
      lastAccessed: info.lastAccessed ?? info.createdAt,
      info,
      data: {
        terminal,
        blocks: blocksData,
        editor,
      },
    };
  }, [sessionId, sessions, blocks, groups, editorBySession]);
}

/**
 * 便捷选择器：获取当前激活的 Session
 */
export function useActiveSession(): Session | null {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  return useSession(activeSessionId);
}
