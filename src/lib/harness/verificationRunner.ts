/**
 * Verification Runner — auto-executes acceptance commands and retries on failure.
 *
 * Pipeline phase 5: runs after all task steps complete.
 *
 * Workflow:
 *   1. Execute each verification command (from AGENTS.md or user input)
 *   2. Check exit code:
 *      - 0 → PASS, continue
 *      - non-zero → collect error output → send back to LLM for fix (max 3 retries)
 *   3. Return results
 */

import { invoke } from '@tauri-apps/api/core';
import type { AiTaskStep } from '@/lib/aiService';
import type { VerifyResult } from './types';

// ─── Types ───────────────────────────────────────────────────────

export interface RunVerifyOptions {
  sessionId: string;
  commands: string[];
  maxRetries: number;
  /** Callback that sends error output to LLM and returns fix commands */
  onRetry: (failedCmd: string, stderr: string, attempt: number) => Promise<AiTaskStep[]>;
  /** Progress callback */
  onProgress: (status: string) => void;
}

// ─── Internal: execute a single command and wait for exit code ────

interface CmdResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function execVerifyCmd(
  sessionId: string,
  command: string,
  timeoutSecs: number,
): Promise<CmdResult> {
  try {
    const result: CmdResult = await invoke('run_verify_cmd', {
      sessionId,
      command,
      timeoutSecs,
    });
    return result;
  } catch (err) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: `run_verify_cmd failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Run the verification loop for a set of commands.
 *
 * For each verification command:
 *   1. Execute it silently
 *   2. If exitCode = 0 → mark PASS
 *   3. If exitCode ≠ 0 → call onRetry to get fix commands
 *      → execute fix commands → re-run verification (up to maxRetries)
 *
 * Returns array of VerifyResult (one per verification command).
 */
export async function runVerification(opts: RunVerifyOptions): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];

  for (const command of opts.commands) {
    opts.onProgress(`验收命令: ${command}`);

    let passed = false;
    let attempt = 0;

    while (attempt <= opts.maxRetries && !passed) {
      const result = await execVerifyCmd(opts.sessionId, command, 30);

      if (result.exitCode === 0) {
        passed = true;
        results.push({
          status: 'pass',
          command,
          exitCode: 0,
          stdout: result.stdout,
          stderr: result.stderr,
          attempt,
        });
        opts.onProgress(`验收通过: ${command}`);
      } else {
        attempt++;
        opts.onProgress(`验收失败 (attempt ${attempt}/${opts.maxRetries}): ${command} (exit ${result.exitCode})`);

        if (attempt > opts.maxRetries) {
          results.push({
            status: 'fail',
            command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            attempt: attempt - 1,
          });
          break;
        }

        // Request fix from LLM
        try {
          const fixSteps = await opts.onRetry(
            command,
            result.stderr || result.stdout,
            attempt,
          );

          if (fixSteps.length === 0) {
            // LLM couldn't suggest a fix
            results.push({
              status: 'fail',
              command,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              attempt,
            });
            break;
          }

          // Execute fix commands
          for (const step of fixSteps) {
            opts.onProgress(`修复: ${step.command}`);
            await execVerifyCmd(opts.sessionId, step.command, 60);
          }
        } catch {
          results.push({
            status: 'fail',
            command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            attempt,
          });
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Convenience: check if all verification results passed.
 */
export function allPassed(results: VerifyResult[]): boolean {
  if (results.length === 0) return true; // no verify commands = pass
  return results.every((r) => r.status === 'pass');
}
