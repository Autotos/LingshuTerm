import { useState, useCallback, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUiStore } from '@/stores/uiStore';
import { useOutputStore } from '@/stores/outputStore';
import { nlToAction, resolveProvider, getLastTokenUsage, chatRaw } from '@/lib/aiService';
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

/** Build a personality-aware response with the actual data included. */
function buildPersonalityResponse(
  profileKey: string,
  query: string,
  outputs: { description: string; command: string; output: string }[],
): string | null {
  if (outputs.length === 0) return null;

  const isCount = /\b(多少|几个|统计.*数|数量|Count|\.Count|wc -l|\.Length|Measure-Object)\b/i.test(query);
  const isList = /\b(列出|列表|显示|查看|有哪些|什么文件|什么软件|ls |dir |Get-ChildItem|winget list)\b/i.test(query);

  // Collect all output data
  const data = outputs.map((o) => o.output.trim()).filter(Boolean).join('\n');
  if (!data) return null;

  // For count queries, extract the number
  if (isCount) {
    const numMatch = data.match(/\b(\d+)\b/);
    if (numMatch) {
      const count = numMatch[1];
      const subject = extractSubject(query);
      return formatCountResponse(profileKey, count, subject);
    }
  }

  // For list queries, return a personality prefix (data shown separately)
  if (isList) {
    return formatListResponse(profileKey);
  }

  // Generic response
  return formatGenericResponse(profileKey);
}

function extractSubject(query: string): string {
  const m = query.match(/(?:桌面|目录|文件夹|文件|软件|进程|服务)/);
  return m ? m[0] : '项目';
}

function formatCountResponse(profile: string, count: string, subject: string): string {
  const lines: Record<string, string> = {
    default: `当前${subject}数量为 **${count}** 个。`,
    steady: `好的，已确认：当前${subject}共 **${count}** 个。`,
    casual: `收到啦～ ${subject}一共 **${count}** 个！`,
    terse: `${subject}: ${count}`,
    curious: `哇，统计出来了！${subject}有 **${count}** 个呢～`,
    cool: `${count}`,
    gentle: `整理好了，${subject}目前有 **${count}** 个。`,
    funny: `好家伙，${subject}总共 **${count}** 个！`,
  };
  return lines[profile] || lines.default;
}

function formatListResponse(profile: string): string {
  const lines: Record<string, string> = {
    default: '好的，结果如下：',
    steady: '好的，列表已整理如下：',
    casual: '收到啦，给你列出来～',
    terse: '列表：',
    curious: '哇，查到了！快看：',
    cool: '',
    gentle: '整理好了，请查看：',
    funny: '热乎的列表，请过目：',
  };
  return lines[profile] || lines.default;
}

function formatGenericResponse(profile: string): string {
  const lines: Record<string, string> = {
    default: '好的，结果如下：',
    steady: '好的，结果如下：',
    casual: '收到啦，看结果～',
    terse: '',
    curious: '出来啦！看：',
    cool: '',
    gentle: '整理好了：',
    funny: '来了来了：',
  };
  return lines[profile] || lines.default;
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
    out.info(`终端数量 ${total} 超过上限 50，请缩小范围`);
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
        out.info(`${connectionLabel(config)}: ${msg}`);
      }
    }
  }

  if (created > 0) {
    out.info(`已创建 ${created} 个终端`);
    out.setStatus('done');
    return true;
  }
  out.info('终端创建失败');
  out.setStatus('error');
  return false;
}

