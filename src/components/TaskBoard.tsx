import { useState, useEffect } from 'react';
import {
  CheckCircle2, XCircle, Loader2, Circle, SkipForward,
  ChevronDown, ChevronRight, Play, Pause, RotateCcw, Trash2,
  MessageSquare, Plus, Clock, Eye, Edit3, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useSessionGroups, useTaskStore } from '@/stores/taskStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useManualTaskStore, useSessionTasks } from '@/stores/manualTaskStore';
import type { TaskGroup, TaskItem, TaskStatus } from '@/models/task';
import type { Task } from '@/lib/taskTypes';
import { stripAnsi } from '@/lib/ansi';
import { TaskModal } from './TaskModal';

interface TaskBoardProps {
  sessionId: string | null;
  collapsed: boolean;
}

function resolveSessionName(uuid: string | null): string | null {
  if (!uuid) return null;
  const sessions = useSessionStore.getState().sessions;
  const s = sessions.get(uuid);
  if (!s) return uuid;
  // Sanitize: same as useAiSubmit + useTaskMonitor
  return (s.title || s.id).replace(/[^A-Za-z0-9_\-一-鿿]/g, '_').slice(0, 64);
}

export function TaskBoard({ sessionId, collapsed }: TaskBoardProps) {
  // Resolve human-readable session name for task storage & filtering
  const sessionName = resolveSessionName(sessionId);

  const aiGroups = useSessionGroups(sessionId);
  const manualTasks = useSessionTasks(sessionName);
  const loaded = useManualTaskStore((s) => s.loaded);
  const storedSessionId = useManualTaskStore((s) => s.activeSessionId);
  const loadTasks = useManualTaskStore((s) => s.loadTasks);
  const removeTask = useManualTaskStore((s) => s.removeTask);
  const toggleEnabled = useManualTaskStore((s) => s.toggleEnabled);
  const saveTasks = useManualTaskStore((s) => s.saveTasks);

  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Load tasks when session changes
  useEffect(() => {
    if (sessionName && storedSessionId !== sessionName) {
      loadTasks(sessionName);
    }
  }, [sessionName, storedSessionId, loadTasks]);

  const hasSession = !!sessionName;

  if (collapsed) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-[11px] font-medium text-[var(--text-2)]">
          Tasks
          {hasSession && manualTasks.length > 0 && (
            <span className="text-[var(--text-4)] ml-1">({manualTasks.length})</span>
          )}
        </span>
        <button
          onClick={() => {
            if (!hasSession) return;
            setEditingTask(null);
            setShowModal(true);
          }}
          disabled={!hasSession}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all ${
            hasSession
              ? 'bg-[var(--accent)] text-white hover:opacity-90'
              : 'bg-[var(--veil)] text-[var(--text-4)] cursor-not-allowed'
          }`}
          title={hasSession ? 'Create a new task' : 'Open a session first'}
        >
          <Plus className="w-3 h-3" />
          New Task
        </button>
      </div>

      {/* No session hint */}
      {!hasSession && loaded && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-4)]">
          <MessageSquare className="w-6 h-6" />
          <span className="text-[11px]">No active session</span>
          <span className="text-[9px]">Open or create a session first</span>
        </div>
      )}

      {/* Content */}
      {hasSession && (
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Manual tasks */}
        {manualTasks.map((task) => (
          <ManualTaskCard
            key={task.id}
            task={task}
            onEdit={() => { setEditingTask(task); setShowModal(true); }}
            onDelete={() => { removeTask(task.id); saveTasks(sessionName!); }}
            onToggle={() => { toggleEnabled(task.id); saveTasks(sessionName!); }}
          />
        ))}

        {/* AI task groups */}
        {aiGroups.map((group) => (
          <TaskGroupCard key={group.id} group={group} />
        ))}

        {/* Empty state */}
        {manualTasks.length === 0 && aiGroups.length === 0 && loaded && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-4)]">
            <MessageSquare className="w-6 h-6" />
            <span className="text-[11px]">No tasks yet</span>
            <span className="text-[9px]">Create a manual task or use AI to generate one</span>
          </div>
        )}
      </div>
      )}

      {/* Task modal */}
      {showModal && (
        <TaskModal
          task={editingTask}
          sessionId={sessionName}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Manual Task Card ──────────────────────────────────────────

function ManualTaskCard({ task, onEdit, onDelete, onToggle }: {
  task: Task; onEdit: () => void; onDelete: () => void; onToggle: () => void;
}) {
  return (
    <div className={`rounded border text-[11px] transition-all ${
      task.isEnabled ? 'border-[var(--border)] bg-[var(--surface)]' : 'border-[var(--border)] bg-[var(--surface)] opacity-50'
    }`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        {/* Type icon */}
        {task.type === 'scheduled' ? (
          <Clock className="w-3 h-3 text-[var(--blue)] flex-shrink-0" />
        ) : (
          <Eye className="w-3 h-3 text-[var(--magenta)] flex-shrink-0" />
        )}

        {/* Name + action */}
        <div className="flex-1 min-w-0">
          <div className="text-[var(--text-2)] truncate">{task.name}</div>
          <div className="text-[9px] text-[var(--text-4)] truncate">
            {task.action.useAI ? `AI: ${task.action.prompt?.slice(0, 40)}` : task.action.command}
          </div>
        </div>

        {/* Actions */}
        <button onClick={onToggle} className="task-action-btn" title={task.isEnabled ? 'Disable' : 'Enable'}>
          {task.isEnabled ? <ToggleRight className="w-3.5 h-3.5 text-[var(--green)]" /> : <ToggleLeft className="w-3.5 h-3.5" />}
        </button>
        <button onClick={onEdit} className="task-action-btn" title="Edit">
          <Edit3 className="w-3 h-3" />
        </button>
        <button onClick={onDelete} className="task-action-btn text-[var(--red)]" title="Delete">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── AI Task Group Card ────────────────────────────────────────

function TaskGroupCard({ group }: { group: TaskGroup }) {
  const [expanded, setExpanded] = useState(true);
  const { toggleGroupPause, removeGroup, retryTask, skipTask } = useTaskStore();

  const completed = group.tasks.filter((t) => t.status === 'success').length;
  const total = group.tasks.length;
  const hasFailed = group.tasks.some((t) => t.status === 'error');

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface)] overflow-hidden animate-block-in">
      <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-[var(--veil)] transition-colors"
        onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-3 h-3 text-[var(--text-3)]" /> : <ChevronRight className="w-3 h-3 text-[var(--text-3)]" />}
        <span className="flex-1 text-[10px] text-[var(--text-2)] truncate">{group.query}</span>
        <span className="text-[9px] text-[var(--text-4)]">{completed}/{total}</span>
      </div>

      <div className="h-[2px] bg-[var(--raised)]">
        <div className={`h-full transition-all duration-300 ${hasFailed ? 'bg-[var(--red)]' : 'bg-[var(--green)]'}`}
          style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }} />
      </div>

      {expanded && (
        <>
          <div className="px-1 py-1">
            {group.tasks.map((task) => (
              <TaskItemRow key={task.id} task={task}
                onRetry={() => retryTask(group.id, task.id)}
                onSkip={() => skipTask(group.id, task.id)} />
            ))}
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1.5 border-t border-[var(--border)]">
            <button onClick={(e) => { e.stopPropagation(); toggleGroupPause(group.id); }} className="task-action-btn" title={group.paused ? 'Resume' : 'Pause'}>
              {group.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }} className="task-action-btn text-[var(--red)]" title="Remove">
              <Trash2 className="w-3 h-3" />
            </button>
            {group.paused && <span className="text-[9px] text-[var(--yellow)] ml-1">Paused</span>}
          </div>
        </>
      )}
    </div>
  );
}

function TaskItemRow({ task, onRetry, onSkip }: { task: TaskItem; onRetry: () => void; onSkip: () => void }) {
  const [showOutput, setShowOutput] = useState(false);
  return (
    <div className="px-1.5 py-1">
      <div className="flex items-center gap-2">
        <StatusIcon status={task.status} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-[var(--text-2)] truncate">{task.description}</div>
          <div className="text-[9px] text-[var(--text-4)] font-mono truncate">{task.command}</div>
        </div>
        <div className="flex items-center gap-0.5">
          {task.status === 'error' && (
            <>
              <button onClick={onRetry} className="task-action-btn" title="Retry"><RotateCcw className="w-2.5 h-2.5" /></button>
              <button onClick={onSkip} className="task-action-btn" title="Skip"><SkipForward className="w-2.5 h-2.5" /></button>
            </>
          )}
          {task.output && (
            <button onClick={() => setShowOutput(!showOutput)} className="task-action-btn" title="Toggle output">
              {showOutput ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
            </button>
          )}
        </div>
      </div>
      {showOutput && task.output && (
        <pre className="mt-1 ml-5 p-1.5 rounded bg-[var(--raised)] text-[9px] text-[var(--text-3)] font-mono overflow-x-auto max-h-[100px] overflow-y-auto">
          {stripAnsi(task.output).slice(-2000)}
        </pre>
      )}
      {task.error && <div className="mt-0.5 ml-5 text-[9px] text-[var(--red)]">{task.error}</div>}
    </div>
  );
}

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'success': return <CheckCircle2 className="w-3 h-3 text-[var(--green)]" />;
    case 'error': return <XCircle className="w-3 h-3 text-[var(--red)]" />;
    case 'running': return <Loader2 className="w-3 h-3 text-[var(--yellow)] animate-spin" />;
    case 'skipped': return <SkipForward className="w-3 h-3 text-[var(--text-4)]" />;
    default: return <Circle className="w-3 h-3 text-[var(--text-4)]" />;
  }
}
