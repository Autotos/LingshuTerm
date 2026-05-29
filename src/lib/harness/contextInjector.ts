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
import { DEFAULT_AGENTS_MD, DEFAULT_SOUL_MD } from './defaults';
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

const BASE_SYSTEM_PROMPT = `你是一位专业的终端运维助手，运行在用户的真实操作系统中。你的职责是将自然语言转换为可在当前终端执行的 Shell 命令序列。

## 关键规则：平台感知

**绝对不要同时为多个平台生成命令！** 上下文会告诉你当前的操作系统信息。你必须：
1. 根据上下文中的"当前操作系统"选择正确的命令语法（Windows = PowerShell/CMD，macOS = zsh/bash，Linux = bash）
2. 如果你的第一步是查询类任务且不确定环境，首先生成 \`uname -s\` 或 \`ver\` 来确认平台
3. 所有命令必须是当前平台可执行的，不要生成其他平台的命令

## 输出规则

1. 返回一个 JSON 数组，每个元素包含 "description"（中文描述）和 "command"（Shell 命令）。
2. 命令必须是可直接执行的完整命令，不要使用占位符或模板变量。
3. 多步骤按执行顺序排列。
4. 只返回 JSON 数组，不要包含任何解释或 Markdown。
5. 描述不明确时返回空数组 []。

## 路径兼容规则

**绝对不要使用 ~ 表示用户主目录！** 非交互式 Shell（后台执行）不会展开波浪号。
- Windows: 使用 \`$env:USERPROFILE\` 或 \`[Environment]::GetFolderPath('Desktop')\`
- Unix: 使用 \`$HOME\` 或绝对路径
- 桌面路径示例: \`$HOME/Desktop\` 或 \`$env:USERPROFILE\\Desktop\``;

// ─── Host OS detection ───────────────────────────────────────────

function detectHostOs(): string {
  const p = navigator.platform?.toLowerCase() ?? '';
  const ua = navigator.userAgent?.toLowerCase() ?? '';

  if (p.startsWith('win')) {
    // Detect architecture for more context
    const arch = navigator.userAgent?.includes('WOW64') || navigator.userAgent?.includes('Win64') ? 'x64' : 'x86';
    return `Windows (${arch}), 默认 Shell: PowerShell / CMD`;
  }
  if (p.startsWith('mac')) return 'macOS (Darwin), 默认 Shell: zsh / bash';
  if (p.startsWith('linux')) {
    if (ua.includes('android')) return 'Android (Linux), 默认 Shell: sh';
    return 'Linux, 默认 Shell: bash';
  }
  return '未知操作系统';
}

// ─── Public API ──────────────────────────────────────────────────

/** Read AGENTS.md with cache. Creates default template if missing. */
async function readAgentsMd(): Promise<string> {
  if (_cache && (Date.now() - _cache.ts) < CACHE_TTL_MS) {
    return _cache.content;
  }
  try {
    const content: string = await invoke('read_agents_md');
    _cache = { content, ts: Date.now() };
    return content;
  } catch {
    return DEFAULT_AGENTS_MD;
  }
}

// ─── SOUL.md cache ───────────────────────────────────────────────

let _soulCache: CacheEntry | null = null;

/** Read SOUL.md — AI personality profile. */
async function readSoulMd(): Promise<string> {
  if (_soulCache && (Date.now() - _soulCache.ts) < CACHE_TTL_MS) {
    return _soulCache.content;
  }
  try {
    const content: string = await invoke('read_memory_file', {
      sessionId: '__project__',
      filename: 'SOUL.md',
    });
    _soulCache = { content, ts: Date.now() };
    return content;
  } catch {
    return DEFAULT_SOUL_MD;
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
  const soulMd = await readSoulMd();

  // Build system prompt
  const parts: string[] = [];

  // Inject host OS
  const hostOs = detectHostOs();
  parts.push(`> **当前操作系统**：${hostOs}`);

  // Personality profile (SOUL.md) — shapes the AI's tone and style
  if (soulMd && soulMd !== DEFAULT_SOUL_MD) {
    parts.push('');
    parts.push(soulMd);
  }

  parts.push('');
  parts.push(agentsMd);
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
