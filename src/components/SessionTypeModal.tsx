import { useState, useCallback } from 'react';
import { X, Terminal } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';

/**
 * "New Session" modal — simplified to just a session name.
 *
 * Connection configuration is handled separately by TerminalConnectModal
 * when the user adds a terminal via the Tab bar's + button.
 */
export function SessionTypeModal() {
  const sessionModalOpen = useUiStore((s) => s.sessionModalOpen);
  const closeCreateSessionModal = useUiStore((s) => s.closeCreateSessionModal);
  const addSession = useSessionStore((s) => s.addSession);

  const [name, setName] = useState('');

  const close = useCallback(() => {
    closeCreateSessionModal();
    setName('');
  }, [closeCreateSessionModal]);

  const handleCreate = useCallback(() => {
    const title = name.trim() || undefined;
    addSession(title);
    close();
  }, [name, addSession, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCreate();
      if (e.key === 'Escape') close();
    },
    [handleCreate, close],
  );

  if (!sessionModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <div className="relative w-[400px] bg-[var(--deep)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col animate-block-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <span className="text-[13px] font-medium text-[var(--text-1)] flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            New Session
          </span>
          <button
            onClick={close}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">
              Session Name
            </span>
            <input
              type="text"
              className="settings-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Project A"
              autoFocus
            />
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={close}
            className="px-3 py-1.5 rounded text-[11px] bg-[var(--veil)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-1.5 rounded text-[11px] bg-[var(--accent)] text-[var(--void)] font-medium hover:brightness-110 transition-all"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
