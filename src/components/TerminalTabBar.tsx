import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Circle, ChevronDown } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import type { TerminalInstance } from '@/models/session';

interface TerminalTabBarProps {
  sessionId: string | null;
}

const ADD_BTN_WIDTH = 36;
const MORE_BTN_WIDTH = 38;

/**
 * Horizontal tab bar with overflow dropdown.
 * Measures actual tab widths via ResizeObserver on a hidden measure element.
 * Overflow tabs go into a portal-rendered dropdown (avoids overflow:hidden clipping).
 */
export function TerminalTabBar({ sessionId }: TerminalTabBarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const setActiveTerminalIndex = useSessionStore((s) => s.setActiveTerminalIndex);
  const moveTerminal = useSessionStore((s) => s.moveTerminal);
  const removeTerminal = useSessionStore((s) => s.removeTerminal);
  const toggleTerminalLogging = useSessionStore((s) => s.toggleTerminalLogging);
  const openTerminalModal = useUiStore((s) => s.openTerminalModal);

  const session = sessionId ? sessions.get(sessionId) : undefined;
  const terminals: TerminalInstance[] = session?.terminals ?? [];
  const activeIndex = session?.activeTerminalIndex ?? -1;

  const [visibleCount, setVisibleCount] = useState(terminals.length);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── Measure actual tab widths and compute visible count ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const calc = () => {
      const containerWidth = el.clientWidth;
      if (containerWidth === 0) return;

      let used = 0;
      let count = 0;

      for (let i = 0; i < terminals.length; i++) {
        const tabEl = tabRefs.current.get(i);
        const tabWidth = tabEl ? tabEl.offsetWidth : 0;
        const need = tabWidth + (i === terminals.length - 1 ? ADD_BTN_WIDTH : 0);
        if (used + need <= containerWidth - (i < terminals.length - 1 ? 0 : 0)) {
          used += tabWidth;
          count++;
        } else {
          // Check if this tab + More button + Add button fits
          if (used + MORE_BTN_WIDTH + ADD_BTN_WIDTH <= containerWidth) {
            break;
          }
          // Need to make room for More button by reducing visible count
          while (count > 0 && used + MORE_BTN_WIDTH + ADD_BTN_WIDTH > containerWidth) {
            count--;
            const removedEl = tabRefs.current.get(count);
            used -= removedEl ? removedEl.offsetWidth : 0;
          }
          break;
        }
      }

      if (count === 0 && terminals.length > 0) count = 1; // show at least 1
      setVisibleCount(Math.min(count, terminals.length));
    };

    // Delay initial calc to let DOM paint
    const timer = setTimeout(calc, 0);
    const ro = new ResizeObserver(() => calc());
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [terminals.length]);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreBtnRef.current?.contains(e.target as Node)) return;
      setDropdownOpen(false);
    };
    // Use capture phase so it fires before the toggle button's stopPropagation
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [dropdownOpen]);

  const handleAdd = useCallback(() => {
    if (sessionId) openTerminalModal(sessionId);
  }, [sessionId, openTerminalModal]);

  const handleClose = useCallback((idx: number) => {
    const term = terminals[idx];
    if (term && sessionId) removeTerminal(sessionId, term.id);
  }, [terminals, sessionId, removeTerminal]);

  const handleSelectHidden = useCallback((clickedIdx: number) => {
    if (!sessionId) return;
    // Circular queue swap: move the clicked hidden tab to the last visible position.
    // The tab currently at the last visible position shifts right into the hidden zone.
    const lastVisibleIdx = Math.max(0, visibleCount - 1);
    if (clickedIdx !== lastVisibleIdx) {
      moveTerminal(sessionId, clickedIdx, lastVisibleIdx);
    }
    // After the move, the clicked tab is now at `lastVisibleIdx`
    setActiveTerminalIndex(sessionId, lastVisibleIdx);
    setDropdownOpen(false);
  }, [sessionId, visibleCount, moveTerminal, setActiveTerminalIndex]);

  if (!sessionId) return null;

  const hiddenTabs = terminals.slice(visibleCount);
  const activeInHidden = activeIndex >= visibleCount && hiddenTabs.length > 0;

  const registerTabRef = (idx: number) => (el: HTMLDivElement | null) => {
    if (el) tabRefs.current.set(idx, el);
    else tabRefs.current.delete(idx);
  };

  return (
    <div
      ref={containerRef}
      className="h-8 bg-[var(--deep)] border-b border-[var(--border)] flex items-center flex-shrink-0"
    >
      {/* All tabs rendered (for measurement), hidden ones are invisible */}
      {terminals.map((term, idx) => {
        const isVisible = idx < visibleCount;
        const isActive = idx === activeIndex;
        return (
          <div
            key={term.id}
            ref={registerTabRef(idx)}
            onClick={isVisible ? () => setActiveTerminalIndex(sessionId, idx) : undefined}
            className={`group flex items-center gap-1.5 h-full px-3 text-[11px] whitespace-nowrap border-r border-[var(--border)] transition-colors flex-shrink-0 ${
              !isVisible ? 'hidden' : 'cursor-pointer'
            } ${
              isActive && isVisible
                ? 'bg-[var(--void)] text-[var(--text-1)]'
                : isVisible
                ? 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
                : ''
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTerminalLogging(sessionId, term.id);
              }}
              title={term.isLogging ? 'Stop logging' : 'Start logging'}
              className="flex-shrink-0"
            >
              <Circle
                className={`w-2 h-2 ${
                  term.isLogging
                    ? 'text-[var(--green)] animate-pulse fill-current'
                    : 'text-[var(--text-4)]'
                }`}
              />
            </button>

            <span className="truncate max-w-[160px]">{term.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose(idx);
              }}
              className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--elevated)] transition-opacity flex-shrink-0"
              title="Close terminal"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}

      {/* Overflow dropdown button */}
      {hiddenTabs.length > 0 && (
        <button
          ref={moreBtnRef}
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen((v) => !v);
          }}
          className={`h-full px-2 flex items-center gap-1 text-[11px] border-r border-[var(--border)] transition-colors flex-shrink-0 ${
            activeInHidden
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
          }`}
          title={`${hiddenTabs.length} more terminals`}
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          <span className="text-[10px]">{hiddenTabs.length}</span>
        </button>
      )}

      {/* Add button */}
      <button
        onClick={handleAdd}
        className="h-full px-2 flex items-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-colors flex-shrink-0"
        title="New terminal"
      >
        <Plus className="w-3 h-3" />
      </button>

      {terminals.length === 0 && (
        <span className="text-[10px] text-[var(--text-4)] px-2">
          Click + to add a terminal
        </span>
      )}

      {/* Portal dropdown — rendered to body to avoid overflow:hidden clipping */}
      {dropdownOpen && hiddenTabs.length > 0 && createPortal(
        <div
          className="fixed z-[9999] w-56 max-h-64 overflow-y-auto bg-[var(--deep)] border border-[var(--border)] rounded shadow-lg"
          style={{
            top: moreBtnRef.current
              ? moreBtnRef.current.getBoundingClientRect().bottom + 2
              : 0,
            left: moreBtnRef.current
              ? Math.min(
                  moreBtnRef.current.getBoundingClientRect().right - 224,
                  window.innerWidth - 230,
                )
              : 0,
          }}
        >
          {hiddenTabs.map((term) => {
            const realIdx = terminals.indexOf(term);
            const isActive = realIdx === activeIndex;
            return (
              <div
                key={term.id}
                onClick={() => handleSelectHidden(realIdx)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-[var(--accent)] bg-[var(--void)]'
                    : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
                }`}
              >
                <Circle
                  className={`w-2 h-2 flex-shrink-0 ${
                    term.isLogging
                      ? 'text-[var(--green)] animate-pulse fill-current'
                      : 'text-[var(--text-4)]'
                  }`}
                />
                <span className="truncate flex-1">{term.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(realIdx);
                    if (hiddenTabs.length <= 1) setDropdownOpen(false);
                  }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--elevated)] flex-shrink-0"
                  title="Close terminal"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