export function useAiSubmit({ sessionId }: UseAiSubmitOptions): UseAiSubmitReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stepIndexRef = useRef(1);

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
      stepIndexRef.current = 1;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const out = useOutputStore.getState();

      try {
        const config = useSettingsStore.getState().settings.ai;
        const provider = resolveProvider(config);

        out.setStatus('running');
        out.heading(`任务：${query}`);

        // ── Phase 1: Regex terminal-creation detection ──
        const quickAction = detectTerminalCreateIntent(query);
        if (quickAction) {
          const ok = await executeTerminalCreate(quickAction, out);
          if (ok) return;
          out.info('连接失败，请检查主机地址、用户名和端口是否正确');
          out.setStatus('error');
          return;
        }

        // ── Phase 2: LLM + Harness Pipeline ──
        if (!provider.baseUrl) {
          out.info('AI API 未配置，请在设置中配置 AI 服务');
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
        const capturedOutputs: { description: string; command: string; output: string }[] = [];

        // Inject thinking header — will be auto-collapsed when task completes.
        // Detect the actual execution platform: remote SSH server vs local machine.
        const sessStore = useSessionStore.getState();
        const activeSess = sessStore.activeSessionId ? sessStore.sessions.get(sessStore.activeSessionId) : undefined;
        const activeTerm = activeSess?.terminals.find((t) => t.connectionId === sessionId);
        const isRemote = activeTerm?.config?.protocol === 'ssh' || activeTerm?.config?.protocol === 'telnet';
        const platformInfo = isRemote && 'host' in (activeTerm?.config || {})
          ? `SSH 远程服务器 (${(activeTerm?.config as any).host})`
          : (navigator.platform?.toLowerCase().startsWith('win') ? 'Windows' : 'Unix');
        out.result(`<thinking>执行环境: ${platformInfo}, 用户需求: "${query}"</thinking>`);

        const result = await runPipeline(
          query,
          sessionId ?? memoryId,
          {
            signal: controller.signal,
            onProgress: (_status) => {},
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
              stepIndexRef.current++;
              // Thinking: why this command
              out.result(`<thinking>执行: ${step.description}</thinking>`);
              out.codeBlock(step.description, step.command);
            },
            onExecuteEnd: (_step, exitCode, capturedOutput) => {
              if (exitCode !== 0) {
                out.result(`✖ 执行失败 (exit: ${exitCode})`);
                // Show error detail so user can diagnose
                if (capturedOutput) {
                  out.info(capturedOutput.slice(0, 300));
                }
              }
              capturedOutputs.push({
                description: _step.description,
                command: _step.command,
                output: capturedOutput || '',
              });
            },
          },
          harnessConfig,
        );

        // ── Status (errors only) ──
        if (result.finalStatus === 'denied') {
          out.result('✖ 已拒绝 — 命令被安全策略拦截');
          out.setStatus('error');
        } else if (result.finalStatus === 'failed') {
          out.result(`✖ 失败 — ${result.summary}`);
          out.setStatus('error');
        } else {
          out.setStatus('done');
        }

        if (result.progressUpdated) {
          out.info('📝 任务进度已保存至 PROGRESS.md');
        }

        // ── Personality prefix + data output ──
        if (result.finalStatus === 'success' && result.steps.length > 0) {
          const profile = useSettingsStore.getState().settings.soulProfile;
          const allData = capturedOutputs.map((o) => o.output.trim()).filter(Boolean).join('\n');
          const prefix = buildPersonalityResponse(profile, query, capturedOutputs);

          // Show personality prefix FIRST
          if (prefix) {
            out.separator();
            out.result(prefix);
          }

          // Then show the data (FileListView handles structured output)
          if (allData) {
            out.result(allData);
          }

          // ── AI summary: summarise raw output with personality ──
          if (allData && allData.trim().length > 0 && config.currentProviderId) {
            try {
              const soulKey = useSettingsStore.getState().settings.soulProfile;
              const soulLabels: Record<string, string> = {
                default: '简洁专业', steady: '沉稳严谨', casual: '轻松随和',
                terse: '干练利落', curious: '好奇活泼', cool: '高冷简约',
                gentle: '温柔耐心', funny: '幽默打趣',
              };
              const style = soulLabels[soulKey] || '简洁';

              const summaryPrompt = [
                `你是一位${style}的运维助手。请用一句话总结以下命令执行结果（不超过80字）：`,
                `任务: ${query}`,
                `命令输出: ${allData.slice(0, 2000)}`,
              ].join('\n');

              const summary = await chatRaw(
                config,
                [
                  { role: 'system', content: `你是一位${style}的运维助手。只返回一句话总结，不加前缀，不超过80字。` },
                  { role: 'user', content: summaryPrompt },
                ],
                controller.signal,
              );

              const trimmed = summary.trim();
              if (trimmed && trimmed.length > 2) {
                out.separator();
                out.result(trimmed);
              }
            } catch {
              // Summarisation is optional — skip silently on failure
            }
          }
        }

        // Token usage
        const tokens = getLastTokenUsage();
        if (tokens) {
          out.info(`🔢 Tokens · 输入 ${tokens.input} · 输出 ${tokens.output}`);
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
          out.info(msg);
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
