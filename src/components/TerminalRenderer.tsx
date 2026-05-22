import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTerminal } from '@/hooks/useTerminal';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';

// ─── Performance monitoring ──────────────────────────────────────────

const PERF_LONG_TASK_MS = 100;

if (typeof PerformanceObserver !== 'undefined') {
  try {
    const perfObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > PERF_LONG_TASK_MS) {
          console.warn(
            `[Terminal Perf] Long task ${entry.duration.toFixed(0)} ms:`,
            entry.name,
          );
        }
      }
    });
    perfObs.observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask type not supported in this browser
  }
}

// ─── Event-loop heartbeat ────────────────────────────────────────

(function installHeartbeat() {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const delta = now - last;
    if (delta > 2000) {
      console.error(
        `[Terminal Freeze] Event loop stalled ${delta.toFixed(0)} ms`,
      );
    }
    last = now;
  }, 1000);
})();

export interface TerminalRendererHandle {
  write: (data: string) => void;
  clear: () => void;
  getSelection: () => string;
  fit: () => void;
  setConnectionReady: () => void;
  focus: () => void;
  getCols: () => number;
  wake: () => void;
  registerSeparator: () => void;
  getCurrentLine: () => number;
  registerLineDecoration: (lineNum: number, height: number, color: string) => number | undefined;
  disposeDecoration: (id: number) => void;
}

interface TerminalRendererProps {
  sessionId: string | null;
  isVisible?: boolean;
}

// ─── Write queue with overflow protection ─────────────────────────
// xterm.js terminal.write() has its own internal WriteBuffer that:
//  1) Queues data in _writeBuffer array
//  2) Processes chunks with 12ms timeout (WRITE_TIMEOUT_MS)
//  3) Automatically yields via setTimeout to let renderer catch up
//
// Our job is ONLY to:
//  - Merge small chunks into larger batches (reducing terminal.write() calls)
//  - Cap the queue at 256KB to prevent memory explosion
//  - Dynamically reduce scrollback during burst for performance
//  - Let xterm's WriteBuffer handle the actual throttling

const OVERFLOW_THRESHOLD = 512 * 1024;      // 512 KB — emergency trim threshold (increased from 256KB)
const OVERFLOW_KEEP_TAIL = 64 * 1024;       // Keep last 64KB when trimming (increased from 32KB)
const BURST_COOLDOWN_MS = 1000;             // Restore scrollback after 1s idle
const SCROLLBACK_BURST = 500;               // Reduced scrollback during burst (allows scrolling)
const BATCH_FLUSH_MS = 8;                   // Merge chunks for 8ms (faster flush, less queuing)
const MAX_WRITE_SIZE = 4 * 1024;            // Max 4KB per terminal.write() call (reduced for faster chunks)
const MIN_WRITE_INTERVAL_MS = 16;           // Min 16ms between writes (60fps max, faster consumption)

