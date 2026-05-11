import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Settings, FolderTree, Code2 } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

const appWindow = getCurrentWindow();

interface TitleBarProps {
  sessionName: string;
  isEditorVisible: boolean;
  onToggleEditor: () => void;
}

export function TitleBar({ sessionName, isEditorVisible, onToggleEditor }: TitleBarProps) {
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const toggleSessionManager = useUiStore((s) => s.toggleSessionManager);
  return (
    <div
      className="flex items-center justify-between h-9 bg-[var(--deep)] border-b border-[var(--border)] select-none"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-3 px-4" data-tauri-drag-region>
        <div className="flex gap-2">
          <div
            className="w-3 h-3 rounded-full bg-[var(--red)] hover:opacity-80 cursor-pointer transition-opacity"
            onClick={() => appWindow.close()}
          />
          <div
            className="w-3 h-3 rounded-full bg-[var(--yellow)] hover:opacity-80 cursor-pointer transition-opacity"
            onClick={() => appWindow.minimize()}
          />
          <div
            className="w-3 h-3 rounded-full bg-[var(--green)] hover:opacity-80 cursor-pointer transition-opacity"
            onClick={() => appWindow.toggleMaximize()}
          />
        </div>
        <span className="text-[11px] tracking-wide-hi uppercase text-[var(--text-3)] ml-2" data-tauri-drag-region>
          灵枢智能终端 2.0
        </span>
        <span className="text-[10px] text-[var(--text-4)]" data-tauri-drag-region>·</span>
        <span className="text-[11px] text-[var(--text-3)]" data-tauri-drag-region>{sessionName}</span>
      </div>
      <div className="flex items-center gap-0.5 px-1">
        <button
          onClick={onToggleEditor}
          title={isEditorVisible ? 'Close editor' : 'Open code editor'}
          className={`w-7 h-7 flex items-center justify-center rounded border transition-all ${
            isEditorVisible
              ? 'text-[var(--text-1)] bg-[var(--veil)] border-[var(--border)]'
              : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] hover:border-[var(--border)]'
          }`}
          aria-pressed={isEditorVisible}
        >
          <Code2 className="w-[14px] h-[14px]" />
        </button>
        <button
          onClick={toggleSessionManager}
          className="w-7 h-7 flex items-center justify-center rounded border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] hover:border-[var(--border)] transition-all"
          title="Session Manager"
        >
          <FolderTree className="w-[14px] h-[14px]" />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-7 h-7 flex items-center justify-center rounded border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] hover:border-[var(--border)] transition-all"
          title="Settings"
        >
          <Settings className="w-[14px] h-[14px]" />
        </button>
        <button
          onClick={() => appWindow.minimize()}
          className="w-7 h-7 flex items-center justify-center rounded border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] hover:border-[var(--border)] transition-all"
          title="Minimize"
        >
          <Minus className="w-[14px] h-[14px]" />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-7 h-7 flex items-center justify-center rounded border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] hover:border-[var(--border)] transition-all"
          title="Maximize"
        >
          <Square className="w-[12px] h-[12px]" />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-7 h-7 flex items-center justify-center rounded border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--red)]/20 hover:border-[var(--border)] transition-all"
          title="Close"
        >
          <X className="w-[14px] h-[14px]" />
        </button>
      </div>
    </div>
  );
}
