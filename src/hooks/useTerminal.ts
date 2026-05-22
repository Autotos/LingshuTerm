import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { getWriteCommand, getResizeCommand } from '@/lib/sessionUtils';
import { persistTerminalChunk } from '@/lib/persistenceSubscribe';
import { useSettingsStore } from '@/stores/settingsStore';
import '@xterm/xterm/css/xterm.css';

// ─── Emergency recovery key (global) ──────────────────────────────
// Ctrl+Alt+Shift+R = force-clear all terminal log stores to free memory.

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.altKey && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      void import('@/stores/sessionLogStore').then(({ useSessionLogStore }) => {
        const state = useSessionLogStore.getState();
        for (const sid of Object.keys(state.logs)) {
          state.clearSessionLogs(sid);
        }
      }).catch(() => {});
    }
  });
}

interface UseTerminalOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sessionId: string | null;
}

// ─── Module-level terminal instance cache ──────────────────────────
// Terminal instances MUST outlive React component lifecycle.
// React may unmount/remount components during reconciliation with arrays
// (even with stable keys), which would call terminal.dispose() and
// destroy the xterm buffer.  This cache keeps the instance alive so
// re-mounting simply re-attaches to the new DOM container.
// Map key = connectionId (stable backend session identifier).

interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  webglAddon: WebglAddon | null;
}

const terminalCache = new Map<string, CachedTerminal>();

export function disposeCachedTerminal(connectionId: string): void {
  const cached = terminalCache.get(connectionId);
  if (cached) {
    try { cached.webglAddon?.dispose(); } catch { /* ignore */ }
    try { cached.terminal.dispose(); } catch { /* ignore */ }
    terminalCache.delete(connectionId);
  }
}

