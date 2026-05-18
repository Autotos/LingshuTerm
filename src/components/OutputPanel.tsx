import { useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown, Trash2, Loader2, Circle } from 'lucide-react';
import { useOutputStore } from '@/stores/outputStore';

export function OutputPanel() {
  const { lines, status, isExpanded, toggle, clear } = useOutputStore();
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (isExpanded && lines.length > 0) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [lines, isExpanded]);

  return (
    <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--deep)]">
      {/* Header bar — always visible (div with button role, not <button>, to allow nested buttons) */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-[var(--veil)] transition-colors select-none group cursor-pointer"
      >
        {/* Status dot */}
        {status === 'running' ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin text-[var(--accent)]" />
        ) : status === 'error' ? (
          <Circle className="w-2 h-2 fill-[var(--red)] text-[var(--red)]" />
        ) : status === 'done' ? (
          <Circle className="w-2 h-2 fill-[var(--green)] text-[var(--green)]" />
        ) : lines.length > 0 ? (
          <Circle className="w-2 h-2 fill-[var(--text-4)] text-[var(--text-4)]" />
        ) : (
          <Circle className="w-2 h-2 text-[var(--text-4)] opacity-30" />
        )}

        {/* Title */}
        <span className="text-[var(--text-2)] flex-1 text-left">
          Output
          {lines.length > 0 && (
            <span className="text-[var(--text-4)] ml-1">({lines.length} lines)</span>
          )}
        </span>

        {/* Status label */}
        {status !== 'idle' && (
          <span className={`text-[9px] ${
            status === 'running' ? 'text-[var(--accent)]'
            : status === 'error' ? 'text-[var(--red)]'
            : 'text-[var(--green)]'
          }`}>
            {status === 'running' ? 'Running' : status === 'error' ? 'Error' : 'Done'}
          </span>
        )}

        {/* Clear button */}
        {lines.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); clear(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--elevated)] text-[var(--text-4)] hover:text-[var(--text-1)] transition-all"
            title="Clear output"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}

        {/* Toggle arrow */}
        <span className="text-[var(--text-4)] group-hover:text-[var(--text-2)] transition-colors">
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </span>
      </div>

      {/* Content area — animated expand/collapse */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-48 border-t border-[var(--border)]' : 'max-h-0'
        }`}
      >
        <div
          ref={containerRef}
          className="h-48 overflow-y-auto scrollbar-thin px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-2)]"
        >
          {lines.length === 0 ? (
            <span className="text-[var(--text-4)] italic">
              {status === 'running' ? 'Waiting for output...' : 'No output yet'}
            </span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
