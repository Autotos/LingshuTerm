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
  diagnosticTrace,
  actionToConnectionConfig,
} from '@/lib/terminalAction';
import { connectionLabel } from '@/models/connection';

interface UseAiSubmitOptions {
  sessionId: string | null;
}

interface UseAiSubmitReturn {
  submitAiQuery: (query: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Resolve the user-facing session name from a terminal connection ID.
 * Falls back to the connection ID itself if lookup fails.
 */
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

/**
 * Execute a terminal-creation action: build config, create terminal, show feedback.
 * Returns true on success.
 */
async function executeTerminalCreate(
  action: ReturnType<typeof detectTerminalCreateIntent>,
  out: ReturnType<typeof useOutputStore.getState>,
): Promise<boolean> {
  if (!action) return false;

  const { payload } = action;
  const config = actionToConnectionConfig(action);
  const label = connectionLabel(config);

  out.append(`[Action] 已解析连接信息，正在建立 ${payload.protocol.toUpperCase()} 连接到 ${payload.host || payload.portName || '?'}...`);

  let targetSessionId = useSessionStore.getState().activeSessionId;
  if (!targetSessionId) {
    targetSessionId = useSessionStore.getState().addSession(label);
    out.append(`[Action] 自动创建会话: ${targetSessionId}`);
  }

  try {
    await useSessionStore.getState().addTerminal(targetSessionId, config, label);
    out.append(`[Action] 终端 ${label} 已就绪，请查看终端面板`);
    out.setStatus('done');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.append(`[Action] 终端创建失败: ${msg}`);
    out.setStatus('error');
    return false;
  }
}

/**
 * Hook for submitting natural language queries to the AI service.
 *
 * Pipeline:
 *   1. Quick regex pre-extraction  (detectTerminalCreateIntent)
 *   2. LLM call with action-aware system prompt (nlToAction)
 *   3. Fallback: LLM task-step parsing (nlToTasks)
 *
 * Every step logs diagnostics to the Output panel so the user can follow progress.
 */
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

        // ── Header ──
        out.setStatus('running');
        out.append(`> ${query}`);

        // ── Phase 1: Regex quick detection (works WITHOUT sessionId) ──
        out.append('[诊断] ── Phase 1: 前端正则预提取 ──');
        const quickAction = detectTerminalCreateIntent(query);
        if (quickAction) {
          const p = quickAction.payload;
          out.append(`[诊断] 正则匹配成功 → protocol=${p.protocol}, host=${p.host || p.portName || '?'}, port=${p.port}, user=${p.username || '(默认)'}, pass=${p.password ? '***' : '(空)'}`);
          out.append(`[Action] 正在建立 ${p.protocol.toUpperCase()} 连接到 ${p.host || p.portName}...`);
          const ok = await executeTerminalCreate(quickAction, out);
          if (ok) return;
          // Terminal creation failed — this is a real error (auth, network, etc.).
          // Do NOT fall through to LLM; the intent was already identified correctly.
          out.append('[Action] 连接失败。请检查: 1) 目标主机是否可达 2) 用户名密码是否正确 3) 端口是否开放');
          out.setStatus('error');
          return;
        } else {
          for (const line of diagnosticTrace(query)) {
            out.append(line);
          }
        }

        // ── Phase 2 requires AI API ──
        if (!provider.baseUrl) {
          out.append('[诊断] AI API 未配置，跳过 Phase 2/3。请在设置中配置 AI 服务。');
          if (!sessionId) {
            out.append('[提示] 当前无活跃终端，无法执行命令。请先打开一个终端或通过 SSH 连接创建终端。');
          }
          out.setStatus('done');
          return;
        }

        // ── Resolve memory ID ──
        const memoryId = sessionId
          ? resolveSessionName(sessionId)
          : (useSessionStore.getState().activeSessionId ?? 'global');

        // ── Assemble memory context ──
        let preMessages: ChatMessage[] | undefined;
        try {
          out.append('[诊断] 加载会话记忆...');
          const assembled = await assemblePrompt(memoryId, query);
          preMessages = assembled.messages;
          out.append(`[诊断] 记忆加载完成 (${preMessages.length} 条消息)`);
        } catch {
          out.append('[诊断] 记忆加载失败，将不使用上下文');
        }

        // ── Phase 2: LLM action detection ──
        out.append('[诊断] ── Phase 2: AI 语义分析 (nlToAction) ──');
        const llmAction = await nlToAction(config, query, controller.signal, preMessages);
        if (llmAction) {
          out.append(`[诊断] AI 识别为终端创建: protocol=${llmAction.payload.protocol}, host=${llmAction.payload.host}`);
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
          out.append('[诊断] AI 路径创建失败，回退到任务解析...');
        } else {
          out.append('[诊断] AI 未识别为终端创建意图，进入任务解析模式');
        }

        // ── Phase 3: LLM task-step parsing (needs sessionId for task binding) ──
        out.append('[诊断] ── Phase 3: AI 任务解析 (nlToTasks) ──');
        const steps = await nlToTasks(config, query, controller.signal, preMessages);

        if (steps.length === 0) {
          out.append('[诊断] AI 未返回任何可执行命令');
          throw new Error('AI returned no executable commands');
        }

        out.append(`[诊断] AI 返回 ${steps.length} 个任务步骤`);

        for (const s of steps) {
          out.append(`  $ ${s.command}  — ${s.description}`);
        }
        out.setStatus('done');

        // ── Update short-term memory ──
        appendShortTerm(memoryId, [
          { role: 'user', content: query, ts: Date.now() },
          {
            role: 'assistant',
            content: steps.map((s) => `${s.description}: ${s.command}`).join('\n'),
            ts: Date.now(),
          },
        ]).catch(() => { /* non-critical */ });

        // Create task group (needs sessionId)
        if (sessionId) {
          useTaskStore.getState().createGroup(sessionId, query, steps);
          useUiStore.getState().setSidebarTab('tasks');
        } else {
          out.append('[提示] 无活跃终端，任务已生成但未绑定到终端。请先创建终端连接。');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : String(err);
          out.setStatus('error');
          out.append(`[Error] ${msg}`);
          setError(msg);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, isLoading],
  );

  const clearError = useCallback(() => setError(null), []);

  return { submitAiQuery, isLoading, error, clearError };
}
