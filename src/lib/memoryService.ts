/**
 * Hierarchical memory system for AI Agent.
 *
 *   Sensory Buffer → Short-Term Memory → Long-Term Memory → External Storage
 *
 * Files (per session):
 *   {workspace}/sessions/{session_id}/
 *     ├─ memory_short.json   — sliding window of recent turns
 *     ├─ memory_long.json    — accumulated knowledge / preferences
 *     └─ AGENT.md            — behaviour spec / system prompt
 */

import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '@/lib/aiService';

// ─── Types ───────────────────────────────────────────────────────

export type MemoryRole = 'system' | 'user' | 'assistant';

export interface ShortTermEntry {
  role: MemoryRole;
  content: string;
  ts: number;
}

export interface LongTermEntry {
  id: string;
  category: 'preference' | 'knowledge' | 'command' | 'error_fix';
  content: string;
  ts: number;
}

export interface MemorySnapshot {
  shortTerm: ShortTermEntry[];
  longTerm: LongTermEntry[];
  agentMd: string;
}

// ─── Sliding window config ───────────────────────────────────────

const MAX_SHORT_TERM_TURNS = 10;
const MAX_SHORT_TERM_TOKENS = 4000;

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for Chinese, ~4 chars for English
  return Math.ceil(text.replace(/\s/g, '').length / 2.5);
}

function trimShortTerm(entries: ShortTermEntry[]): ShortTermEntry[] {
  let total = 0;
  const kept: ShortTermEntry[] = [];
  // Keep most recent entries within token budget
  for (let i = entries.length - 1; i >= 0; i--) {
    const t = estimateTokens(entries[i].content);
    if (total + t > MAX_SHORT_TERM_TOKENS || kept.length >= MAX_SHORT_TERM_TURNS * 2) break;
    total += t;
    kept.unshift(entries[i]);
  }
  return kept;
}

// ─── I/O ─────────────────────────────────────────────────────────

async function readMemoryFile(
  sessionId: string,
  filename: string,
): Promise<string | null> {
  const result: string | null = await invoke('read_memory_file', {
    sessionId,
    filename,
  });
  return result;
}

async function writeMemoryFile(
  sessionId: string,
  filename: string,
  content: string,
): Promise<void> {
  await invoke('write_memory_file', { sessionId, filename, content });
}

// ─── Public API ──────────────────────────────────────────────────

/** Load all memory files for a session. */
export async function loadMemory(sessionId: string): Promise<MemorySnapshot> {
  const [shortRaw, longRaw, agentMd] = await Promise.all([
    readMemoryFile(sessionId, 'memory_short.json').catch(() => null),
    readMemoryFile(sessionId, 'memory_long.json').catch(() => null),
    readMemoryFile(sessionId, 'AGENT.md').catch(() => null),
  ]);

  let shortTerm: ShortTermEntry[] = [];
  let longTerm: LongTermEntry[] = [];

  try { shortTerm = JSON.parse(shortRaw || '[]'); } catch { /* empty */ }
  try { longTerm = JSON.parse(longRaw || '[]'); } catch { /* empty */ }

  return { shortTerm: trimShortTerm(shortTerm), longTerm, agentMd: agentMd || '' };
}

/** Append a user/assistant turn to short-term memory. */
export async function appendShortTerm(
  sessionId: string,
  entries: ShortTermEntry[],
): Promise<void> {
  const snap = await loadMemory(sessionId);
  snap.shortTerm.push(...entries);
  snap.shortTerm = trimShortTerm(snap.shortTerm);
  await writeMemoryFile(sessionId, 'memory_short.json', JSON.stringify(snap.shortTerm));
}

/** Extract and merge long-term entries from recent conversation. */
export async function updateLongTerm(
  sessionId: string,
  newEntries: LongTermEntry[],
): Promise<void> {
  const snap = await loadMemory(sessionId);
  for (const ne of newEntries) {
    // Deduplicate by content similarity (simple: exact match)
    if (!snap.longTerm.some((e) => e.content === ne.content)) {
      snap.longTerm.push(ne);
    }
  }
  // Keep most recent 200 entries
  if (snap.longTerm.length > 200) {
    snap.longTerm = snap.longTerm.slice(-200);
  }
  await writeMemoryFile(sessionId, 'memory_long.json', JSON.stringify(snap.longTerm));
}

/** Write or update AGENT.md for a session. */
export async function saveAgentMd(
  sessionId: string,
  content: string,
): Promise<void> {
  await writeMemoryFile(sessionId, 'AGENT.md', content);
}

/** Clear short-term memory (start fresh). */
export async function clearShortTerm(sessionId: string): Promise<void> {
  await writeMemoryFile(sessionId, 'memory_short.json', '[]');
}

/** Clear all memory for a session. */
export async function clearAllMemory(sessionId: string): Promise<void> {
  await writeMemoryFile(sessionId, 'memory_short.json', '[]');
  await writeMemoryFile(sessionId, 'memory_long.json', '[]');
}

// ─── Prompt assembly ─────────────────────────────────────────────

/**
 * Assemble the full system + context prompt for the LLM.
 *
 * Order: AGENT.md → Long-Term Memory → Short-Term Memory → User Input
 */
export async function assemblePrompt(
  sessionId: string,
  userInput: string,
): Promise<{ system: string; messages: ChatMessage[] }> {
  const mem = await loadMemory(sessionId);

  // ── System message ──
  const systemParts: string[] = [];

  if (mem.agentMd) {
    systemParts.push(mem.agentMd);
  } else {
    systemParts.push(DEFAULT_AGENT_MD);
  }

  if (mem.longTerm.length > 0) {
    systemParts.push('\n## Long-Term Memory (persistent knowledge)');
    for (const e of mem.longTerm) {
      systemParts.push(`- [${e.category}] ${e.content}`);
    }
  }

  const systemMessage = systemParts.join('\n');

  // ── Messages array ──
  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
  ];

  if (mem.shortTerm.length > 0) {
    for (const e of mem.shortTerm) {
      messages.push({ role: e.role, content: e.content });
    }
  }

  messages.push({ role: 'user', content: userInput });

  return { system: systemMessage, messages };
}

const DEFAULT_AGENT_MD = `你是一位专业的终端运维助手，运行在 LingshuTerm 智能终端中。
你的职责是帮助用户执行命令、管理系统、解决问题。

规则：
1. 返回的 JSON 数组中每个元素包含 "description"（描述）和 "command"（命令）。
2. 命令必须是可以直接执行的完整命令，不要使用占位符。
3. 如果任务需要多个步骤，按执行顺序排列。
4. 只返回 JSON 数组，不要包含任何其他文字。
5. 如果用户的描述不明确，返回空数组 []。
6. 尽量使用当前系统已有的工具和命令。

当前终端环境信息会通过上下文提供给你。`;
