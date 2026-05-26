/**
 * Progress Writer — PROGRESS.md persistence for cross-session task continuity.
 *
 * Pipeline phase 4: runs after command execution, writes progress for long tasks.
 *
 * Responsibilities:
 *   1. Determine if a task qualifies as "long" (step count / command length threshold)
 *   2. Write PROGRESS.md with structured progress snapshot
 *   3. Load PROGRESS.md on new session for task resume
 *   4. Format progress as Markdown for AGENTS.md injection
 */

import { invoke } from '@tauri-apps/api/core';
import type { ProgressSnapshot, ProgressWriteInput, StepRecord } from './types';

// ─── Format helpers ──────────────────────────────────────────────

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Serialize a ProgressSnapshot to PROGRESS.md Markdown */
function formatMarkdown(snap: ProgressSnapshot): string {
  const lines: string[] = [];

  lines.push('# 任务进度\n');
  lines.push(`> **创建时间**: ${snap.createdAt}`);
  lines.push(`> **最后更新**: ${snap.updatedAt}`);
  lines.push(`> **状态**: ${snap.status}\n`);

  if (snap.completedSteps.length > 0) {
    lines.push('## 已完成的步骤');
    for (const s of snap.completedSteps) {
      lines.push(`- [x] \`${s.command}\` — ${s.description} (exit: ${s.exitCode})`);
    }
    lines.push('');
  }

  if (snap.currentStep) {
    lines.push('## 当前步骤');
    lines.push(`- [ ] ${snap.currentStep}\n`);
  }

  if (snap.pendingSteps.length > 0) {
    lines.push('## 待办步骤');
    for (const s of snap.pendingSteps) {
      lines.push(`- [ ] ${s}`);
    }
    lines.push('');
  }

  if (snap.verifyCommands.length > 0) {
    lines.push('## 验收命令');
    for (const s of snap.verifyCommands) {
      lines.push(`- \`${s}\``);
    }
    lines.push('');
  }

  if (snap.notes) {
    lines.push('## 备注');
    lines.push(snap.notes);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Persistence ─────────────────────────────────────────────────

function makeKey(sessionId: string): string {
  // Sanitize session ID for filename
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Parse PROGRESS.md content back into a ProgressSnapshot.
 * Returns null if the content is not valid progress markdown.
 */
function parseProgress(content: string): ProgressSnapshot | null {
  try {
    const statusMatch = content.match(/\*\*状态\*\*:\s*(.+)/);
    if (!statusMatch) return null;

    const status = statusMatch[1].trim() as ProgressSnapshot['status'];
    const createdMatch = content.match(/\*\*创建时间\*\*:\s*(.+)/);
    const updatedMatch = content.match(/\*\*最后更新\*\*:\s*(.+)/);

    // Parse completed steps
    const completedSteps: StepRecord[] = [];
    const completedRe = /- \[x\]\s*`([^`]+)`\s*—\s*(.+?)\s*\(exit:\s*(-?\d+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = completedRe.exec(content)) !== null) {
      completedSteps.push({
        command: m[1],
        description: m[2],
        exitCode: parseInt(m[3], 10),
      });
    }

    // Parse current step
    const currentMatch = content.match(/## 当前步骤\s*\n- \[ \]\s*(.+)/);
    const currentStep = currentMatch ? currentMatch[1].trim() : '';

    // Parse pending steps
    const pendingSteps: string[] = [];
    const pendingSection = content.match(/## 待办步骤\s*\n([\s\S]*?)(?=\n##|$)/);
    if (pendingSection) {
      const pendingRe = /- \[ \]\s*(.+)/g;
      while ((m = pendingRe.exec(pendingSection[1])) !== null) {
        pendingSteps.push(m[1].trim());
      }
    }

    // Parse verify commands
    const verifyCommands: string[] = [];
    const verifySection = content.match(/## 验收命令\s*\n([\s\S]*?)(?=\n##|$)/);
    if (verifySection) {
      const verifyRe = /- `([^`]+)`/g;
      while ((m = verifyRe.exec(verifySection[1])) !== null) {
        verifyCommands.push(m[1]);
      }
    }

    // Parse notes
    const notesMatch = content.match(/## 备注\s*\n([\s\S]*?)(?=\n##|$)/);
    const notes = notesMatch ? notesMatch[1].trim() : '';

    // Parse task description (first non-empty line after "# 任务进度")
    const taskMatch = content.match(/# 任务进度\s*\n+\*\*创建时间\*\*[\s\S]*?\n\n([^\n#][^\n]*)/);
    const taskDescription = taskMatch ? taskMatch[1].trim() : '未命名任务';

    return {
      status,
      taskDescription,
      completedSteps,
      currentStep,
      pendingSteps,
      verifyCommands,
      notes,
      createdAt: createdMatch ? createdMatch[1].trim() : now(),
      updatedAt: updatedMatch ? updatedMatch[1].trim() : now(),
    };
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────

export const progressWriter = {
  formatMarkdown,

  /** Load progress from PROGRESS.md. Returns null if no progress file or no in-progress task. */
  async load(sessionId: string): Promise<ProgressSnapshot | null> {
    try {
      const key = makeKey(sessionId);
      const content: string = await invoke('read_memory_file', {
        sessionId: key,
        filename: 'PROGRESS.md',
      });
      if (!content) return null;
      return parseProgress(content);
    } catch {
      return null;
    }
  },

  /** Save or update PROGRESS.md. */
  async save(sessionId: string, input: ProgressWriteInput): Promise<void> {
    const key = makeKey(sessionId);
    const nowStr = now();

    // Load existing to preserve created time
    let existing: ProgressSnapshot | null = null;
    try {
      existing = await this.load(sessionId);
    } catch {
      /* fresh */
    }

    const snapshot: ProgressSnapshot = {
      status: '进行中',
      taskDescription: input.taskDescription,
      completedSteps: input.completedSteps,
      currentStep: input.currentStep,
      pendingSteps: input.pendingSteps,
      verifyCommands: input.verifyCommands,
      notes: input.notes ?? '',
      createdAt: existing?.createdAt ?? nowStr,
      updatedAt: nowStr,
    };

    const md = formatMarkdown(snapshot);
    await invoke('write_memory_file', {
      sessionId: key,
      filename: 'PROGRESS.md',
      content: md,
    });
  },

  /** Mark progress as completed. */
  async complete(sessionId: string): Promise<void> {
    const existing = await this.load(sessionId);
    if (!existing) return;

    existing.status = '已完成';
    existing.updatedAt = now();
    const md = formatMarkdown(existing);
    await invoke('write_memory_file', {
      sessionId: makeKey(sessionId),
      filename: 'PROGRESS.md',
      content: md,
    });
  },

  /** Delete progress file. */
  async clear(sessionId: string): Promise<void> {
    await invoke('write_memory_file', {
      sessionId: makeKey(sessionId),
      filename: 'PROGRESS.md',
      content: '',
    });
  },
};

// ─── Long task detection ────────────────────────────────────────

/**
 * Check if a task qualifies as "long" based on heuristic thresholds.
 */
export function isLongTask(
  steps: { command: string; description: string }[],
  stepThreshold: number,
  lengthThreshold: number,
): boolean {
  if (steps.length > stepThreshold) return true;
  const totalLength = steps.reduce((sum, s) => sum + s.command.length, 0);
  return totalLength > lengthThreshold;
}
