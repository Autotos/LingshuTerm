/**
 * Context Injector — reads AGENTS.md and injects it into the System Prompt.
 *
 * Pipeline phase 1: runs before LLM call.
 *
 * Responsibilities:
 *   1. Read AGENTS.md from project root (with 5-min cache)
 *   2. Create default template if missing
 *   3. Check PROGRESS.md for in-progress task resume
 *   4. Assemble the full system prompt: AGENTS.md + base prompt + progress context
 *   5. Extract verification commands from AGENTS.md
 */

import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_AGENTS_MD } from './defaults';
import { progressWriter } from './progressWriter';
import type { InjectResult, HarnessContext } from './types';
import type { ChatMessage } from '@/lib/aiService';

// ─── Cache ───────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  content: string;
  ts: number;
}

let _cache: CacheEntry | null = null;

// ─── System prompt base (migrated from aiService.ts) ─────────────

const BASE_SYSTEM_PROMPT = `你是一位专业的 Linux/macOS/Windows 运维专家，用户会用自然语言描述他们想要完成的操作任务。
你的职责是将用户的自然语言描述转换为可以在终端中执行的 Shell 命令序列。

## 输出规则

1. 通常返回一个 JSON 数组，每个元素包含 "description"（中文描述）和 "command"（Shell 命令）。
2. 命令应该是可以直接执行的完整命令，不要使用占位符。
3. 如果任务需要多个步骤，按照执行顺序排列。
4. 只返回 JSON 数组，不要包含任何其他文字、解释或 Markdown 标记。
5. 如果用户的描述不明确或无法转换为命令，返回空数组 []。`;

// ─── Public API ──────────────────────────────────────────────────

/** Read AGENTS.md with cache. Creates default template if missing. */
async function readAgentsMd(): Promise<string> {
  // Check cache
  if (_cache && (Date.now() - _cache.ts) < CACHE_TTL_MS) {
    return _cache.content;
  }

  try {
    const content: string = await invoke('read_agents_md');
    _cache = { content, ts: Date.now() };
    return content;
  } catch {
    // File doesn't exist or read failed — return default
    return DEFAULT_AGENTS_MD;
  }
}

/** Force-refresh the AGENTS.md cache (called after file changes). */
export function invalidateAgentsCache(): void {
  _cache = null;
}

/**
 * Extract verification commands from AGENTS.md content.
 * Looks for:
 *   1. `## 验收命令` section with fenced code blocks
 *   2. `verify:` / `验收命令:` inline patterns
 */
function extractVerifyCommands(agentsMd: string): string[] {
  const commands: string[] = [];

  // Match fenced code blocks after "验收命令" heading
  const sectionRe = /验收命令\s*\n+((?:```[\s\S]*?```\s*)+)/gi;
  let sectionMatch: RegExpExecArray | null;
  while ((sectionMatch = sectionRe.exec(agentsMd)) !== null) {
    const blockRe = /```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRe.exec(sectionMatch[1])) !== null) {
      for (const line of blockMatch[1].split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          commands.push(trimmed);
        }
      }
    }
  }

  // Also match inline verify: commands
  const inlineRe = /^(?:verify|验收命令)\s*:\s*(.+)$/gim;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineRe.exec(agentsMd)) !== null) {
    commands.push(inlineMatch[1].trim());
  }

  return [...new Set(commands)]; // deduplicate
}

/**
 * Assemble the full system prompt and message list for LLM call.
 *
 * Order: AGENTS.md → Base prompt → PROGRESS.md resume → User input
 */
export async function buildInjection(
  sessionId: string,
  userInput: string,
  preMessages?: ChatMessage[],
): Promise<InjectResult> {
  const agentsMd = await readAgentsMd();

  // Build system prompt
  const parts: string[] = [agentsMd];
  parts.push('\n---\n');
  parts.push(BASE_SYSTEM_PROMPT);

  // Check for in-progress task
  let resumeMode = false;
  try {
    const progress = await progressWriter.load(sessionId);
    if (progress && progress.status === '进行中') {
      resumeMode = true;
      parts.push('\n---\n');
      parts.push('## 正在继续之前的任务');
      parts.push(`任务: ${progress.taskDescription}`);
      parts.push('');
      if (progress.completedSteps.length > 0) {
        parts.push('已完成步骤:');
        for (const s of progress.completedSteps) {
          parts.push(`  - [x] ${s.command} — ${s.description}`);
        }
      }
      parts.push(`当前步骤: ${progress.currentStep}`);
      if (progress.pendingSteps.length > 0) {
        parts.push('待完成:');
        for (const s of progress.pendingSteps) {
          parts.push(`  - [ ] ${s}`);
        }
      }
    }
  } catch {
    /* no progress file */
  }

  const systemPrompt = parts.join('\n');

  // Extract verify commands
  const verifyCommands = extractVerifyCommands(agentsMd);

  // Build messages array
  const messages: ChatMessage[] = [];
  if (preMessages && preMessages.length > 0) {
    messages.push(...preMessages);
  } else {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userInput });

  return { systemPrompt, messages, verifyCommands, resumeMode };
}

/** Get AGENTS.md content directly (bypasses prompt assembly, for config UI). */
export async function getAgentsMdRaw(): Promise<string> {
  return readAgentsMd();
}

/** Write new content to AGENTS.md and invalidate cache. */
export async function writeAgentsMd(content: string): Promise<void> {
  await invoke('write_memory_file', {
    sessionId: '__project__',
    filename: 'AGENTS.md',
    content,
  });
  invalidateAgentsCache();
}

/** Get just the extracted HarnessContext snapshot. */
export async function getHarnessContext(sessionId: string): Promise<HarnessContext> {
  const agentsMd = await readAgentsMd();
  let progressMd: string | null = null;
  try {
    const progress = await progressWriter.load(sessionId);
    if (progress) {
      progressMd = progressWriter.formatMarkdown(progress);
    }
  } catch {
    /* no progress */
  }
  const verifyCommands = extractVerifyCommands(agentsMd);

  return { agentsMd, progressMd, verifyCommands };
}
