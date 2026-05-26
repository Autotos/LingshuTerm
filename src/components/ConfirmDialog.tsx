import { useRef, useEffect } from 'react';
import { Shield, X, Check, CheckCheck } from 'lucide-react';

interface ConfirmDialogProps {
  /** Command being confirmed */
  command: string;
  /** Human-readable description of the command */
  description: string;
  /** Reason for requiring confirmation */
  reason?: string;
  /** Whether the dialog is visible */
  open: boolean;
  /** Called when user makes a choice */
  onChoose: (choice: 'deny' | 'allow-once' | 'allow-all') => void;
  /** Called when user dismisses via overlay click or Escape */
  onDismiss: () => void;
}

export function ConfirmDialog({
  command,
  description,
  reason,
  open,
  onChoose,
  onDismiss,
}: ConfirmDialogProps) {
  const denyRef = useRef<HTMLButtonElement>(null);
  const allowAllRef = useRef<HTMLButtonElement>(null);

  // focus the "allow once" button on open (middle option = safest default)
  const onceRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      // Small delay to let the dialog animate in
      const timer = setTimeout(() => onceRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      } else if (e.key === 'Enter') {
        onChoose('allow-once'); // Enter = default accept
      } else if (e.key === 'd' && e.ctrlKey) {
        e.preventDefault();
        onChoose('deny');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onChoose, onDismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border-hi)] rounded-lg shadow-2xl w-[480px] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)]">
          <Shield size={16} className="text-[var(--yellow)]" />
          <span className="text-sm font-medium text-[var(--text-1)]">权限确认</span>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="text-[10px] text-[var(--text-4)] mb-1 uppercase tracking-wider">
              即将执行的命令
            </div>
            <div className="bg-[var(--deep)] border border-[var(--border)] rounded-md px-3 py-2 font-mono text-xs text-[var(--text-1)]">
              $ {command}
            </div>
          </div>

          {description && (
            <div>
              <div className="text-[10px] text-[var(--text-4)] mb-1 uppercase tracking-wider">
                描述
              </div>
              <div className="text-xs text-[var(--text-2)]">{description}</div>
            </div>
          )}

          {reason && (
            <div className="flex items-start gap-2 bg-[var(--deep)] border border-[var(--border)] rounded-md px-3 py-2">
              <span className="text-[var(--yellow)] text-xs mt-[1px]">!</span>
              <span className="text-xs text-[var(--text-2)]">{reason}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            ref={denyRef}
            onClick={() => onChoose('deny')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-[var(--text-3)] hover:text-[var(--red)] hover:bg-[var(--deep)] transition-colors"
            title="拒绝 (Ctrl+D)"
          >
            <X size={14} />
            拒绝
          </button>

          <div className="flex-1" />

          <button
            ref={onceRef}
            onClick={() => onChoose('allow-once')}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hi)] transition-colors"
            title="允许本次 (Enter)"
          >
            <Check size={14} />
            允许本次
          </button>

          <button
            ref={allowAllRef}
            onClick={() => onChoose('allow-all')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--deep)] transition-colors"
            title="全部允许"
          >
            <CheckCheck size={14} />
            全部允许
          </button>
        </div>
      </div>
    </div>
  );
}
