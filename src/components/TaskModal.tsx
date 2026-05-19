import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Clock, Eye, ChevronDown } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import type { Task, TaskType } from '@/lib/taskTypes';
import { useManualTaskStore } from '@/stores/manualTaskStore';

interface TaskModalProps {
  task: Task | null;
  sessionId: string | null;
  onClose: () => void;
}

export function TaskModal({ task, sessionId, onClose }: TaskModalProps) {
  const addTask = useManualTaskStore((s) => s.addTask);
  const updateTask = useManualTaskStore((s) => s.updateTask);
  const sessions = useSessionStore((s) => s.sessions);

  const [name, setName] = useState(task?.name ?? '');
  const [type, setType] = useState<TaskType>(task?.type ?? 'scheduled');
  const [useAI, setUseAI] = useState(task?.action.useAI ?? false);
  const [prompt, setPrompt] = useState(task?.action.prompt ?? '');
  const [command, setCommand] = useState(task?.action.command ?? '');

  // Schedule
  const [frequency, setFrequency] = useState(task?.schedule?.frequency ?? 'daily');
  const [startTime, setStartTime] = useState(task?.schedule?.startTime ?? '09:00');
  const [intervalMinutes, setIntervalMinutes] = useState(task?.schedule?.intervalMinutes ?? 0);
  const [repeatCount, setRepeatCount] = useState(task?.schedule?.repeatCount ?? 1);
  const [endTime, setEndTime] = useState(task?.schedule?.endTime ?? '');

  // Monitor — multi-session
  // Store persistent terminal UUIDs (not ephemeral connectionIds like "ssh-1").
  const terminalOptions = Array.from(sessions.values()).flatMap((s) =>
    s.terminals.map((t) => ({
      id: t.id,           // persistent UUID
      connectionId: t.connectionId, // ephemeral backend ID (for execution)
      label: `${s.title || s.id}: ${t.title}`,
    })),
  );
  const validIds = new Set(terminalOptions.map((t) => t.id));

  // Initialise from saved task, filtering out stale IDs
  const [targetSessionIds, setTargetSessionIds] = useState<string[]>(() => {
    const raw = task?.monitor?.targetSessionIds ?? [];
    // Map old connectionId-based entries → current terminal UUIDs, then deduplicate
    const byConn = new Map(terminalOptions.map((t) => [t.connectionId, t.id]));
    const resolved = raw.map((id) => byConn.get(id) ?? (validIds.has(id) ? id : null)).filter(Boolean) as string[];
    return [...new Set(resolved)];
  });
  const [triggerKeywords, setTriggerKeywords] = useState(
    task?.monitor?.triggerKeywords?.join(', ') ?? '',
  );
  const [triggerMode, setTriggerMode] = useState(task?.monitor?.triggerMode ?? 'once');
  const [triggerCount, setTriggerCount] = useState(task?.monitor?.triggerCount ?? 1);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!sessionDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [sessionDropdownOpen]);

  const toggleSession = (id: string) => {
    setTargetSessionIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const selectAllSessions = () => {
    setTargetSessionIds(terminalOptions.map((t) => t.id));
  };

  const clearAllSessions = () => {
    setTargetSessionIds([]);
  };

  const validCount = targetSessionIds.filter((id) => validIds.has(id)).length;
  const sessionLabel = targetSessionIds.length === 0
    ? 'All sessions'
    : validCount === terminalOptions.length && targetSessionIds.length === validCount
      ? `All sessions (${terminalOptions.length})`
      : validCount > 0
        ? `${validCount} session(s) selected`
        : 'Select sessions...';

  const handleSave = useCallback(() => {
    if (!name.trim()) return;

    const data: Partial<Task> = {
      name: name.trim(),
      type,
      isEnabled: task?.isEnabled ?? true,
      action: {
        useAI,
        prompt: useAI ? prompt : undefined,
        command: useAI ? undefined : command,
      },
      schedule: type === 'scheduled' ? {
        frequency,
        startTime,
        intervalMinutes: intervalMinutes || undefined,
        repeatCount: repeatCount || undefined,
        endTime: endTime || undefined,
      } : undefined,
      monitor: type === 'realtime' ? {
        targetSessionIds: targetSessionIds.filter((id) => validIds.has(id)),
        triggerKeywords: triggerKeywords.split(',').map((k) => k.trim()).filter(Boolean),
        triggerMode,
        triggerCount: triggerMode === 'count' ? triggerCount : undefined,
      } : undefined,
    };

    if (task) {
      updateTask(task.id, data);
    } else if (sessionId) {
      addTask(sessionId, data as any);
    }
    if (sessionId) {
      useManualTaskStore.getState().saveTasks(sessionId);
    }
    onClose();
  }, [name, type, useAI, prompt, command, frequency, startTime, intervalMinutes, repeatCount, endTime, targetSessionIds, triggerKeywords, triggerMode, triggerCount, task, sessionId, terminalOptions, addTask, updateTask, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[520px] max-h-[85vh] bg-[var(--deep)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <span className="text-[12px] font-medium text-[var(--text-1)]">{task ? 'Edit Task' : 'New Task'}</span>
          <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)]"><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <Field label="Task Name">
            <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My task" />
          </Field>

          <Field label="Type">
            <div className="flex gap-2">
              <TypeOption icon={<Clock className="w-3 h-3" />} label="Scheduled" active={type === 'scheduled'} onClick={() => setType('scheduled')} />
              <TypeOption icon={<Eye className="w-3 h-3" />} label="Realtime" active={type === 'realtime'} onClick={() => setType('realtime')} />
            </div>
          </Field>

          {/* Action — textarea for multi-line commands */}
          <div className="border-t border-[var(--border)] pt-3">
            <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-2">Action</h4>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} className="w-3 h-3" />
              <span className="text-[11px] text-[var(--text-2)]">Use AI</span>
            </label>
            {useAI ? (
              <textarea className="settings-input min-h-[80px] resize-y" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what to do in natural language..." />
            ) : (
              <textarea className="settings-input min-h-[80px] resize-y font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Shell commands (one per line)&#10;pwd&#10;ls -la&#10;date" />
            )}
          </div>

          {/* Schedule config */}
          {type === 'scheduled' && (
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-2">Schedule</h4>
              <Field label="Frequency">
                <select className="settings-input" value={frequency} onChange={(e) => setFrequency(e.target.value as any)}>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                  <option value="custom_range">Custom</option>
                </select>
              </Field>
              <div className="flex gap-2">
                <Field label="Start Time" className="flex-1"><input type="time" className="settings-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
                <Field label="Interval (min)" className="flex-1"><input type="number" className="settings-input" value={intervalMinutes || ''} onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 0)} min={0} placeholder="0" /></Field>
              </div>
              <div className="flex gap-2">
                <Field label="Repeat Count" className="flex-1"><input type="number" className="settings-input" value={repeatCount || ''} onChange={(e) => setRepeatCount(parseInt(e.target.value) || 1)} min={1} /></Field>
                <Field label="End Time" className="flex-1"><input type="time" className="settings-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
              </div>
            </div>
          )}

          {/* Monitor config */}
          {type === 'realtime' && (
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-2">Monitor</h4>

              {/* Multi-session selector */}
              <Field label="Target Sessions">
                <div ref={dropdownRef} className="relative">
                  <button
                    onClick={() => setSessionDropdownOpen(!sessionDropdownOpen)}
                    className="settings-input flex items-center justify-between text-left"
                  >
                    <span className="truncate text-[11px]">{sessionLabel}</span>
                    <ChevronDown className="w-3 h-3 flex-shrink-0 ml-1 text-[var(--text-4)]" />
                  </button>
                  {sessionDropdownOpen && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--elevated)] border border-[var(--border)] rounded shadow-lg max-h-48 overflow-y-auto">
                      <div className="flex gap-1 px-2 py-1.5 border-b border-[var(--border)]">
                        <button onClick={selectAllSessions} className="flex-1 text-[9px] px-2 py-0.5 rounded bg-[var(--veil)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors">Select All</button>
                        <button onClick={clearAllSessions} className="flex-1 text-[9px] px-2 py-0.5 rounded bg-[var(--veil)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors">Clear</button>
                      </div>
                      {terminalOptions.map((opt) => (
                        <label key={opt.connectionId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--veil)] cursor-pointer text-[10px] text-[var(--text-2)]">
                          <input
                            type="checkbox"
                            checked={targetSessionIds.includes(opt.id)}
                            onChange={() => toggleSession(opt.id)}
                            className="w-3 h-3"
                          />
                          <span className="truncate">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              <Field label="Trigger Keywords (comma-separated)">
                <input className="settings-input" value={triggerKeywords} onChange={(e) => setTriggerKeywords(e.target.value)} placeholder="Enter keywords separated by commas (e.g., error, fail, tools)" />
              </Field>

              <div className="flex gap-2">
                <Field label="Trigger Mode" className="flex-1">
                  <select className="settings-input" value={triggerMode} onChange={(e) => setTriggerMode(e.target.value as any)}>
                    <option value="once">Once</option>
                    <option value="count">N times</option>
                    <option value="every">Every time</option>
                  </select>
                </Field>
                {triggerMode === 'count' && (
                  <Field label="Times" className="flex-1">
                    <input type="number" className="settings-input" value={triggerCount} onChange={(e) => setTriggerCount(Math.max(1, parseInt(e.target.value) || 1))} min={1} />
                  </Field>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim()} className="px-3 py-1.5 rounded text-[11px] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-all">{task ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[9px] uppercase tracking-wide text-[var(--text-3)] mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}

function TypeOption({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[10px] border transition-all ${active ? 'bg-[var(--veil)] border-[var(--border)] text-[var(--text-1)]' : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'}`}>
      {icon} {label}
    </button>
  );
}
