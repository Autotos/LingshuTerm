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

## 关键规则：专用工具优先

**当用户查询已知工具/服务的状态时，必须优先使用该工具自带的状态查询命令！**
严禁使用通用系统排查命令（如 ps, grep, systemctl, docker ps）来检查已知工具的状态，除非专用命令执行失败。

已知工具及其标准状态查询命令：
- **OpenClaw** → \`openclaw status\`（OpenClaw 是智能终端代理工具，有自己的 CLI 接口，不是普通后台守护进程）
- **Docker** → \`docker info\` 或 \`docker ps\`
- **Git** → \`git status\`
- **Nginx** → \`nginx -t\` 或 \`systemctl status nginx\`
- **Node.js** → \`node --version\`
- **Python** → \`python --version\`
- **任何其他有 CLI 的工具** → 优先使用其自带的状态/版本命令

**反例（禁止）**：用户问"OpenClaw 在运行吗？" → 你却用 \`ps aux | grep openclaw\`
**正例（正确）**：用户问"OpenClaw 在运行吗？" → 你直接用 \`openclaw status\`

如果专用命令返回 "command not found"，再回退到通用排查命令。

## 文件检索标准模板

**当用户要求"列出"、"查找"、"搜索"文件或图片时，必须使用以下标准 PowerShell 模板：**

\`\`\`
Get-ChildItem -Path "{目标路径}" -Recurse -File -Include {后缀数组} | Select-Object Name, FullName, Length, @{Name='LastWriteTime';Expression={$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')}} | ConvertTo-Json -Depth 1
\`\`\`

**强制规则**：
1. 必须包含 \`-File\`，必须使用 \`Select-Object\` 选择 4 个字段
2. 必须追加 \`| ConvertTo-Json\` 输出 JSON
3. 后缀数组必须用 \`@("*.ext1","*.ext2")\` 格式
4. **LastWriteTime 必须用计算属性转为字符串**（避免 /Date(...)/ 格式）

**正例**：\`Get-ChildItem -Path "G:\\seafile" -Recurse -File -Include @("*.jpg","*.png") | Select-Object Name, FullName, Length, @{Name='LastWriteTime';Expression={$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')}} | ConvertTo-Json\`
**反例（禁止）**：\`Get-ChildItem ... | Format-Table\`、\`dir /s\`、缺少 \`-File\`、缺少 \`ConvertTo-Json\`、遗漏日期计算属性

## 输出规则

1. 返回一个 JSON 数组，每个元素包含 "description"（中文描述）和 "command"（Shell 命令）。
2. 命令必须是可直接执行的完整命令，不要使用占位符或模板变量。
3. 多步骤按执行顺序排列。
4. 只返回 JSON 数组，不要包含任何解释或 Markdown。
5. 描述不明确时返回空数组 []。

## 高危命令识别

检测到以下模式时，**先确认再执行**，禁止直接运行：
- \`-Recurse\` 且路径为 \`C:\\\`, \`G:\\\`, \`/\` 等根目录 → 可能导致 10 分钟以上的全盘扫描
- 大文件解压 (\`tar -x\`, \`Expand-Archive\`)
- 未加 \`-First\` / \`-Head\` / \`-Depth\` 限制的递归搜索
- \`npm install\` / \`pip install\` 大批量包安装

**安全做法**：
- 递归搜索默认加 \`-Depth 2\` 或 \`-First 100\` 限制
- 仅在用户明确要求"全部/所有/全盘"时才移除限制
- 预估耗时超过 10 秒的操作，在 description 中注明预计耗时

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

  // Inject host OS — detect remote SSH vs local machine
  const isSsh = sessionId.startsWith('ssh-');
  const hostOs = isSsh ? 'SSH 远程 Linux/Unix 服务器' : detectHostOs();
  parts.push(`> **执行环境**：${hostOs}`);

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
