import { useRef, useState, useCallback, useEffect } from 'react';
import { useSessionStream } from '@/hooks/useSessionStream';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskBlockStore } from '@/stores/taskBlockStore';
import { useTaskMonitor } from '@/hooks/useTaskMonitor';
import { LoggerService } from '@/lib/loggerService';
import { TerminalRenderer } from './TerminalRenderer';
import { TaskBlockOverlay } from './TaskBlockOverlay';
import type { TerminalRendererHandle } from './TerminalRenderer';

// ─── ANSI decoration helpers ────────────────────────────────────

function writeCommandHeader(term: TerminalRendererHandle | null, command: string) {
  if (!term) return;
  const label = command.length > 80 ? command.slice(0, 77) + '...' : command;
  term.write(
    `\r\n\x1b[48;2;30;30;30m\x1b[1m\x1b[38;2;220;220;220m ❯ ${label} \x1b[0m\r\n`,
  );
}

function writeCommandFooter(term: TerminalRendererHandle | null) {
  if (!term) return;
  // Use xterm.js decoration API for a window-width-adaptive separator line.
  // This is a rendered overlay, not a text character — it never wraps or misaligns.
  term.registerSeparator();
}

// ─── UnifiedSessionPanel ────────────────────────────────────────

interface UnifiedSessionPanelProps {
  sessionId: string | null;
  isVisible?: boolean;
}

export function UnifiedSessionPanel({
  sessionId,
  isVisible,
}: UnifiedSessionPanelProps) {
  const terminalRef = useRef<TerminalRendererHandle | null>(null);

  // Batched LoggerService writer — avoids filesystem I/O on every chunk.
  const logBufferRef = useRef<string[]>([]);
  const logBufferBytesRef = useRef(0);  // Incremental byte count — avoids O(n) reduce
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LOG_FLUSH_MS = 500;
  const LOG_MAX_BYTES = 64 * 1024;

  const flushLogBuffer = useCallback((sid: string) => {
    if (logBufferRef.current.length === 0) return;
    const meta = useSessionStore.getState().resolveTerminalMeta(sid);
    if (meta?.isLogging) {
      const { logging } = useSettingsStore.getState().settings;
      LoggerService.write(logging, meta.sessionName, meta.terminalName, logBufferRef.current.join(''));
    }
    logBufferRef.current = [];
    logBufferBytesRef.current = 0;  // Reset counter
  }, []);

  // ── Task monitor: accumulate output chunks for realtime task keyword matching ──
  const monitorChunksRef = useRef<string[]>([]);
  const [monitorTick, setMonitorTick] = useState(0);

  // ── Task monitor hook (re-runs when monitorTick changes) ──
  useTaskMonitor({ sessionId, outputChunks: monitorChunksRef.current, tick: monitorTick });

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (logTimerRef.current) clearTimeout(logTimerRef.current);
      if (sessionId) flushLogBuffer(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleTerminalOutput = useCallback((data: string) => {
    terminalRef.current?.write(data);
    // Feed output to task monitor
    if (data) {
      monitorChunksRef.current.push(data);
      setMonitorTick((n) => n + 1); // trigger re-render so useTaskMonitor sees new chunks
    }
    if (sessionId && data) {
      logBufferRef.current.push(data);
      logBufferBytesRef.current += data.length;  // O(1) — no reduce!
      
      if (logBufferBytesRef.current >= LOG_MAX_BYTES) {
        if (logTimerRef.current) { clearTimeout(logTimerRef.current); logTimerRef.current = null; }
        flushLogBuffer(sessionId);
      } else if (!logTimerRef.current) {
        logTimerRef.current = setTimeout(() => {
          logTimerRef.current = null;
          flushLogBuffer(sessionId);
        }, LOG_FLUSH_MS);
      }
    }
  }, [sessionId, flushLogBuffer]);

  const handleCommandStart = useCallback((command: string) => {
    writeCommandHeader(terminalRef.current, command);
    const line = terminalRef.current?.getCurrentLine() ?? 0;
    useTaskBlockStore.getState().startBlock(command, line);
  }, []);

  const handleCommandEnd = useCallback((_exitCode: number) => {
    writeCommandFooter(terminalRef.current);
    const line = terminalRef.current?.getCurrentLine() ?? 0;
    useTaskBlockStore.getState().endBlock(line);
  }, []);

  const handleConnectionReady = useCallback(() => {
    terminalRef.current?.fit();
    terminalRef.current?.setConnectionReady();
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
      terminalRef.current?.focus();
    }, 100);
  }, []);

  useSessionStream({
    sessionId,
    onTerminalOutput: handleTerminalOutput,
    onConnectionReady: handleConnectionReady,
    onCommandStart: handleCommandStart,
    onCommandEnd: handleCommandEnd,
  });

  // Timeout fallback: if no output arrives, force ready + fit + delayed focus.
  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(() => {
      terminalRef.current?.fit();
      terminalRef.current?.setConnectionReady();
      setTimeout(() => {
        window.getSelection()?.removeAllRanges();
        terminalRef.current?.focus();
      }, 100);
    }, 800);
    return () => clearTimeout(timer);
  }, [sessionId]);

  // ── Task block expand handler ──
  const handleExpandBlock = useCallback((_block: import('@/stores/taskBlockStore').TaskBlock) => {
    // When expanding, dispose the dimming decorations
    const t = terminalRef.current;
    if (!t) return;
    for (const decoId of _block.decorationIds) {
      t.disposeDecoration(decoId);
    }
    useTaskBlockStore.getState().clearDecorations(_block.id);
  }, []);

  // ── Collapse decoration effect ──
  useEffect(() => {
    const unsub = useTaskBlockStore.subscribe((state, prev) => {
      for (const block of state.blocks) {
        const prevBlock = prev.blocks.find((b) => b.id === block.id);
        if (!prevBlock || prevBlock.collapsed === block.collapsed) continue;

        const t = terminalRef.current;
        if (!t) continue;

        if (block.collapsed) {
          // Register a dimming decoration over collapsed rows
          const lineCount = block.endLine - block.startLine;
          if (lineCount <= 0) continue;
          const decoId = t.registerLineDecoration(
            block.startLine,
            lineCount,
            'rgba(0,0,0,0.35)',
          );
          if (decoId !== undefined) {
            useTaskBlockStore.getState().addDecoration(block.id, decoId);
          }
        } else {
          // Remove dimming decorations
          for (const decoId of block.decorationIds) {
            t.disposeDecoration(decoId);
          }
          useTaskBlockStore.getState().clearDecorations(block.id);
        }
      }
    });
    return unsub;
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
      <div className="flex-1 min-h-0 flex flex-col">
        <TerminalRenderer
          ref={terminalRef}
          sessionId={sessionId}
          isVisible={isVisible}
        />
      </div>
      <TaskBlockOverlay
        terminalRef={terminalRef}
        onExpandBlock={handleExpandBlock}
      />
    </div>
  );
}
