import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSessionLogStore } from '@/stores/sessionLogStore';

// ─── Batched log store writes ────────────────────────────────────
// Calling appendLog on every output chunk costs ~46ms per call when
// the event array is large (array copies).  Instead, batch output
// events and flush at most once per second.
//
// Optimisation (May 2026):
//  - Track totalChars incrementally (no O(n) .reduce() on every push).
//  - During burst, merge consecutive output chunks into fewer events
//    to reduce the number of appendLog calls.

interface LogBatchEntry {
  chunks: string[];
  totalChars: number;
}

const logBatch: Map<string, LogBatchEntry> = new Map();
let logBatchTimer: ReturnType<typeof setTimeout> | null = null;
const LOG_BATCH_FLUSH_MS = 1000;
const LOG_BATCH_MAX_CHARS = 32 * 1024; // 32 KB

function flushLogBatch() {
  logBatchTimer = null;
  const { appendLog } = useSessionLogStore.getState();
  for (const [sid, entry] of logBatch) {
    if (entry.chunks.length > 0) {
      const merged = entry.chunks.join('');
      appendLog(sid, 'output', { data: merged });
    }
  }
  logBatch.clear();
}

function appendLogBatched(sessionId: string, data: string) {
  let entry = logBatch.get(sessionId);
  if (!entry) {
    entry = { chunks: [], totalChars: 0 };
    logBatch.set(sessionId, entry);
  }
  entry.chunks.push(data);
  entry.totalChars += data.length;

  // Flush if batch is large enough
  if (entry.totalChars >= LOG_BATCH_MAX_CHARS) {
    if (logBatchTimer) { clearTimeout(logBatchTimer); logBatchTimer = null; }
    flushLogBatch();
    return;
  }

  if (!logBatchTimer) {
    logBatchTimer = setTimeout(flushLogBatch, LOG_BATCH_FLUSH_MS);
  }
}

/**
 * Tagged-union payload from the Rust `SessionEvent` enum.
 * Mirrors `src-tauri/src/stream/event.rs`.
 */
interface SessionEventPayload {
  type: string; // kebab-case discriminant: "output" | "command-start" | "command-end" | "block-output" | "session-ended" | "session-error"
  session_id: string;
  data?: string;
  command_id?: string;
  command?: string;
  exit_code?: number;
  error?: string;
}

/**
 * Unified session stream hook.
 *
 * Listens to the single `session-event` Tauri channel (3.0) and dispatches
 * each variant to the correct consumer:
 *   - Output / BlockOutput → sessionLogStore.appendLog
 *   - CommandStart / CommandEnd → sessionLogStore.appendLog
 *   - SessionEnded / SessionError → forwarded to caller callbacks
 *
 * Also provides backward-compat by continuing to emit the xterm.js write
 * via a callback, keeping TerminalRenderer decoupled from the store.
 */
interface UseSessionStreamOptions {
  sessionId: string | null;
  /** Called for terminal output (xterm.js write). */
  onTerminalOutput?: (data: string) => void;
  /** Called once when the first output arrives (PTY/shell is ready for input). */
  onConnectionReady?: () => void;
  /** Called when a new command starts. Receives command text. */
  onCommandStart?: (command: string) => void;
  /** Called when a command ends. Receives exit code. */
  onCommandEnd?: (exitCode: number) => void;
  /** Called when the session ends. */
  onSessionEnded?: () => void;
  /** Called when a session error occurs. */
  onSessionError?: (error: string) => void;
}

export function useSessionStream({
  sessionId,
  onTerminalOutput,
  onConnectionReady,
  onCommandStart,
  onCommandEnd,
  onSessionEnded,
  onSessionError,
}: UseSessionStreamOptions) {
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const callbacksRef = useRef({ onTerminalOutput, onConnectionReady, onCommandStart, onCommandEnd, onSessionEnded, onSessionError });
  callbacksRef.current = { onTerminalOutput, onConnectionReady, onCommandStart, onCommandEnd, onSessionEnded, onSessionError };

  const readyFiredRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;

    readyFiredRef.current = false;

    let cancelled = false;
    const localUnlisteners: UnlistenFn[] = [];

    (async () => {
      const unlisten = await listen<SessionEventPayload>('session-event', (event) => {
        if (cancelled) return;

        const p = event.payload;
        if (p.session_id !== sessionIdRef.current) return;

        const { appendLog } = useSessionLogStore.getState();
        const cbs = callbacksRef.current;

        switch (p.type) {
          case 'output':
            if (p.data) {
              if (!readyFiredRef.current) {
                readyFiredRef.current = true;
                cbs.onConnectionReady?.();
              }
              cbs.onTerminalOutput?.(p.data);
              // Batched — avoids 46ms Zustand array copy on every chunk
              appendLogBatched(sessionIdRef.current!, p.data);
            }
            break;

          case 'block-output':
            if (p.data) {
              appendLog(sessionIdRef.current!, 'block-output', { data: p.data });
            }
            break;

          case 'command-start':
            appendLog(sessionIdRef.current!, 'command-start', {
              commandId: p.command_id ?? '',
              command: p.command ?? '',
            });
            cbs.onCommandStart?.(p.command ?? '');
            break;

          case 'command-end':
            appendLog(sessionIdRef.current!, 'command-end', {
              commandId: p.command_id ?? '',
              exitCode: p.exit_code ?? 0,
            });
            cbs.onCommandEnd?.(p.exit_code ?? 0);
            break;

          case 'session-ended':
            appendLog(sessionIdRef.current!, 'system', {
              event: 'session-ended',
              sessionId: p.session_id,
            });
            cbs.onSessionEnded?.();
            break;

          case 'session-error':
            appendLog(sessionIdRef.current!, 'system', {
              event: 'session-error',
              sessionId: p.session_id,
              error: p.error ?? '',
            });
            cbs.onSessionError?.(p.error ?? 'Unknown error');
            break;
        }
      });

      if (cancelled) {
        try { unlisten(); } catch { /* Tauri may already have cleaned up */ }
        return;
      }
      localUnlisteners.push(unlisten);
    })();

    return () => {
      cancelled = true;
      for (const u of localUnlisteners) {
        try { u(); } catch { /* Tauri may already have cleaned up */ }
      }
      localUnlisteners.length = 0;
    };
  }, [sessionId]);
}
