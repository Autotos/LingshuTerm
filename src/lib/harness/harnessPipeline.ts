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
  /** Called before each command executes. */
  onExecuteStart: (step: AiTaskStep) => void;
  /** Called after each command finishes. capturedOutput = stdout from the command. */
  onExecuteEnd: (step: AiTaskStep, exitCode: number, capturedOutput: string) => void;
  /** Called for general status updates. */
  onProgress: (status: string) => void;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/** Result of executing a command and capturing its output */
interface ExecuteResult {
  commandId: string;
  exitCode: number;
  output: string;
}

/**
 * Execute a command and capture its output cleanly.
 *
 * Uses the Rust `exec_shell_cmd` Tauri command which spawns a child process
 * (powershell.exe -NonInteractive on Windows, sh -c on Unix) and returns
 * stdout+stderr+exit_code directly — completely bypassing the PTY.
 *
 * No more echoed script lines, no ANSI noise, no prompt artifacts.
 */
async function executeAndCapture(
  _sessionId: string,
  command: string,
  timeoutMs: number,
): Promise<ExecuteResult> {
  try {
    const result: { exit_code: number; stdout: string; stderr: string } =
      await invoke('exec_shell_cmd', {
        command,
        timeoutSecs: Math.ceil(timeoutMs / 1000),
      });

    const output = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    const combined = [output, stderr].filter(Boolean).join('\n');

    return {
      commandId: '',
      exitCode: result.exit_code,
      output: stripAnsi(combined),
    };
  } catch (err) {
    return {
      commandId: '',
      exitCode: -1,
      output: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Strip ANSI escape sequences from captured output. */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-Z]/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Resolve the path to PowerShell on Windows via the existing shell detection. */
async function resolveWindowsPowerShell(): Promise<string> {
  try {
    const shells: { kind: string; label: string; path: string }[] = await invoke('list_local_shells');
    const ps = shells.find((s) => s.kind === 'powershell');
    if (ps) return ps.path;
  } catch { /* fall through to default */ }
  // Last-resort fallback — works on all modern Windows installations
  return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
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

  // ── Resolve execution session: if no terminal is open, create a background local PTY ──
  let execSessionId = sessionId;
  const isValidSession = /^(session|ssh|telnet|serial)-\d/.test(execSessionId);
  if (!isValidSession) {
    // Pick the right shell for the platform.  On Windows we MUST use PowerShell
    // because cmd.exe doesn't understand the OSC 7701 wrapper syntax that the
    // block execution system relies on.
    const isWindows = navigator.platform?.toLowerCase().startsWith('win') ?? false;
    const defaultShell = isWindows
      ? (await resolveWindowsPowerShell())
      : '';

    try {
      execSessionId = await invoke<string>('create_session', {
        config: { protocol: 'local', shell: defaultShell, cwd: undefined },
      });
      // Wait for the shell to initialise.  With exec_shell_cmd we spawn
      // a fresh child process for each command, so we just need the PTY
      // session to be alive — not interactive-ready.
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    } catch {
      result.finalStatus = 'failed';
      result.summary = '无法创建后台执行会话';
      return result;
    }
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

    // Execute and capture output
    onExecuteStart(step);
    try {
      const execResult = await executeAndCapture(execSessionId, step.command, 30_000);
      const capturedOutput = execResult.output.trim();
      onExecuteEnd(step, execResult.exitCode, capturedOutput);
      if (execResult.exitCode !== 0) {
        result.finalStatus = 'failed';
      }
    } catch (err) {
      onExecuteEnd(step, -1, '');
      result.finalStatus = 'failed';
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
  // Skip verification for read-only queries — only verify when commands
  // might have side effects (modify files, install packages, build, git ops)
  const isReadOnly = steps.every((s) => {
    const cmd = s.command;
    return (
      // Query/read commands
      /^(Get-ChildItem|ls|dir|cat|type|gc |grep|find|Select-String|head|tail|wc|echo|Write-Output|printf|du|df|free|ps|whoami|date|uname|which|where|whereis|stat|file |npm (list|view|outdated)|cargo search|git (status|log|diff|branch|remote)|winget list|choco list|pip (list|show|freeze)|conda list)\b/i.test(cmd)
      // Commands that only read/query
      || /\b(Get-|\.Count|\.Length|Measure-Object)\b/.test(cmd)
      // Explicitly NOT modify commands
      && !/\b(rm |mv |cp |mkdir|touch|New-Item|Set-Content|Out-File|>|>>|\binstall\b|\buninstall\b|\bpublish\b|\bbuild\b|git (push|commit|merge|rebase|add)|npm (install|uninstall|update|publish)|pip (install|uninstall)|cargo (install|publish|update)|chmod|chown)\b/i.test(cmd)
    );
  });

  if (injection.verifyCommands.length > 0 && result.finalStatus !== 'denied' && !isReadOnly) {
    onProgress('正在运行验收命令...');

    result.verifyResults = await runVerification({
      sessionId: execSessionId,
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
