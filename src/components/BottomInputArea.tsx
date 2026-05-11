import { CommandInput } from './CommandInput';

interface BottomInputAreaProps {
  sessionId: string | null;
  executeCommand: (command: string) => Promise<string | null>;
  isExecuting: boolean;
  onAiSubmit?: (query: string) => Promise<void>;
  isAiLoading?: boolean;
  aiError?: string | null;
  onClearAiError?: () => void;
}

/**
 * Fixed bottom input bar.
 *
 * Always shown — the terminal is visible in both hidden and split modes.
 * When xterm.js is focused, the terminal handles input natively via
 * onData; the bottom bar serves as an alternative input method.
 */
export function BottomInputArea({
  sessionId,
  executeCommand,
  isExecuting,
  onAiSubmit,
  isAiLoading,
  aiError,
  onClearAiError,
}: BottomInputAreaProps) {
  return (
    <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--deep)]">
      <CommandInput
        sessionId={sessionId}
        onExecute={executeCommand}
        onAiSubmit={onAiSubmit}
        isExecuting={isExecuting}
        isAiLoading={isAiLoading}
        aiError={aiError}
        onClearAiError={onClearAiError}
      />
    </div>
  );
}
