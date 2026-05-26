import { useState, useCallback, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUiStore } from '@/stores/uiStore';
import { useOutputStore } from '@/stores/outputStore';
import { nlToAction, resolveProvider } from '@/lib/aiService';
import type { AiTaskStep, ChatMessage } from '@/lib/aiService';
import { assemblePrompt, appendShortTerm } from '@/lib/memoryService';
import {
  detectTerminalCreateIntent,
  actionToConnectionConfig,
} from '@/lib/terminalAction';
import { connectionLabel, connectionShortLabel } from '@/models/connection';
import { runPipeline } from '@/lib/harness/harnessPipeline';
import type { GuardResult } from '@/lib/harness/types';

interface UseAiSubmitOptions {
  sessionId: string | null;
}

interface UseAiSubmitReturn {
  submitAiQuery: (query: string) => Promise<void>;
  cancelAiQuery: () => void;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  /** Harness confirm dialog props — render <ConfirmDialog> in parent */
  confirmDialog: {
    open: boolean;
    step: AiTaskStep | null;
    guardResult: GuardResult | null;
    onChoose: (choice: 'deny' | 'allow-once' | 'allow-all') => void;
    onDismiss: () => void;
  };
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

  // Harness confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmStep, setConfirmStep] = useState<AiTaskStep | null>(null);
  const [confirmGuard, setConfirmGuard] = useState<GuardResult | null>(null);
  const confirmResolveRef = useRef<((approved: boolean) => void) | null>(null);
  const allowAllRef = useRef(false);

  const handleConfirmChoice = useCallback((choice: 'deny' | 'allow-once' | 'allow-all') => {
    if (choice === 'allow-all') {
      allowAllRef.current = true;
    }
    setConfirmOpen(false);
    setConfirmStep(null);
    setConfirmGuard(null);
    confirmResolveRef.current?.(choice !== 'deny');
    confirmResolveRef.current = null;
  }, []);

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

        // ── Phase 2: LLM + Harness Pipeline ──
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

        // Fallback: Harness Pipeline (single-turn planner + middleware)
        const harnessConfig = useSettingsStore.getState().settings.harness;

        const result = await runPipeline(
          query,
          sessionId ?? memoryId,
          {
            signal: controller.signal,
            onProgress: (status) => out.append(status),
            onConfirm: async (step, guardResult) => {
              if (allowAllRef.current) return true;
              return new Promise<boolean>((resolve) => {
                confirmResolveRef.current = resolve;
                setConfirmStep(step);
                setConfirmGuard(guardResult);
                setConfirmOpen(true);
              });
            },
            onExecuteStart: (step) => {
              out.append(`  $ ${step.command}  — ${step.description}`);
            },
            onExecuteEnd: (_step, _exitCode) => {
              // Block event system handles actual exit code tracking
            },
          },
          harnessConfig,
        );

        // Display results
        out.append(result.summary);
        if (result.finalStatus === 'denied') {
          out.append('任务被安全策略拒绝');
          out.setStatus('error');
        } else if (result.finalStatus === 'failed') {
          out.append('任务执行或验证失败');
          out.setStatus('error');
        } else {
          out.setStatus('done');
        }

        // Save to memory
        appendShortTerm(memoryId, [
          { role: 'user', content: query, ts: Date.now() },
          {
            role: 'assistant',
            content: result.steps.map((s) => `${s.description}: ${s.command}`).join('\n'),
            ts: Date.now(),
          },
        ]).catch(() => {});

        // Create task group
        if (sessionId && result.steps.length > 0) {
          useTaskStore.getState().createGroup(sessionId, query, result.steps);
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

  return {
    submitAiQuery,
    cancelAiQuery,
    isLoading,
    error,
    clearError,
    confirmDialog: {
      open: confirmOpen,
      step: confirmStep,
      guardResult: confirmGuard,
      onChoose: handleConfirmChoice,
      onDismiss: () => {
        setConfirmOpen(false);
        confirmResolveRef.current?.(false);
        confirmResolveRef.current = null;
      },
    },
  };
}
