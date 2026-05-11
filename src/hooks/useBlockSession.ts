/**
 * @deprecated Since 3.0.  Use {@link useSessionStream} from `@/hooks/useSessionStream`
 * instead.  The unified `session-event` channel replaces the separate
 * `block-cmd-started` / `block-cmd-completed` / `block-output` events.
 *
 * Kept for backward compatibility with legacy code.
 */
import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useCommandStore } from '@/stores/commandStore';
import type {
  BlockCmdStartedPayload,
  BlockCmdCompletedPayload,
} from '@/models/block';

interface UseBlockSessionOptions {
  sessionId: string | null;
}

interface UseBlockSessionReturn {
  executeCommand: (command: string) => Promise<string | null>;
  isExecuting: boolean;
}

/**
 * Bridge hook that listens to block-cmd-* Tauri events and updates commandStore.
 * Should be mounted at the Layout level so events are captured regardless of
 * which view (Terminal / Blocks / Editor) is currently active.
 */
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

  // ---- Listen to Tauri events ----
  useEffect(() => {
    if (!sessionId) return;

    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      // block-cmd-started: mark the command as running
      unlisteners.push(
        await listen<BlockCmdStartedPayload>('block-cmd-started', (event) => {
          const { session_id, command_id } = event.payload;
          if (session_id === sessionIdRef.current) {
            setCommandRunning(command_id);
          }
        }),
      );

      // block-cmd-completed: mark the command as success/error
      unlisteners.push(
        await listen<BlockCmdCompletedPayload>('block-cmd-completed', (event) => {
          const { session_id, command_id, exit_code } = event.payload;
          if (session_id === sessionIdRef.current) {
            setCommandCompleted(command_id, exit_code);
          }
        }),
      );

      // block-output: StreamCleaner-sanitized stream for Blocks view.
      // It excludes prompts, echoed commands and shell-integration noise.
      unlisteners.push(
        await listen<{ session_id: string; data: string }>('block-output', (event) => {
          const { session_id, data } = event.payload;
          if (session_id !== sessionIdRef.current) return;

          // Find the currently running block for this session
          const running = useCommandStore
            .getState()
            .blocks.find(
              (b) => b.sessionId === session_id && b.status === 'running',
            );
          if (running) {
            useCommandStore.getState().appendCommandOutput(running.id, data);
          }
        }),
      );

      // session-ended: mark any running command as error
      unlisteners.push(
        await listen<{ session_id: string }>('session-ended', (event) => {
          if (event.payload.session_id === sessionIdRef.current) {
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
          }
        }),
      );
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => { try { fn(); } catch { /* Tauri may already have cleaned up */ } });
    };
  }, [sessionId, setCommandRunning, setCommandCompleted, setCommandError]);

  // ---- Execute a command ----
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

  // ---- Derived state ----
  const isExecuting = sessionId
    ? blocks.some((b) => b.sessionId === sessionId && b.status === 'running')
    : false;

  return { executeCommand, isExecuting };
}
