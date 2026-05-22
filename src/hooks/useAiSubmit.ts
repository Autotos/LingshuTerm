import { useState, useCallback, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUiStore } from '@/stores/uiStore';
import { useOutputStore } from '@/stores/outputStore';
import { nlToTasks, nlToAction, resolveProvider } from '@/lib/aiService';
import type { ChatMessage } from '@/lib/aiService';
import { assemblePrompt, appendShortTerm } from '@/lib/memoryService';
import {
  detectTerminalCreateIntent,
  actionToConnectionConfig,
} from '@/lib/terminalAction';
import { connectionLabel, connectionShortLabel } from '@/models/connection';

interface UseAiSubmitOptions {
  sessionId: string | null;
}

interface UseAiSubmitReturn {
  submitAiQuery: (query: string) => Promise<void>;
  cancelAiQuery: () => void;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

function resolveSessionName(connectionId: string): string {
  const sessions = useSessionStore.getState().sessions;
  for (const [, s] of sessions) {
    const term = s.terminals.find((t) => t.connectionId === connectionId);
    if (term) {
      return (s.title || s.id).replace(/[^A-Za-z0-9_\-一-鿿]/g, '_').slice(0, 64);
    }
  }
  return connectionId;
}

async function executeTerminalCreate(
  action: ReturnType<typeof detectTerminalCreateIntent>,
  out: ReturnType<typeof useOutputStore.getState>,
): Promise<boolean> {
  if (!action) return false;

  const { payload } = action;
  const baseConfig = actionToConnectionConfig(action);

  const hostList: string[] = payload.hosts && payload.hosts.length > 0
    ? payload.hosts
    : [payload.host || payload.portName || ''];

  const perHost = Math.max(1, payload.count ?? 1);

  let targetSessionId = useSessionStore.getState().activeSessionId;
  if (!targetSessionId) {
    const sessionName = payload.sessionName || connectionLabel(baseConfig);
    targetSessionId = useSessionStore.getState().addSession(sessionName);
  }

  const total = hostList.length * perHost;
  if (total > 50) {
    out.append(`终端数量 ${total} 超过上限 50，请缩小范围`);
    out.setStatus('error');
    return false;
  }

  let created = 0;
  for (const host of hostList) {
    for (let i = 0; i < perHost; i++) {
      const config = host !== (payload.host || payload.portName || '')
        ? { ...baseConfig, host } as typeof baseConfig
        : baseConfig;
      try {
        await useSessionStore.getState().addTerminal(targetSessionId, config, connectionShortLabel(config));
        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.append(`${connectionLabel(config)}: ${msg}`);
      }
    }
  }

  if (created > 0) {
    out.append(`已创建 ${created} 个终端`);
    out.setStatus('done');
    return true;
  }
  out.append('终端创建失败');
  out.setStatus('error');
  return false;
}

export function useAiSubmit({ sessionId }: UseAiSubmitOptions): UseAiSubmitReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submitAiQuery = useCallback(
    async (query: string) => {
      if (isLoading) return;

      setIsLoading(true);
      setError(null);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const out = useOutputStore.getState();

      try {
        const config = useSettingsStore.getState().settings.ai;
        const provider = resolveProvider(config);

        out.setStatus('running');
        out.append(`> ${query}`);

        // ── Phase 1: Regex terminal-creation detection ──
        const quickAction = detectTerminalCreateIntent(query);
        if (quickAction) {
          const ok = await executeTerminalCreate(quickAction, out);
          if (ok) return;
          out.append('连接失败，请检查主机地址、用户名和端口是否正确');
          out.setStatus('error');
          return;
        }

        // ── Phase 2: LLM ──
        if (!provider.baseUrl) {
          out.append('AI API 未配置，请在设置中配置 AI 服务');
          out.setStatus('done');
          return;
        }

        const memoryId = sessionId
          ? resolveSessionName(sessionId)
          : (useSessionStore.getState().activeSessionId ?? 'global');

        let preMessages: ChatMessage[] | undefined;
        try {
          const assembled = await assemblePrompt(memoryId, query);
          preMessages = assembled.messages;
        } catch { /* proceed without memory */ }

        // Try terminal-creation action first
        const llmAction = await nlToAction(config, query, controller.signal, preMessages);
        if (llmAction) {
          const action = {
            type: 'TERMINAL_CREATE' as const,
            payload: {
              protocol: llmAction.payload.protocol,
              host: llmAction.payload.host,
              port: llmAction.payload.port || (llmAction.payload.protocol === 'ssh' ? 22 : 23),
              username: llmAction.payload.username,
              password: llmAction.payload.password,
              portName: llmAction.payload.portName,
              baudRate: llmAction.payload.baudRate,
            },
          };
          const ok = await executeTerminalCreate(action, out);
          if (ok) return;
        }

        // Fallback: task-step parsing
        const steps = await nlToTasks(config, query, controller.signal, preMessages);

        if (steps.length === 0) {
          throw new Error('AI returned no executable commands');
        }

        for (const s of steps) {
          out.append(`  $ ${s.command}  — ${s.description}`);
        }
        out.setStatus('done');

        appendShortTerm(memoryId, [
          { role: 'user', content: query, ts: Date.now() },
          {
            role: 'assistant',
            content: steps.map((s) => `${s.description}: ${s.command}`).join('\n'),
            ts: Date.now(),
          },
        ]).catch(() => {});

        if (sessionId) {
          useTaskStore.getState().createGroup(sessionId, query, steps);
          useUiStore.getState().setSidebarTab('tasks');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : String(err);
          out.setStatus('error');
          out.append(msg);
          setError(msg);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, isLoading],
  );

  const cancelAiQuery = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
    useOutputStore.getState().setStatus('done');
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { submitAiQuery, cancelAiQuery, isLoading, error, clearError };
}
