/**
 * Harness Pipeline — main orchestrator for the 4-layer middleware system.
 *
 * This is the SINGLE ENTRY POINT that replaces direct aiService.nlToTasks() calls.
 * Each phase is a self-contained function, making the pipeline testable in isolation.
 *
 * Flow:
 *   User Input → [Inject Context] → LLM Call → [Guard] → Confirm → Execute → [Progress] → [Verify]
 */

import { invoke } from '@tauri-apps/api/core';
import { nlToTasks, resolveProvider } from '@/lib/aiService';
import type { AiTaskStep } from '@/lib/aiService';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildInjection } from './contextInjector';
import { checkCommand, isBlocked } from './permissionManager';
import { progressWriter, isLongTask } from './progressWriter';
import { runVerification, allPassed } from './verificationRunner';
import type {
  HarnessConfig,
  PipelineResult,
  GuardResult,
} from './types';
import { DEFAULT_HARNESS_CONFIG } from './defaults';

// ─── Types ───────────────────────────────────────────────────────

export interface PipelineCallbacks {
  /** Called when a command requires user confirmation. Return true to proceed. */
  onConfirm: (step: AiTaskStep, guardResult: GuardResult) => Promise<boolean>;
  /** Called before each command executes (for UI progress). */
  onExecuteStart: (step: AiTaskStep) => void;
  /** Called after each command finishes (for UI progress). */
  onExecuteEnd: (step: AiTaskStep, exitCode: number) => void;
  /** Called for general status updates. */
  onProgress: (status: string) => void;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

// ─── Main Pipeline ───────────────────────────────────────────────

/**
 * Run the full Harness pipeline for a user query.
 *
 * Returns a PipelineResult summarizing all phases.
 */
export async function runPipeline(
  userInput: string,
  sessionId: string,
  callbacks: PipelineCallbacks,
  config: HarnessConfig = DEFAULT_HARNESS_CONFIG,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    steps: [],
    guardResults: [],
    verifyResults: [],
    progressUpdated: false,
    finalStatus: 'success',
    summary: '',
  };

  const { onConfirm, onExecuteStart, onExecuteEnd, onProgress, signal } = callbacks;

  // ── Phase 1: Context Injection ──
  onProgress('正在读取项目上下文...');
  const aiConfig = useSettingsStore.getState().settings.ai;
  const provider = resolveProvider(aiConfig);

  if (!provider.baseUrl) {
    result.finalStatus = 'failed';
    result.summary = 'AI API 未配置，请在设置中配置 AI 服务';
    onProgress(result.summary);
    return result;
  }

  const injection = await buildInjection(sessionId, userInput);

  if (signal?.aborted) {
    result.finalStatus = 'partial';
    result.summary = '用户取消';
    return result;
  }

  // ── Phase 2: LLM Call ──
  onProgress('AI 正在分析任务...');
  let steps: AiTaskStep[];
  try {
    steps = await nlToTasks(aiConfig, userInput, signal, injection.messages);
  } catch (err) {
    result.finalStatus = 'failed';
    result.summary = `AI 调用失败: ${err instanceof Error ? err.message : String(err)}`;
    onProgress(result.summary);
    return result;
  }

  if (steps.length === 0) {
    result.finalStatus = 'success';
    result.summary = 'AI 未返回可执行命令';
    return result;
  }

  result.steps = steps;

  if (signal?.aborted) {
    result.finalStatus = 'partial';
    result.summary = '用户取消';
    return result;
  }

  // ── Phase 3: Permission Guard + Execution ──
  for (const step of steps) {
    if (signal?.aborted) break;

    const guardResult = checkCommand(step.command, config.guardRules);
    result.guardResults.push(guardResult);

    if (isBlocked(guardResult)) {
      onProgress(`命令被拒绝: ${step.command} (${guardResult.matchedRule?.label})`);
      result.finalStatus = 'denied';
      result.summary = `命令 "${step.command}" 被安全策略拒绝: ${guardResult.auditEntry.reason}`;
      return result;
    }

    if (guardResult.action === 'ask') {
      const approved = await onConfirm(step, guardResult);
      if (!approved) {
        onProgress(`用户跳过: ${step.command}`);
        continue;
      }
    }

    // Execute
    onExecuteStart(step);
    try {
      // Use the existing execute_block_command Tauri command
      await invoke('execute_block_command', {
        sessionId,
        command: step.command,
      });
      onExecuteEnd(step, 0); // Block system tracks actual exit code via events
      onProgress(`完成: ${step.command}`);
    } catch (err) {
      onExecuteEnd(step, -1);
      onProgress(`执行失败: ${step.command}`);
    }
  }

  // ── Phase 4: Progress Persistence ──
  if (isLongTask(steps, config.longTaskStepThreshold, config.longTaskLengthThreshold)) {
    try {
      const completed = result.guardResults
        .filter((g) => g.action !== 'deny')
        .map((_, i) => ({
          command: steps[i].command,
          description: steps[i].description,
          exitCode: 0,
        }));

      await progressWriter.save(sessionId, {
        taskDescription: userInput.slice(0, 200),
        completedSteps: completed,
        currentStep: '',
        pendingSteps: [],
        verifyCommands: injection.verifyCommands,
      });
      result.progressUpdated = true;
    } catch {
      /* non-critical */
    }
  }

  // ── Phase 5: Verification ──
  if (injection.verifyCommands.length > 0 && result.finalStatus !== 'denied') {
    onProgress('正在运行验收命令...');

    result.verifyResults = await runVerification({
      sessionId,
      commands: injection.verifyCommands,
      maxRetries: config.maxVerifyRetries,
      onProgress,
      onRetry: async (failedCmd, stderr, attempt) => {
        const fixInput = `验收命令 "${failedCmd}" 失败 (exit non-zero, attempt ${attempt})。错误信息:\n${stderr.slice(0, 2000)}\n\n请生成修复命令。`;
        try {
          return await nlToTasks(aiConfig, fixInput, signal, [
            { role: 'system', content: injection.systemPrompt },
            { role: 'user', content: fixInput },
          ]);
        } catch {
          return [];
        }
      },
    });

    if (!allPassed(result.verifyResults)) {
      result.finalStatus = 'failed';
      result.summary = '验收命令执行失败，请查看详细结果';
    } else {
      // All passed — mark progress complete
      if (result.progressUpdated) {
        await progressWriter.complete(sessionId).catch(() => {});
      }
      result.summary = `已完成 ${steps.length} 个步骤，所有验收命令通过`;
    }
  } else {
    result.summary = `已完成 ${steps.length} 个步骤`;
  }

  return result;
}
