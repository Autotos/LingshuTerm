import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Circle, ChevronDown } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';
import type { TerminalInstance } from '@/models/session';
import { connectionLabel } from '@/models/connection';

interface TerminalTabBarProps {
  sessionId: string | null;
}

const ADD_BTN_WIDTH = 36;
const MORE_BTN_WIDTH = 38;
// Tab: border(1) + padding(24) + circle-icon(16) + gap(6) + close-btn(16) + inner-gaps(4)
const TAB_FIXED_WIDTH = 1 + 24 + 16 + 6 + 16 + 4; // 67px
// CJK chars ≈ 11px, ASCII ≈ 6.5px at text-[11px] monospace
const CJK_CHAR_W = 11;
const ASCII_CHAR_W = 6.5;

/** Estimate rendered width of a tab title string in pixels. */
function estimateTitleWidth(title: string): number {
  let w = 0;
  for (const ch of title) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified Ideographs + full-width forms + kana
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) || (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF)) {
      w += CJK_CHAR_W;
    } else {
      w += ASCII_CHAR_W;
    }
  }
  return Math.ceil(w);
}

function estimateTabWidth(title: string): number {
  return TAB_FIXED_WIDTH + estimateTitleWidth(title);
}

/**
 * Horizontal tab bar with overflow dropdown.
 * Uses deterministic character-width estimation (not DOM measurement which
 * returns 0 for hidden tabs). ResizeObserver still triggers recalculation
 * on container resize, but the widths come from the estimation formula.
 */
export function TerminalTabBar({ sessionId }: TerminalTabBarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const setActiveTerminalIndex = useSessionStore((s) => s.setActiveTerminalIndex);
  const cycleTerminalIntoView = useSessionStore((s) => s.cycleTerminalIntoView);
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

  // ── Compute visible tab count from deterministic width estimation ──
  const computeVisibleCount = useCallback(() => {
    const el = containerRef.current;
    if (!el || terminals.length === 0) return;
    const containerWidth = el.clientWidth;
    if (containerWidth === 0) return;

    // How many tabs fit
    const avail = containerWidth - ADD_BTN_WIDTH;
    let used = 0;
    let count = 0;
    for (let i = 0; i < terminals.length; i++) {
      const w = estimateTabWidth(terminals[i].title);
      if (used + w <= avail) {
        used += w;
        count++;
      } else {
        // If this is the last tab and it fits with Add button only (no need for More btn)
        if (i === terminals.length - 1 && used + w <= containerWidth - ADD_BTN_WIDTH) {
          // Actually the Add button is always there, re-check
        }
        break;
      }
    }

    // If not all fit, need room for More button
    if (count < terminals.length) {
      const availWithMore = containerWidth - ADD_BTN_WIDTH - MORE_BTN_WIDTH;
      used = 0;
      count = 0;
      for (let i = 0; i < terminals.length; i++) {
        const w = estimateTabWidth(terminals[i].title);
        if (used + w <= availWithMore) {
          used += w;
          count++;
        } else {
          break;
        }
      }
    }

    if (count === 0 && terminals.length > 0) count = 1;
    setVisibleCount(Math.min(count, terminals.length));
  }, [terminals]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const timer = setTimeout(computeVisibleCount, 0);
    const ro = new ResizeObserver(() => computeVisibleCount());
    ro.observe(el);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, [computeVisibleCount]);

  const dropdownId = `tab-dropdown-${sessionId}`;

  // ── Close dropdown on outside click ──
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      // Don't close if clicking the toggle button OR inside the dropdown portal
      if (moreBtnRef.current?.contains(e.target as Node)) return;
      const dropdownEl = document.getElementById(dropdownId);
      if (dropdownEl?.contains(e.target as Node)) return;
      setDropdownOpen(false);
    };
    // Bubble phase — won't interfere with dropdown item onClick handlers
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [dropdownOpen, dropdownId]);

  const handleAdd = useCallback(() => {
    if (sessionId) openTerminalModal(sessionId);
  }, [sessionId, openTerminalModal]);

  const handleClose = useCallback((idx: number) => {
    const term = terminals[idx];
    if (term && sessionId) removeTerminal(sessionId, term.id);
  }, [terminals, sessionId, removeTerminal]);

  const handleSelectHidden = useCallback((clickedIdx: number) => {
    if (!sessionId) return;
    const lastVisibleIdx = Math.max(0, visibleCount - 1);
    // Single atomic operation: move + activate in one store update
    cycleTerminalIntoView(sessionId, clickedIdx, lastVisibleIdx);
    setDropdownOpen(false);
  }, [sessionId, visibleCount, cycleTerminalIntoView]);

  if (!sessionId) return null;

  const hiddenTabs = terminals.slice(visibleCount);
  const activeInHidden = activeIndex >= visibleCount && hiddenTabs.length > 0;

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

            <span
              className="truncate max-w-[120px]"
              title={term.config ? connectionLabel(term.config) : term.title}
            >
              {term.title}
            </span>
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
          id={dropdownId}
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
                <span
                  className="truncate flex-1"
                  title={term.config ? connectionLabel(term.config) : term.title}
                >
                  {term.title}
                </span>
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
