import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Zap, Terminal } from 'lucide-react';
import { detectInputType } from '@/lib/aiDetect';
import {
  parseControlCommand,
  executeControlIntent,
  getPendingConfirmation,
  clearPendingConfirmation,
  parseConfirmationResponse,
} from '@/lib/commandParser';

interface CommandInputProps {
  sessionId: string | null;
  onExecute: (command: string) => Promise<string | null>;
  onAiSubmit?: (query: string) => Promise<void>;
  onAiCancel?: () => void;
  isExecuting: boolean;
  isAiLoading?: boolean;
  aiError?: string | null;
  onClearAiError?: () => void;
}

export function CommandInput({ sessionId, onExecute, onAiSubmit, onAiCancel, isExecuting, isAiLoading, aiError, onClearAiError }: CommandInputProps) {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [controlMsg, setControlMsg] = useState<string | null>(null);
  const historyRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const detected = value.trim() ? detectInputType(value.trim()) : null;
  const isAiMode = detected?.type === 'ai';
  const isControlCmd = value.trim() ? parseControlCommand(value.trim()) !== null : false;
  const isBusy = isExecuting || (isAiLoading ?? false);

  const handleSubmit = useCallback(async () => {
    const cmd = value.trim();
    if (!cmd || isBusy) return;

    historyRef.current.push(cmd);
    setHistoryIndex(-1);
    setValue('');
    setControlMsg(null);

    // ── Step 0: check for pending confirmation response (是/否) ──
    const pending = getPendingConfirmation();
    if (pending) {
      const response = parseConfirmationResponse(cmd);
      if (response === true) {
        await pending.action();
        setControlMsg(`已创建会话 "${pending.sessionName}"`);
      } else if (response === false) {
        setControlMsg('已取消');
      } else {
        // Not a valid yes/no — treat as normal input, but remind
        setControlMsg(pending.message);
        return;
      }
      clearPendingConfirmation();
      return;
    }

    // ── Step 1: check for UI control commands ──
    const intent = parseControlCommand(cmd);
    if (intent) {
      const result = await executeControlIntent(intent);
      if (result.message) setControlMsg(result.message);
      return; // handled — don't send to terminal or AI
    }

    // ── Step 2: existing shell vs AI routing ──
    const detection = detectInputType(cmd);
    if (detection.type === 'ai' && onAiSubmit) {
      onClearAiError?.();
      await onAiSubmit(detection.text);
    } else {
      await onExecute(cmd);
    }
  }, [value, isBusy, onExecute, onAiSubmit, onClearAiError]);

  const handleCancel = useCallback(async () => {
    // If AI is loading, cancel the AI request
    if (isAiLoading) {
      onAiCancel?.();
      return;
    }
    // Otherwise send Ctrl+C to the terminal
    if (!sessionId) return;
    try {
      await invoke('write_to_terminal', { sessionId, data: '\x03' });
    } catch (err) {
      console.error('Failed to send SIGINT:', err);
    }
  }, [sessionId, isAiLoading, onAiCancel]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      // Ctrl+C while a command is running
      if (e.key === 'c' && e.ctrlKey && isExecuting) {
        e.preventDefault();
        handleCancel();
        return;
      }

      // History navigation
      const history = historyRef.current;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (history.length === 0) return;
        const next = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(next);
        setValue(history[next]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex === -1) return;
        const next = historyIndex + 1;
        if (next >= history.length) {
          setHistoryIndex(-1);
          setValue('');
        } else {
          setHistoryIndex(next);
          setValue(history[next]);
        }
      }
    },
    [handleSubmit, handleCancel, isExecuting, historyIndex],
  );

  return (
    <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--deep)]">
      {/* AI error banner */}
      {aiError && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--red)]/10 border-b border-[var(--red)]/20">
          <span className="text-[10px] text-[var(--red)] flex-1 truncate">{aiError}</span>
          <button
            onClick={onClearAiError}
            className="text-[9px] text-[var(--red)] hover:text-[var(--text-1)] transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Control command feedback */}
      {controlMsg && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--yellow)]/10 border-b border-[var(--yellow)]/20">
          <span className="text-[10px] text-[var(--yellow)] flex-1 truncate">{controlMsg}</span>
          <button onClick={() => setControlMsg(null)} className="text-[9px] text-[var(--yellow)] hover:text-[var(--text-1)] transition-colors">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {/* Prompt indicator */}
        <span className={`text-[13px] font-mono select-none flex-shrink-0 ${
          isControlCmd ? 'text-[var(--cyan)]' : isAiMode ? 'text-[var(--magenta)]' : 'text-[var(--accent-hi)]'
        }`}>
          {isControlCmd ? '▸' : isAiMode ? '>' : '$'}
        </span>

        {/* Input field — always enabled for global control commands */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); onClearAiError?.(); setControlMsg(null); }}
          onKeyDown={handleKeyDown}
          placeholder={
            isAiLoading ? 'AI thinking...'
            : isExecuting ? 'Running...'
            : sessionId ? 'Command, /ai ask AI, or "打开 <name> 会话"'
            : '"打开 <name> 会话" / "新建终端" / "连接到 <host>"'
          }
          autoFocus
          className={`flex-1 bg-transparent text-[13px] font-mono text-[var(--text-1)] placeholder:text-[var(--text-4)] outline-none ${
            isBusy ? 'opacity-50' : ''
          }`}
        />

        {/* Control command badge */}
        {isControlCmd && !isBusy && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-[var(--cyan)] border border-[var(--cyan)]/30 bg-[var(--cyan)]/5">
            <Terminal className="w-2.5 h-2.5" />
            CMD
          </span>
        )}

        {/* AI mode badge */}
        {isAiMode && !isBusy && !isControlCmd && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-[var(--magenta)] border border-[var(--magenta)]/30 bg-[var(--magenta)]/5">
            <Zap className="w-2.5 h-2.5" />
            AI
          </span>
        )}

        {/* Status / action button */}
        {isAiLoading ? (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-[var(--magenta)]">
            <Loader2 className="w-3 h-3 animate-spin" />
          </span>
        ) : isExecuting ? (
          <button
            onClick={handleCancel}
            title="Cancel (Ctrl+C)"
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-[var(--red)] border border-[var(--red)]/30 hover:bg-[var(--red)]/10 transition-colors"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            Cancel
          </button>
        ) : (
          <kbd className="text-[10px] text-[var(--text-4)] border border-[var(--border)] rounded px-1.5 py-0.5">
            Enter
          </kbd>
        )}
      </div>

      {/* Hints */}
      <div className="flex items-center gap-3 px-3 pb-1.5 text-[9px] text-[var(--text-4)]">
        <span>Enter execute</span>
        <span>&middot;</span>
        <span>&uarr;&darr; history</span>
        <span>&middot;</span>
        <span>/ai ask AI</span>
        <span>&middot;</span>
        <span>Ctrl+C cancel</span>
        <span>&middot;</span>
        <span>"打开 X 会话"</span>
      </div>
    </div>
  );
}
