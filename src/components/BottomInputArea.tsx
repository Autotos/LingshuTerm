import { CommandInput } from './CommandInput';

interface BottomInputAreaProps {
  sessionId: string | null;
  executeCommand: (command: string) => Promise<string | null>;
  isExecuting: boolean;
  onAiSubmit?: (query: string) => Promise<void>;
  onAiCancel?: () => void;
  isAiLoading?: boolean;
  aiError?: string | null;
  onClearAiError?: () => void;
}

export function BottomInputArea({
  sessionId,
  executeCommand,
  isExecuting,
  onAiSubmit,
  onAiCancel,
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
        onAiCancel={onAiCancel}
        isExecuting={isExecuting}
        isAiLoading={isAiLoading}
        aiError={aiError}
        onClearAiError={onClearAiError}
      />
    </div>
  );
}
