import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { PtyOutputPayload, SessionErrorPayload } from '@/models/terminal';
import { getWriteCommand, getResizeCommand } from '@/lib/sessionUtils';
import { persistTerminalChunk } from '@/lib/persistenceSubscribe';
import { useSettingsStore } from '@/stores/settingsStore';
import '@xterm/xterm/css/xterm.css';

// --- Diagnostic counter (Bug 1 investigation) ----------------------------
// StrictMode 下每个 Hook 实例分配递增 id，便于区分 mount-1 / mount-2 泄漏源。
const __useTerminalHookCounter = { n: 0 };

interface UseTerminalOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sessionId: string | null;
}

export function useTerminal({ containerRef, sessionId }: UseTerminalOptions) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  // 诊断用：本 Hook 实例 ID（模块级计数器分配）
  const instanceIdRef = useRef<number>(0);
  if (instanceIdRef.current === 0) {
    instanceIdRef.current = ++__useTerminalHookCounter.n;
  }

  // Input buffering: hold keystrokes until setConnectionReady() is called
  const connectionReadyRef = useRef(false);
  const inputBufferRef = useRef<string[]>([]);

  // Track current sessionId for use in effects that only run once
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

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

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    const container = containerRef.current;

    // Estimate initial cols/rows from the container so the terminal
    // never starts at the xterm.js default of 80×24.  FitAddon will
    // fine-tune these to exact dimensions when the renderer is ready.
    const fontSize = 13;
    const estCharW = fontSize * 0.6; // ~7.8 px for typical monospace
    const estCharH = fontSize * 1.5; // ~19.5 px
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
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // 1) open → Canvas renderer active
    terminal.open(container);

    // 2) Load WebglAddon NOW — before any fit or refresh.
    //    A Canvas fit/refresh before WebGL can schedule async viewport
    //    sync that fires after WebGL replaces the renderer, causing
    //    "Cannot read properties of undefined (reading 'dimensions')".
    //    The estimated cols/rows from the constructor keep the terminal
    //    visually wide while WebGL initialises.
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch (e) {
      console.warn('WebGL not available, falling back to canvas rendering', e);
      webglAddon = null;
    }

    // 3) Terminal ready.  The data-events effect owns the initial
    //    fit (with WebGL-dimension retry) + backend notification.

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      // Dispose terminal FIRST (it disposes addons internally),
      // then clean up WebGL.  Reversing the order causes
      // "Cannot read properties of undefined (reading 'dimensions')"
      // because the renderer is gone before the terminal is stopped.
      try {
        terminal.dispose();
      } catch {
        /* ignore */
      }
      terminalRef.current = null;
      try {
        webglAddonRef.current?.dispose();
      } catch {
        /* ignore */
      }
      webglAddonRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerRef]);

  // Setup Tauri event listeners
  //
  // 修复 Bug 1（字符/输出双写）：
  // 旧实现用共享的 `listenersRef.current` + `async setupListeners`，在
  // React StrictMode 双挂载下存在时序竞态 —— 两份 pending `listen()` 会先后
  // 把各自的 unlisten 函数 push 进同一个数组，导致两个 pty-output 监听器并存，
  // 每条输出被 `terminal.write()` 两次。
  //
  // 新实现：
  //   1) 改用本 Effect 闭包内的 `cancelled` flag + 局部 `localUnlisteners`，
  //      与其它 Effect run 完全隔离；
  //   2) 每个 listener 回调入口先 `if (cancelled) return`，即使 unlisten()
  //      未来得及执行也不会产生副作用；
  //   3) 若 await 期间已 cancelled，立即 unlisten 新返回的句柄，防止泄漏。
  useEffect(() => {
    if (!terminalRef.current) return;

    // Reset connection state for the new PTY
    connectionReadyRef.current = false;
    inputBufferRef.current = [];

    let cancelled = false;
    const localUnlisteners: UnlistenFn[] = [];

    (async () => {
      const unlistenOutput = await listen<PtyOutputPayload>(
        'pty-output',
        (event) => {
          if (cancelled) return;
          if (
            terminalRef.current &&
            event.payload.session_id === sessionId
          ) {
            terminalRef.current.write(event.payload.data);
            persistTerminalChunk(sessionId, 'stdout', event.payload.data);
          }
        },
      );
      if (cancelled) {
        try { unlistenOutput(); } catch { /* Tauri may already have cleaned up */ }
        return;
      }
      localUnlisteners.push(unlistenOutput);

      const unlistenError = await listen<SessionErrorPayload>(
        'session-error',
        (event) => {
          if (cancelled) return;
          if (
            terminalRef.current &&
            event.payload.session_id === sessionId
          ) {
            terminalRef.current.writeln(
              `\r\n[Error: ${event.payload.error}]`,
            );
            persistTerminalChunk(sessionId, 'stderr', event.payload.error);
          }
        },
      );
      if (cancelled) {
        try { unlistenError(); } catch { /* Tauri may already have cleaned up */ }
        return;
      }
      localUnlisteners.push(unlistenError);
    })();

    return () => {
      cancelled = true;
      for (const unlisten of localUnlisteners) {
        try { unlisten(); } catch { /* Tauri may already have cleaned up */ }
      }
      localUnlisteners.length = 0;
    };
  }, [sessionId]);

  // Setup terminal data events (user input → PTY) + resize + initial sizing.
  //
  // The initial fit/resize lives HERE — inside the same effect that registers
  // terminal.onResize.  This guarantees the resize signal ALWAYS reaches the
  // backend PTY, regardless of React effect ordering or mount timing.
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

    // Debounced resize.  The Rust backend handles PTY resize + atomic
    // two-phase stty write (self-cleaning ANSI, zero visible output).
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

    // ── Initial sizing ──────────────────────────────────────────
    // Runs AFTER onResize is registered (same effect), so
    // terminal.resize() → onResize → invoke reaches PTY.
    //
    // WebGL renderer cell dimensions may not be ready until a few
    // frames after terminal.loadAddon(WebglAddon).  If fitAddon.fit()
    // returns without changing cols the cell dims are probably still
    // 0 → wait 100ms and retry (up to 5 times).
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
          // If fit() didn't change dimensions AND we're still
          // stuck at narrow cols (Canvas fit didn't run), WebGL
          // cell metrics probably aren't ready yet. Retry.
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
          // Backend resize is handled by the onResize handler above
          // (fires from fa.fit() / terminal.resize() → debounced → Rust).
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
  // Handles: window resize, sidebar collapse/expand, view switching (hidden → visible)
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
          // If cols didn't change (WebGL dims not ready), retry once
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

  // React to settings changes: when autoFit or columns/rows change, reapply sizing.
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
        // Switched to auto-fit: fit to container now
        fitAddonRef.current?.fit();
      } else {
        // Switched to fixed size, or columns/rows changed while autoFit is off
        terminal.resize(next.defaultColumns, next.defaultRows);
      }
    });
    return unsub;
  }, []);

  const createSession = useCallback(async (shell?: string, cwd?: string) => {
    // Routes through the unified `create_session(config)` entry point.
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

  return {
    terminal: terminalRef.current,
    /** The internal ref — always has the live Terminal after init, unlike
     *  `terminal` which is frozen to the first render's null value. */
    terminalRef,
    createSession,
    fit,
    clear,
    getSelection,
    setConnectionReady,
  };
}
