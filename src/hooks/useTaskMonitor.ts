import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '@/stores/sessionStore';
import { useManualTaskStore } from '@/stores/manualTaskStore';
import { stripAllAnsi } from '@/lib/ansi';
import { getWriteCommand } from '@/lib/sessionUtils';

interface UseTaskMonitorOptions {
  sessionId: string | null;
  outputChunks: string[];
  tick: number;
}

export function useTaskMonitor({ sessionId, outputChunks, tick }: UseTaskMonitorOptions) {
  const bufferRef = useRef('');
  const lastLenRef = useRef(0);
  // taskId → { keyword → fireCount }
  const countsRef = useRef<Map<string, Map<string, number>>>(new Map());

  // Resolve UI session name from terminal connectionId
  const uiSessionName = useResolveSessionName(sessionId);

  // Get realtime tasks for this session
  const allTasks = useManualTaskStore((s) => s.tasks);
  const realtimeTasks = allTasks.filter(
    (t) =>
      t.type === 'realtime' &&
      t.isEnabled &&
      t.monitor &&
      t.sessionId === uiSessionName,
  );

  // Reset counts when tasks change
  useEffect(() => {
    countsRef.current.clear();
    for (const t of realtimeTasks) {
      countsRef.current.set(t.id, new Map());
    }
  }, [uiSessionName, allTasks]);

  // Process new output chunks
  useEffect(() => {
    const newChunks = outputChunks.slice(lastLenRef.current);
    lastLenRef.current = outputChunks.length;
    if (newChunks.length === 0 || realtimeTasks.length === 0) return;

    // Append to rolling buffer
    bufferRef.current += newChunks.join('');
    if (bufferRef.current.length > 8192) {
      bufferRef.current = bufferRef.current.slice(-4096);
    }

    const plainText = stripAllAnsi(bufferRef.current);
    console.log(
      `[TaskMonitor] +${newChunks.reduce((s, c) => s + c.length, 0)}B buffer=${bufferRef.current.length}B tasks=${realtimeTasks.length}`,
    );

    for (const task of realtimeTasks) {
      const keywords = task.monitor?.triggerKeywords ?? [];
      const mode = task.monitor?.triggerMode ?? 'once';
      const maxCount = task.monitor?.triggerCount ?? 1;
      if (keywords.length === 0) continue;

      const taskCounts = countsRef.current.get(task.id) ?? new Map();

      for (const kw of keywords) {
        const fired = taskCounts.get(kw) ?? 0;

        // Check if this keyword should fire again
        if (mode === 'once' && fired >= 1) continue;
        if (mode === 'count' && fired >= maxCount) continue;
        // 'every' — always fires

        const found = plainText.includes(kw);
        console.log(
          `[TaskMonitor] task="${task.name}" kw="${kw}" found=${found} mode=${mode} fired=${fired}/${mode === 'count' ? maxCount : '∞'}`,
        );

        if (!found) continue;

        const cmd = task.action.useAI
          ? (task.action.prompt ?? '')
          : (task.action.command ?? '');
        if (!cmd) continue;

        const target = task.monitor?.targetSessionId ?? sessionId;
        if (!target) continue;

        // Increment fire count
        taskCounts.set(kw, fired + 1);
        countsRef.current.set(task.id, taskCounts);

        const data = cmd.endsWith('\n') ? cmd : cmd + '\n';
        const writeCmd = getWriteCommand(target);
        console.log(
          `[TaskMonitor] ✅ TRIGGERED task="${task.name}" cmd="${data.trim()}" target=${target} count=${fired + 1}`,
        );
        invoke(writeCmd, { sessionId: target, data }).catch(
          (e) => console.error(`[TaskMonitor] write failed:`, e),
        );

        // Clear buffer so the executed command's output plus the old
        // keyword match don't cause infinite re-triggers.
        bufferRef.current = '';
        lastLenRef.current = outputChunks.length;
        return; // exit loops — buffer is reset, reprocess fresh chunks next tick
      }
    }
  }, [outputChunks, realtimeTasks, sessionId, tick, uiSessionName]);
}

function useResolveSessionName(connectionId: string | null): string | null {
  const sessions = useSessionStore((s) => s.sessions);
  if (!connectionId) return null;
  for (const [, s] of sessions) {
    const term = s.terminals.find((t) => t.connectionId === connectionId);
    if (term) {
      return (s.title || s.id).replace(/[^A-Za-z0-9_\-一-鿿]/g, '_').slice(0, 64);
    }
  }
  return connectionId;
}
