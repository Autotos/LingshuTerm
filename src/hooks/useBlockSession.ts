/**
 * Bridge hook that listens to 3.0 unified session-event for block command
 * start/complete, and updates commandStore accordingly.
 */
import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useCommandStore } from '@/stores/commandStore';

interface UseBlockSessionOptions {
  sessionId: string | null;
}

interface UseBlockSessionReturn {
  executeCommand: (command: string) => Promise<string | null>;
  isExecuting: boolean;
}

export function useBlockSession({
  sessionId,
}: UseBlockSessionOptions): UseBlockSessionReturn {
  const {
    addCommand,
    setCommandRunning,
    setCommandCompleted,
    setCommandError,
    blocks,
  } = useCommandStore();

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // ── Listen to 3.0 unified session-event ──
  useEffect(() => {
    if (!sessionId) return;

    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      unlisteners.push(
        await listen<{ type: string; session_id: string; command_id: string; command?: string }>(
          'session-event',
          (event) => {
            if (event.payload.session_id !== sessionIdRef.current) return;

            if (event.payload.type === 'command-start') {
              setCommandRunning(event.payload.command_id);
            } else if (event.payload.type === 'command-end') {
              setCommandCompleted(
                event.payload.command_id,
                (event.payload as any).exit_code ?? 0,
              );
            }
          },
        ),
      );

      // session-ended: mark any running command as error
      unlisteners.push(
        await listen<{ type: string; session_id: string }>(
          'session-event',
          (event) => {
            if (event.payload.session_id !== sessionIdRef.current) return;
            if (event.payload.type !== 'session-ended') return;

            const running = useCommandStore
              .getState()
              .blocks.find(
                (b) =>
                  b.sessionId === event.payload.session_id &&
                  b.status === 'running',
              );
            if (running) {
              setCommandError(running.id, '[Session terminated]');
            }
          },
        ),
      );
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    };
  }, [sessionId, setCommandRunning, setCommandCompleted, setCommandError]);

  // ── Execute a command ──
  const executeCommand = useCallback(
    async (command: string): Promise<string | null> => {
      if (!sessionIdRef.current) return null;
      try {
        const commandId: string = await invoke('execute_block_command', {
          sessionId: sessionIdRef.current,
          command,
        });
        addCommand(sessionIdRef.current, commandId, command);
        return commandId;
      } catch (err) {
        console.error('execute_block_command failed:', err);
        return null;
      }
    },
    [addCommand],
  );

  const isExecuting = sessionId
    ? blocks.some((b) => b.sessionId === sessionId && b.status === 'running')
    : false;

  return { executeCommand, isExecuting };
}