function createChunkedWriter(
  terminalRef: React.RefObject<import('@xterm/xterm').Terminal | null>,
  _sessionId: string | null,
  originalScrollback: number,
) {
  let queue: string[] = [];
  let totalQueued = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let burstActive = false;
  let burstCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWriteTime = 0;  // Track last write to enforce MIN_WRITE_INTERVAL_MS


  // ── Burst detection: reduce scrollback when queue is large ──
  function activateBurst() {
    if (burstActive) return;
    burstActive = true;
    if (burstCooldownTimer) { clearTimeout(burstCooldownTimer); burstCooldownTimer = null; }
    const term = terminalRef.current;
    if (term && term.options.scrollback !== SCROLLBACK_BURST) {
      term.options.scrollback = SCROLLBACK_BURST;
    }
  }

  function scheduleBurstCooldown() {
    if (!burstActive) return;
    if (burstCooldownTimer) return;
    burstCooldownTimer = setTimeout(() => {
      burstCooldownTimer = null;
      burstActive = false;
      const term = terminalRef.current;
      if (term) {
        term.options.scrollback = originalScrollback;
        term.refresh(0, term.rows - 1);
      }
    }, BURST_COOLDOWN_MS);
  }

  // ── Emergency trim: when queue > OVERFLOW_THRESHOLD ──
  function emergencyTrim() {
    const merged = queue.join('');
    const keep = merged.slice(merged.length - OVERFLOW_KEEP_TAIL);
    const notice = '\r\n\x1b[33m\u2026 [output truncated \u2014 too fast] \u2026\x1b[0m\r\n';
    const term = terminalRef.current;
    if (term) {
      term.write(notice + keep);
    }
    queue = [];
    totalQueued = 0;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  // ── Flush merged batch to xterm ──
  function flushToTerminal() {
    flushTimer = null;
    if (queue.length === 0) {
      scheduleBurstCooldown();
      return;
    }

    const term = terminalRef.current;
    if (!term) {
      // Terminal not ready, retry later
      flushTimer = setTimeout(flushToTerminal, 50);
      return;
    }

    // Merge all queued chunks into ONE string
    const merged = queue.join('');
    queue = [];
    totalQueued = 0;

    // Pass merged data to xterm in chunks of MAX_WRITE_SIZE.
    // xterm's WriteBuffer has a 12ms timeout, but large writes (28KB+)
    // can still block the main thread. Split into 16KB chunks with
    // 16ms minimum interval between them to give WebGL time to render.
    if (merged.length <= MAX_WRITE_SIZE) {
      const now = performance.now();
      const timeSinceLastWrite = now - lastWriteTime;
      const delay = Math.max(0, MIN_WRITE_INTERVAL_MS - timeSinceLastWrite);
      
      if (delay > 0) {
        setTimeout(() => {
          term.write(merged);
          term.scrollToBottom();
          lastWriteTime = performance.now();
          if (queue.length > 0) {
            flushTimer = setTimeout(flushToTerminal, BATCH_FLUSH_MS);
          } else {
            scheduleBurstCooldown();
          }
        }, delay);
        return;
      }

      // No delay needed, write immediately
      term.write(merged);
      term.scrollToBottom();
      lastWriteTime = performance.now();
    } else {
      let off = 0;
      const t = term;
      function writeNextChunk() {
        if (off >= merged.length) {
          t.scrollToBottom();
          if (queue.length > 0) {
            flushTimer = setTimeout(flushToTerminal, BATCH_FLUSH_MS);
          } else {
            scheduleBurstCooldown();
          }
          return;
        }
        const end = Math.min(off + MAX_WRITE_SIZE, merged.length);
        const now = performance.now();
        const timeSinceLastWrite = now - lastWriteTime;
        const delay = Math.max(0, MIN_WRITE_INTERVAL_MS - timeSinceLastWrite);
        
        t.write(merged.slice(off, end));
        lastWriteTime = now;
        off = end;
        
        // Enforce minimum interval between writes to give WebGL time to render
        setTimeout(writeNextChunk, delay);
      }
      writeNextChunk();
      return;  // Async path — don't fall through to the sync path below
    }

    // If more data arrived while xterm is processing, schedule another flush
    term.scrollToBottom();
    if (queue.length > 0) {
      flushTimer = setTimeout(flushToTerminal, BATCH_FLUSH_MS);
    } else {
      scheduleBurstCooldown();
    }
  }

  function enqueue(data: string) {
    if (!data) return;
    queue.push(data);
    totalQueued += data.length;

    // Burst detection: activate when queue exceeds 1/4 of overflow threshold
    if (totalQueued > OVERFLOW_THRESHOLD / 4) activateBurst();

    // Emergency overflow: trim old data to prevent unbounded growth
    if (totalQueued > OVERFLOW_THRESHOLD) emergencyTrim();

    // Schedule a batch flush if not already scheduled
    if (!flushTimer) {
      flushTimer = setTimeout(flushToTerminal, BATCH_FLUSH_MS);
    }
  }

  function dispose() {
    // Cancel pending flush
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    // Flush remaining data synchronously before disposal
    const term = terminalRef.current;
    if (term && queue.length > 0) {
      term.write(queue.join(''));
    }
    queue = [];
    totalQueued = 0;
    if (burstCooldownTimer) { clearTimeout(burstCooldownTimer); burstCooldownTimer = null; }
    // Restore scrollback
    if (term) term.options.scrollback = originalScrollback;
  }

  return { enqueue, dispose };
}

/**
 * Pure terminal renderer — wraps xterm.js.
 *
 * In 3.0 this component does NOT directly listen to Tauri events.
 * The parent (UnifiedSessionPanel) subscribes via useSessionStream and
 * calls `ref.write(data)` for each Output event.
 */
export const TerminalRenderer = forwardRef<TerminalRendererHandle, TerminalRendererProps>(
  function TerminalRenderer({ sessionId, isVisible }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [frozen, setFrozen] = useState(false);

    const { terminal, terminalRef, fit, clear, getSelection, setConnectionReady, wake } = useTerminal({
      containerRef,
      sessionId,
    });

    // Chunked writer — keeps the UI responsive under massive output
    const writerRef = useRef<ReturnType<typeof createChunkedWriter> | null>(null);
    if (!writerRef.current) {
      writerRef.current = createChunkedWriter(terminalRef, sessionId, 500);
    }

    // Re-create writer when sessionId changes (so throughput logs use the right id)
    useEffect(() => {
      writerRef.current?.dispose();
      writerRef.current = createChunkedWriter(terminalRef, sessionId, 500);
      return () => { writerRef.current?.dispose(); };
    }, [sessionId, terminalRef]);

    // ── Emergency recover ───────────────────────────────────────
    const handleEmergencyClear = useCallback(() => {
      console.warn('[Terminal] Emergency clear triggered');
      try {
        terminalRef.current?.clear();
        terminalRef.current?.reset();
        terminalRef.current?.blur();
        setTimeout(() => {
          fit();
          terminalRef.current?.focus();
        }, 50);
        setFrozen(false);
      } catch (e) {
        console.error('[Terminal] Emergency clear failed:', e);
      }
    }, [fit]);

    // Detect potential freeze: if no renders happen for >2s while
    // terminal exists, show the emergency button.
    useEffect(() => {
      if (!terminal) return;
      let tick = 0;
      const interval = setInterval(() => {
        tick++;
        // Simple heuristic: if the terminal exists but the page
        // seems unresponsive, show the panic button.
        // In a real freeze the interval itself won't fire, so this
        // is a "soft" detection while the event loop still runs.
        if (tick > 0 && tick % 5 === 0) {
          // After 5s of uptime, hide the button unless manually shown.
          if (tick > 5) setFrozen(false);
        }
      }, 1000);
      return () => clearInterval(interval);
    }, [terminal]);

    // Ctrl+Shift+X hotkey to toggle emergency button
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'X') {
          e.preventDefault();
          setFrozen((v) => !v);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Fit when becoming visible — container dimensions changed from offscreen.
    // WebGL context is preserved (terminals use absolute positioning, not display:none).
    useEffect(() => {
      if (!isVisible || !terminal) return;
      const timer = setTimeout(() => fit(), 80);
      return () => clearTimeout(timer);
    }, [isVisible, terminal, fit]);

    // Expose imperative handle
    const focus = useCallback(() => {
      window.getSelection()?.removeAllRanges();
      terminalRef.current?.focus();
    }, []);

    // Track registered decorations for disposal
    const decosRef = useRef<Map<number, import('@xterm/xterm').IDecoration>>(new Map());
    let decoSeq = 0;

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          writerRef.current?.enqueue(data);
        },
        clear: () => clear(),
        getSelection: () => getSelection(),
        fit: () => fit(),
        setConnectionReady: () => setConnectionReady(),
        focus: () => focus(),
        wake: () => wake(),
        getCols: () => terminalRef.current?.cols ?? 80,
        getCurrentLine: () => {
          const t = terminalRef.current;
          if (!t) return 0;
          return t.buffer.active.baseY + t.buffer.active.cursorY;
        },
        registerSeparator: () => {
          const t = terminalRef.current;
          if (!t) return;
          t.write('\r\n');
          const marker = t.registerMarker(0);
          if (marker) {
            t.registerDecoration({
              marker,
              layer: 'top',
              backgroundColor: 'rgba(100,100,100,0.50)',
              height: 0.12,
              width: t.cols,
              x: 0,
            });
          }
          t.write('\r\n');
        },
        registerLineDecoration: (lineNum: number, height: number, color: string) => {
          const t = terminalRef.current;
          if (!t) return undefined;
          const marker = t.registerMarker(lineNum - t.buffer.active.baseY);
          if (!marker) return undefined;
          const deco = t.registerDecoration({
            marker,
            layer: 'top',
            backgroundColor: color,
            height,
            width: t.cols,
            x: 0,
          });
          if (deco) {
            decoSeq++;
            decosRef.current.set(decoSeq, deco);
            return decoSeq;
          }
          return undefined;
        },
        disposeDecoration: (id: number) => {
          decosRef.current.get(id)?.dispose();
          decosRef.current.delete(id);
        },
      }),
      [clear, getSelection, fit, setConnectionReady, focus, wake],
    );

    // ── Right-click menu ──
    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      },
      [],
    );

    const handleCopy = useCallback(async () => {
      const sel = getSelection();
      if (sel) {
        try {
          await navigator.clipboard.writeText(sel);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = sel;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
      }
    }, [getSelection]);

    const handlePaste = useCallback(async () => {
      if (!sessionId) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          await invoke('write_to_terminal', { sessionId, data: text });
        }
      } catch {
        /* clipboard denied */
      }
    }, [sessionId]);

    const menuItems: ContextMenuItem[] = [
      { label: 'Clear Screen', shortcut: 'Ctrl+L', onClick: clear },
      { label: 'Copy', shortcut: 'Ctrl+C', onClick: handleCopy },
      { label: 'Paste', shortcut: 'Ctrl+V', onClick: handlePaste, disabled: !sessionId },
    ];

    return (
      <div className="flex-1 flex flex-col min-h-0 relative" onContextMenu={handleContextMenu}>
        <div ref={containerRef} className="flex-1 overflow-hidden" />

        {frozen && (
          <button
            onClick={handleEmergencyClear}
            className="absolute top-2 right-2 z-50 px-3 py-1.5 rounded
                       bg-red-600/90 hover:bg-red-500 text-white text-xs font-semibold
                       shadow-lg backdrop-blur-sm transition-colors"
            title="Force clear & reset terminal (Ctrl+Shift+X)"
          >
            ⚡ Clear & Reset
          </button>
        )}

        {menu && (
          <ContextMenu
            items={menuItems}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    );
  },
);
