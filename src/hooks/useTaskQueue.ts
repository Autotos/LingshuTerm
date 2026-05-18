import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTaskStore, getNextPendingTask, hasRunningTask } from '@/stores/taskStore';

interface UseTaskQueueOptions {
  sessionId: string | null;
}

/**
 * Task queue execution engine.
 * Sequentially executes pending tasks from active groups.
 * Listens to the 3.0 unified `session-event` channel for command-start/command-end.
 */
export function useTaskQueue({ sessionId }: UseTaskQueueOptions) {
  const processingRef = useRef(false);
  const currentTaskRef = useRef<{ groupId: string; taskId: string; commandId: string } | null>(null);

  // Process the next task in queue
  const processNext = useCallback(async () => {
    if (!sessionId || processingRef.current) return;

    const { groups, setTaskStatus, setTaskError } = useTaskStore.getState();

    for (const group of groups) {
      if (group.sessionId !== sessionId) continue;
      if (group.paused) continue;
      if (hasRunningTask(group)) return;

      const next = getNextPendingTask(group);
      if (!next) continue;

      processingRef.current = true;
      setTaskStatus(group.id, next.id, 'running');

      try {
        const commandId: string = await invoke('execute_block_command', {
          sessionId,
          command: next.command,
        });
        currentTaskRef.current = { groupId: group.id, taskId: next.id, commandId };
      } catch (err) {
        setTaskError(group.id, next.id, err instanceof Error ? err.message : String(err));
        currentTaskRef.current = null;
      } finally {
        processingRef.current = false;
      }
      return;
    }
  }, [sessionId]);

  // Listen to 3.0 unified session-event for command completion
  useEffect(() => {
    if (!sessionId) return;

    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      // command-start: confirms task is running
      unlisteners.push(
        await listen<{ type: string; session_id: string; command_id: string; command?: string }>(
          'session-event',
          (event) => {
            if (event.payload.session_id !== sessionId) return;
            if (event.payload.type !== 'command-start') return;
            // Task already marked running in processNext; output will arrive
          },
        ),
      );

      // command-end: task completed → trigger next
      unlisteners.push(
        await listen<{ type: string; session_id: string; command_id: string; exit_code?: number }>(
          'session-event',
          (event) => {
            if (event.payload.session_id !== sessionId) return;
            if (event.payload.type !== 'command-end') return;

            const current = currentTaskRef.current;
            if (current && current.commandId === event.payload.command_id) {
              useTaskStore.getState().completeTask(
                current.groupId,
                current.taskId,
                event.payload.exit_code ?? 0,
              );
              currentTaskRef.current = null;
              setTimeout(processNext, 150);
            }
          },
        ),
      );
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    };
  }, [sessionId, processNext]);

  // Store subscription: fire processNext when new groups/tasks are added
  useEffect(() => {
    const unsub = useTaskStore.subscribe(() => {
      if (!processingRef.current && !currentTaskRef.current) {
        processNext();
      }
    });
    return unsub;
  }, [processNext]);

  const triggerProcess = useCallback(() => {
    processNext();
  }, [processNext]);

  return { triggerProcess };
}
