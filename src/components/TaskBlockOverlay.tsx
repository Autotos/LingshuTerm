import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTaskBlockStore, type TaskBlock } from '@/stores/taskBlockStore';
import type { TerminalRendererHandle } from './TerminalRenderer';

interface TaskBlockOverlayProps {
  terminalRef: React.RefObject<TerminalRendererHandle | null>;
  /** Callback to re-write terminal content when expanding a block */
  onExpandBlock: (block: TaskBlock) => void;
}

/**
 * Transparent overlay placed on top of xterm.js.
 * Renders collapse/expand buttons aligned to task block header lines.
 */
export function TaskBlockOverlay({ terminalRef, onExpandBlock }: TaskBlockOverlayProps) {
  const blocks = useTaskBlockStore((s) => s.blocks);
  const toggleCollapse = useTaskBlockStore((s) => s.toggleCollapse);
  const [positions, setPositions] = useState<Array<{ id: string; top: number; left: number }>>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Calculate overlay button positions from terminal viewport
  const recalc = useCallback(() => {
    const term = terminalRef.current;
    const container = containerRef.current?.parentElement;
    if (!term || !container) return;

    const cols = term.getCols();
    // Approximate character dimensions
    const charW = container.clientWidth / Math.max(1, cols);
    const charH = 19.5; // ~13px font * 1.5 line height estimate

    const newPositions: Array<{ id: string; top: number; left: number }> = [];
    for (const block of blocks) {
      if (block.startLine <= 0) continue;
      // Viewport scroll position determines where the line appears
      // For simplicity, position relative to the container top
      const top = block.startLine * charH;
      newPositions.push({
        id: block.id,
        top: Math.max(0, top),
        left: charW * (cols - 4), // near right edge
      });
    }
    setPositions(newPositions);
  }, [terminalRef, blocks]);

  // Recalculate on render and on scroll
  useEffect(() => {
    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recalc);
    };
    schedule();
    const timer = setInterval(schedule, 2000); // periodic refresh
    return () => { clearInterval(timer); cancelAnimationFrame(rafRef.current); };
  }, [recalc]);

  if (blocks.length === 0) return null;

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {positions.map((pos) => {
        const block = blocks.find((b) => b.id === pos.id);
        if (!block || block.endLine <= block.startLine) return null;

        const lineCount = block.endLine - block.startLine;
        const label = block.collapsed
          ? `▶ ${block.command.slice(0, 30)} (${lineCount} lines)`
          : `▼ ${block.command.slice(0, 30)}`;

        return (
          <button
            key={block.id}
            onClick={() => {
              if (block.collapsed) {
                onExpandBlock(block);
              }
              toggleCollapse(block.id);
            }}
            className="absolute pointer-events-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px]
                       bg-[var(--deep)]/90 border border-[var(--border)] text-[var(--text-3)]
                       hover:text-[var(--text-1)] hover:border-[var(--border-hi)] transition-colors
                       backdrop-blur-sm"
            style={{ top: pos.top - 22, left: pos.left - 4 }}
            title={block.collapsed ? 'Click to expand' : 'Click to collapse'}
          >
            {block.collapsed ? (
              <ChevronRight className="w-2.5 h-2.5" />
            ) : (
              <ChevronDown className="w-2.5 h-2.5" />
            )}
            <span className="truncate max-w-[180px]">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
