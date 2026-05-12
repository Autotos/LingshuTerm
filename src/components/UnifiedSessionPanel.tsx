import { useRef, useCallback, useEffect } from 'react';
import { useSessionStream } from '@/hooks/useSessionStream';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { LoggerService } from '@/lib/loggerService';
import { TerminalRenderer } from './TerminalRenderer';
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
  term.write(
    `\x1b[38;2;51;51;51m────────────────────────────────────────────────────────────────────────────────────────────────────\x1b[0m\r\n`,
  );
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

  const handleTerminalOutput = useCallback((data: string) => {
    terminalRef.current?.write(data);
    if (sessionId && data) {
      const meta = useSessionStore.getState().resolveTerminalMeta(sessionId);
      if (meta?.isLogging) {
        const { logging } = useSettingsStore.getState().settings;
        LoggerService.write(logging, meta.sessionName, meta.terminalName, data);
      }
    }
  }, [sessionId]);

  const handleCommandStart = useCallback((command: string) => {
    writeCommandHeader(terminalRef.current, command);
  }, []);

  const handleCommandEnd = useCallback((_exitCode: number) => {
    writeCommandFooter(terminalRef.current);
  }, []);

  const handleConnectionReady = useCallback(() => {
    // 1. Force fit NOW (synchronous) so the first output renders at the
    //    correct dimensions — fixes the blank first-line issue.
    terminalRef.current?.fit();
    // 2. Flush buffered keystrokes now that the PTY can accept input.
    terminalRef.current?.setConnectionReady();
    // 3. Delayed focus — after the WebGL renderer has painted the first
    //    frame.  setTimeout (not rAF) ensures the paint cycle is complete.
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

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="flex-1 min-h-0 flex flex-col">
        <TerminalRenderer
          ref={terminalRef}
          sessionId={sessionId}
          isVisible={isVisible}
        />
      </div>
    </div>
  );
}
