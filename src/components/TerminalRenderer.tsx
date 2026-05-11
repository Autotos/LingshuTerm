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

export interface TerminalRendererHandle {
  write: (data: string) => void;
  clear: () => void;
  getSelection: () => string;
  fit: () => void;
  setConnectionReady: () => void;
  focus: () => void;
}

interface TerminalRendererProps {
  sessionId: string | null;
  isVisible?: boolean;
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

    const { terminal, terminalRef, fit, clear, getSelection, setConnectionReady } = useTerminal({
      containerRef,
      sessionId,
    });

    // Fit when becoming visible — size the terminal before any output arrives.
    // Focus is deferred to UnifiedSessionPanel.handleConnectionReady which
    // fires after the PTY is connected and the DOM is stable.
    useEffect(() => {
      if (!isVisible || !terminal) return;
      const timer = setTimeout(() => {
        fit();
      }, 80);
      return () => clearTimeout(timer);
    }, [isVisible, terminal, fit]);

    // Expose imperative handle
    const focus = useCallback(() => {
      window.getSelection()?.removeAllRanges();
      terminalRef.current?.focus();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          terminalRef.current?.write(data);
        },
        clear: () => clear(),
        getSelection: () => getSelection(),
        fit: () => fit(),
        setConnectionReady: () => setConnectionReady(),
        focus: () => focus(),
      }),
      [clear, getSelection, fit, setConnectionReady, focus],
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
      <div className="flex-1 flex flex-col min-h-0" onContextMenu={handleContextMenu}>
        <div ref={containerRef} className="flex-1 overflow-hidden" />

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