export function useTerminal({ containerRef, sessionId }: UseTerminalOptions) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);

  // Input buffering: hold keystrokes until setConnectionReady() is called
  const connectionReadyRef = useRef(false);
  const inputBufferRef = useRef<string[]>([]);

  // Live-updating settings ref (avoids recreating effects on every setting change)
  const terminalSettingsRef = useRef(useSettingsStore.getState().settings.terminal);
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      terminalSettingsRef.current = state.settings.terminal;
    });
    return unsub;
  }, []);

  const flushInputBuffer = useCallback(() => {
    const buf = inputBufferRef.current;
    if (buf.length === 0 || !sessionId) return;
    const data = buf.join('');
    inputBufferRef.current = [];
    invoke(getWriteCommand(sessionId), { sessionId, data }).catch((err) =>
      console.error('[useTerminal] flushInputBuffer failed:', err),
    );
    buf.forEach((chunk) => persistTerminalChunk(sessionId, 'input', chunk));
  }, [sessionId]);

  const setConnectionReady = useCallback(() => {
    if (connectionReadyRef.current) return;
    connectionReadyRef.current = true;
    flushInputBuffer();
  }, [flushInputBuffer]);

  // ── Initialize terminal (with module-level cache) ──
  // Only creates a new Terminal on first mount for a given sessionId.
  // On remount (React reconciliation), reuses the cached instance.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const key = sessionId ?? '__no_session__';

    // 1. Try cache first
    let cached = terminalCache.get(key);
    if (!cached) {
      const fontSize = 13;
      const estCharW = fontSize * 0.6;
      const estCharH = fontSize * 1.5;
      const estCols =
        container.clientWidth > 0
          ? Math.max(80, Math.min(500, Math.floor((container.clientWidth - 8) / estCharW)))
          : 80;
      const estRows =
        container.clientHeight > 0
          ? Math.max(24, Math.min(200, Math.floor(container.clientHeight / estCharH)))
          : 24;

      const terminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        cursorStyle: 'bar',
        cols: estCols,
        rows: estRows,
        fontFamily: 'Berkeley Mono, JetBrains Mono, SF Mono, Monaco, Menlo, Consolas, monospace',
        fontSize,
        lineHeight: 1.4,
        theme: {
          background: '#0e0e0d',
          foreground: '#faf9f6',
          cursor: '#a0917e',
          cursorAccent: '#0e0e0d',
          selectionBackground: 'rgba(160, 145, 126, 0.25)',
          black: '#1c1c1b',
          red: '#d4867c',
          green: '#8fba7a',
          yellow: '#c9b87a',
          blue: '#7ea8c7',
          magenta: '#b08dba',
          cyan: '#8fb8b8',
          white: '#afaeac',
          brightBlack: '#666469',
          brightRed: '#e09a90',
          brightGreen: '#a3c990',
          brightYellow: '#d9ca8e',
          brightBlue: '#95bad4',
          brightMagenta: '#c4a4cc',
          brightCyan: '#a6c9c9',
          brightWhite: '#faf9f6',
        },
        scrollback: 500,
        fastScrollModifier: 'alt',
        fastScrollSensitivity: 5,
        smoothScrollDuration: 0,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      let webglAddon: WebglAddon | null = null;
      try {
        webglAddon = new WebglAddon();
        terminal.loadAddon(webglAddon);
      } catch (e) {
        console.warn('[Terminal] WebGL not available, falling back to canvas rendering', e);
      }

      cached = { terminal, fitAddon, webglAddon };
      terminalCache.set(key, cached);
    }

    const { terminal, fitAddon, webglAddon } = cached;

    // 2. Attach to current DOM container.  terminal.open() is idempotent —
    //    xterm skips re-init if already open; appendChild is harmless.
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    webglAddonRef.current = webglAddon;

    // 3. Cleanup: detach from DOM, but DO NOT dispose the Terminal instance.
    //    The instance lives in terminalCache and will be reused on remount.
    return () => {
      terminalRef.current = null;
      fitAddonRef.current = null;
      webglAddonRef.current = null;
      // Intentionally NOT calling terminal.dispose() — instance stays cached.
    };
  }, [containerRef, sessionId]);

  // Reset connection state when sessionId changes
  useEffect(() => {
    connectionReadyRef.current = false;
    inputBufferRef.current = [];
  }, [sessionId]);

  // Setup terminal data events (user input → PTY) + resize + initial sizing.
  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;

    const terminal = terminalRef.current;

    const onData = terminal.onData(async (data: string) => {
      if (!connectionReadyRef.current) {
        inputBufferRef.current.push(data);
        return;
      }
      if (inputBufferRef.current.length > 0) {
        flushInputBuffer();
      }
      try {
        await invoke(getWriteCommand(sessionId), { sessionId, data });
        persistTerminalChunk(sessionId, 'input', data);
      } catch (error) {
        console.error('Failed to write to terminal:', error);
      }
    });

    let resizeSeq = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const onResize = terminal.onResize(({ cols, rows }) => {
      const seq = ++resizeSeq;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (seq !== resizeSeq) return;
        invoke(getResizeCommand(sessionId), { sessionId, cols, rows }).catch(
          (error) => console.error('Failed to resize terminal:', error),
        );
      }, 150);
    });

    // Initial sizing
    const fa = fitAddonRef.current;
    const el = containerRef.current;
    if (fa && el) {
      let attempts = 0;
      let fitRetries = 0;
      const tryFit = () => {
        if (el.clientWidth > 0 && el.clientHeight > 0) {
          const { autoFit, defaultColumns, defaultRows } = terminalSettingsRef.current;
          const prevCols = terminal.cols;
          const prevRows = terminal.rows;
          if (autoFit) {
            fa.fit();
          } else {
            terminal.resize(defaultColumns, defaultRows);
          }
          if (
            autoFit &&
            terminal.cols === prevCols &&
            terminal.rows === prevRows &&
            terminal.cols <= 80 &&
            fitRetries < 5
          ) {
            fitRetries++;
            setTimeout(tryFit, 100);
            return;
          }
          terminal.refresh(0, terminal.rows - 1);
        } else if (attempts < 60) {
          attempts++;
          setTimeout(tryFit, 50);
        }
      };
      requestAnimationFrame(() => tryFit());
    }

    return () => {
      onData.dispose();
      onResize.dispose();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [sessionId]);

  // ResizeObserver — container resize → auto-fit (when enabled)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !fitAddonRef.current) return;

    let rafPending = false;
    let roRetries = 0;
    const observer = new ResizeObserver(() => {
      if (!terminalSettingsRef.current.autoFit) return;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        try {
          const fa = fitAddonRef.current;
          const t = terminalRef.current;
          if (!fa || !t) return;
          const prevCols = t.cols;
          fa.fit();
          if (t.cols === 80 && t.cols === prevCols && roRetries < 3) {
            roRetries++;
            setTimeout(() => {
              fa.fit();
              t.refresh(0, t.rows - 1);
            }, 150);
            return;
          }
          roRetries = 0;
          t.refresh(0, t.rows - 1);
        } catch {
          /* ignore */
        }
      });
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [containerRef]);

  // React to settings changes
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state, prev) => {
      const next = state.settings.terminal;
      const old = prev.settings.terminal;
      if (
        next.autoFit === old.autoFit &&
        next.defaultColumns === old.defaultColumns &&
        next.defaultRows === old.defaultRows
      ) return;

      const terminal = terminalRef.current;
      if (!terminal) return;

      if (next.autoFit) {
        fitAddonRef.current?.fit();
      } else {
        terminal.resize(next.defaultColumns, next.defaultRows);
      }
    });
    return unsub;
  }, []);

  const createSession = useCallback(async (shell?: string, cwd?: string) => {
    const newSessionId: string = await invoke('create_session', {
      config: {
        protocol: 'local',
        shell: shell ?? '',
        cwd: cwd || undefined,
      },
    });
    return newSessionId;
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const getSelection = useCallback(() => {
    return terminalRef.current?.getSelection() ?? '';
  }, []);

  const wake = useCallback(() => {
    const t = terminalRef.current;
    if (!t) return;
    // Emergency recovery: reload WebGL renderer if context was lost
    // (should not happen during normal tab switches — only if browser
    //  aggressively reclaimed GPU resources).
    try { webglAddonRef.current?.dispose(); } catch { /* ignore */ }
    webglAddonRef.current = null;
    try {
      const newWebgl = new WebglAddon();
      t.loadAddon(newWebgl);
      webglAddonRef.current = newWebgl;
      // Update cache
      const key = sessionId ?? '__no_session__';
      const cached = terminalCache.get(key);
      if (cached) terminalCache.set(key, { ...cached, webglAddon: newWebgl });
    } catch { /* webgl unavailable */ }
    try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
    try { t.refresh(0, t.rows - 1); } catch { /* ignore */ }
  }, [sessionId]);

  return {
    terminal: terminalRef.current,
    terminalRef,
    createSession,
    fit,
    clear,
    getSelection,
    setConnectionReady,
    wake,
  };
}
