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
  const countsRef = useRef<Map<string, Map<string, number>>>(new Map());

  const uiSessionName = useResolveSessionName(sessionId);

  const allTasks = useManualTaskStore((s) => s.tasks);
  const realtimeTasks = allTasks.filter(
    (t) =>
      t.type === 'realtime' &&
      t.isEnabled &&
      t.monitor &&
      t.sessionId === uiSessionName,
  );

  console.log(
    `[TaskMonitor] render sessionId="${sessionId}" uiSession="${uiSessionName}" allTasks=${allTasks.length} realtime=${realtimeTasks.length}`,
  );

  // When tasks or session change: reset state and force re-scan of accumulated buffer
  useEffect(() => {
    countsRef.current.clear();
    for (const t of realtimeTasks) {
      countsRef.current.set(t.id, new Map());
    }
    // Reset buffer position so the next effect run re-scans everything
    lastLenRef.current = 0;
    console.log(
      `[TaskMonitor] activated — session="${uiSessionName}" realtime=${realtimeTasks.length} buffer=${bufferRef.current.length}B`,
      realtimeTasks.map((t) => ({ name: t.name, keywords: t.monitor?.triggerKeywords })),
    );
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

        let rawCmd = task.action.useAI
          ? (task.action.prompt ?? '')
          : (task.action.command ?? '');
        if (!rawCmd) continue;

        // Resolve target sessions: empty array = all active sessions
        let ids = task.monitor?.targetSessionIds ?? [];
        const allSessions = useSessionStore.getState().sessions;
        // Build map: terminal UUID → connectionId
        const terminalMap = new Map<string, string>();
        for (const [, s] of allSessions) {
          for (const t of s.terminals) {
            if (t.connectionId) terminalMap.set(t.id, t.connectionId);
          }
        }

        // Resolve stored terminal UUIDs to current connectionIds
        let targets: string[];
        if (ids.length === 0) {
          // All sessions — collect all connectionIds
          targets = [...terminalMap.values()];
        } else {
          // Map UUIDs → connectionIds, skip unresolvable ones
          targets = ids.map((id) => terminalMap.get(id)).filter(Boolean) as string[];
          // If no valid targets remain (all stale), fall back to all sessions
          if (targets.length === 0) targets = [...terminalMap.values()];
        }
        if (targets.length === 0) continue;

        // Increment fire count
        taskCounts.set(kw, fired + 1);
        countsRef.current.set(task.id, taskCounts);

        // Split multi-line commands and send to each target
        const lines = rawCmd.split('\n').map((l) => l.trim()).filter(Boolean);
        console.log(
          `[TaskMonitor] ✅ TRIGGERED task="${task.name}" targets=${targets.length} lines=${lines.length} mode=${mode} count=${fired + 1}`,
        );

        for (const target of targets) {
          for (const line of lines) {
            const data = line.endsWith('\n') ? line : line + '\n';
            const writeCmd = getWriteCommand(target);
            console.log(`[TaskMonitor]   → target=${target} cmd=${writeCmd} data="${line}"`);
            invoke(writeCmd, { sessionId: target, data }).catch(
              (e) => console.error(`[TaskMonitor] write failed:`, e),
            );
          }
        }

        // Clear buffer to prevent infinite re-triggers
        bufferRef.current = '';
        lastLenRef.current = outputChunks.length;
        return;
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
