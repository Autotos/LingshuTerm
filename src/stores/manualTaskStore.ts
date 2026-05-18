import { useMemo } from 'react';
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Task } from '@/lib/taskTypes';
import { generateTaskId } from '@/lib/taskTypes';

interface ManualTaskState {
  /** All tasks across all sessions (keyed by sessionId internally) */
  tasks: Task[];
  /** Which session's tasks are currently loaded/displayed */
  activeSessionId: string | null;
  loaded: boolean;

  /** Add a task bound to a specific session */
  addTask: (sessionId: string, input: Omit<Task, 'id' | 'createdAt' | 'sessionId'>) => void;
  /** Update a task by id */
  updateTask: (id: string, patch: Partial<Task>) => void;
  /** Remove a task by id */
  removeTask: (id: string) => void;
  /** Toggle enabled state */
  toggleEnabled: (id: string) => void;

  /** Load tasks for a specific session from disk */
  loadTasks: (sessionId: string) => Promise<void>;
  /** Persist only the specified session's tasks to disk */
  saveTasks: (sessionId: string) => void;
}

// Guard against concurrent loadTasks calls (prevents duplicate task entries)
const loadingSessions = new Set<string>();

export const useManualTaskStore = create<ManualTaskState>((set, get) => ({
  tasks: [],
  activeSessionId: null,
  loaded: false,

  addTask: (sessionId, input) => {
    const task: Task = {
      ...input,
      id: generateTaskId(),
      sessionId,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tasks: [...s.tasks, task] }));
  },

  updateTask: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  toggleEnabled: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, isEnabled: !t.isEnabled } : t,
      ),
    })),

  loadTasks: async (sessionId) => {
    // Prevent concurrent loads for the same session
    if (loadingSessions.has(sessionId)) return;
    loadingSessions.add(sessionId);

    // Clear old session tasks first
    const keep = get().tasks.filter((t) => t.sessionId !== sessionId);
    set({ activeSessionId: sessionId, loaded: false, tasks: keep });

    try {
      const raw: string | null = await invoke('read_memory_file', {
        sessionId,
        filename: 'tasks.json',
      });
      // Re-read state: tasks may have been modified by another load or user action
      const current = get().tasks.filter((t) => t.sessionId !== sessionId);
      if (raw) {
        const loaded: Task[] = JSON.parse(raw);
        for (const t of loaded) { t.sessionId = sessionId; }
        set({ tasks: [...current, ...loaded], loaded: true });
      } else {
        set({ tasks: current, loaded: true });
      }
    } catch (e) {
      console.error('[tasks] loadTasks failed:', e);
      set({ loaded: true });
    } finally {
      loadingSessions.delete(sessionId);
    }
  },

  saveTasks: (sessionId) => {
    const owned = get().tasks.filter((t) => t.sessionId === sessionId);
    const json = JSON.stringify(owned, null, 2);
    invoke('write_memory_file', {
      sessionId,
      filename: 'tasks.json',
      content: json,
    }).catch((e) => console.error('[tasks] save failed:', e));
  },
}));

/** Selector: get tasks for the active session only (memoized to avoid infinite render loops). */
export function useSessionTasks(sessionId: string | null): Task[] {
  // Subscribe to raw tasks array — stable reference unless tasks actually change
  const tasks = useManualTaskStore((s) => s.tasks);
  // Memoize the filtered result — only re-filter when tasks or sessionId change
  return useMemo(
    () => (sessionId ? tasks.filter((t) => t.sessionId === sessionId) : []),
    [tasks, sessionId],
  );
}
