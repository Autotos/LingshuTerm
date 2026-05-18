/**
 * OpenAI-compatible AI service client.
 * Supports multiple provider configurations with user-selectable current provider.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface AiConfig {
  /** ID of the currently active provider */
  currentProviderId: string;
  /** All configured providers */
  providers: AiProviderConfig[];
}

// ─── Defaults ────────────────────────────────────────────────────

let _providerSeq = 0;
function nextId(): string {
  _providerSeq++;
  return `provider-${_providerSeq}`;
}

const defaultProvider: AiProviderConfig = {
  id: nextId(),
  name: 'Default (DashScope)',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen-turbo',
  maxTokens: 2048,
  temperature: 0.3,
};

export const defaultAiConfig: AiConfig = {
  currentProviderId: defaultProvider.id,
  providers: [defaultProvider],
};

/** Resolve the active provider from an AiConfig. */
export function resolveProvider(config: AiConfig): AiProviderConfig {
  return config.providers.find((p) => p.id === config.currentProviderId)
    ?? config.providers[0]
    ?? defaultProvider;
}

// ─── Presets ─────────────────────────────────────────────────────

export interface PresetDef {
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export const AI_PRESETS: Record<string, PresetDef> = {
  dashscope:  { label: '百炼 (DashScope)',   baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-turbo' },
  ark:        { label: '火山方舟 (Ark)',      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',         defaultModel: 'doubao-pro-32k' },
  zhipu:      { label: '智谱 (GLM)',          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',             defaultModel: 'glm-4-flash' },
  minimax:    { label: 'MiniMax',             baseUrl: 'https://api.minimax.chat/v1',                      defaultModel: 'abab6.5s-chat' },
  moonshot:   { label: 'Kimi (Moonshot)',     baseUrl: 'https://api.moonshot.cn/v1',                       defaultModel: 'moonshot-v1-8k' },
  openai:     { label: 'OpenAI',              baseUrl: 'https://api.openai.com/v1',                        defaultModel: 'gpt-4o-mini' },
  ollama:     { label: 'Ollama (本地)',        baseUrl: 'http://localhost:11434/v1',                        defaultModel: 'qwen2.5:7b' },
  lmstudio:   { label: 'LM Studio (本地)',    baseUrl: 'http://localhost:1234/v1',                         defaultModel: 'default' },
  llamacpp:   { label: 'llama.cpp (本地)',     baseUrl: 'http://localhost:8080/v1',                         defaultModel: 'default' },
};

// ─── Types for API ───────────────────────────────────────────────

export interface AiTaskStep {
  description: string;
  command: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionChoice {
  message: { content: string };
}

interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
}

const SYSTEM_PROMPT = `你是一位专业的 Linux/macOS/Windows 运维专家，用户会用自然语言描述他们想要完成的操作任务。
你的职责是将用户的自然语言描述转换为可以在终端中执行的 Shell 命令序列。

输出规则：
1. 返回一个 JSON 数组，每个元素包含 "description"（中文描述）和 "command"（Shell 命令）。
2. 命令应该是可以直接执行的完整命令，不要使用占位符。
3. 如果任务需要多个步骤，按照执行顺序排列。
4. 只返回 JSON 数组，不要包含任何其他文字、解释或 Markdown 标记。
5. 如果用户的描述不明确或无法转换为命令，返回空数组 []。

示例输入: "查看当前目录下最大的5个文件"
示例输出: [{"description":"按文件大小排序并显示前5个","command":"du -sh * | sort -rh | head -5"}]

示例输入: "创建一个名为 myapp 的 Node.js 项目并安装 express"
示例输出: [{"description":"创建项目目录","command":"mkdir myapp"},{"description":"进入项目目录","command":"cd myapp"},{"description":"初始化 Node.js 项目","command":"npm init -y"},{"description":"安装 express","command":"npm install express"}]`;

// ─── API client (via Rust proxy — no CORS) ───────────────────────

async function chatCompletion(
  provider: AiProviderConfig,
  messages: ChatMessage[],
  _signal?: AbortSignal,
): Promise<string> {
  // Route through Tauri backend proxy to bypass browser CORS.
  // The Rust side makes the actual HTTP call via reqwest.
  const { invoke } = await import('@tauri-apps/api/core');

  const resp: { status: number; body: string; ok: boolean } = await invoke(
    'ai_proxy_request',
    {
      req: {
        base_url: provider.baseUrl,
        api_key: provider.apiKey,
        model: provider.model,
        max_tokens: provider.maxTokens,
        temperature: provider.temperature,
        messages,
      },
    },
  );

  if (!resp.ok) {
    throw new Error(`AI API error ${resp.status}: ${resp.body.slice(0, 200)}`);
  }

  const data: ChatCompletionResponse = JSON.parse(resp.body);
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI returned empty response');
  }
  return content;
}

// ─── Public API ──────────────────────────────────────────────────

export async function nlToTasks(
  config: AiConfig,
  query: string,
  signal?: AbortSignal,
  /** Pre-assembled messages (from memory system). If provided, skips default system prompt. */
  preMessages?: ChatMessage[],
): Promise<AiTaskStep[]> {
  const provider = resolveProvider(config);
  const messages: ChatMessage[] = preMessages && preMessages.length > 0
    ? preMessages
    : [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ];
  const raw = await chatCompletion(provider, messages, signal);

  // ── Try JSON array first (expected format) ──
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const steps = parsed.map((item: { description?: string; command?: string }) => ({
          description: String(item.description ?? ''),
          command: String(item.command ?? ''),
        })).filter((step) => step.command.length > 0);
        if (steps.length > 0) return steps;
      }
    } catch { /* fall through to code-block extraction */ }
  }

  // ── Fallback: extract commands from code blocks ──
  const codeBlockRe = /```(?:bash|sh|shell|zsh|cmd|powershell|ps1)?\s*\n([\s\S]*?)```/g;
  const codeCommands: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = codeBlockRe.exec(raw)) !== null) {
    for (const line of m[1].split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        codeCommands.push(trimmed);
      }
    }
  }
  if (codeCommands.length > 0) {
    return codeCommands.map((cmd, i) => ({
      description: `Step ${i + 1}`,
      command: cmd,
    }));
  }

  // ── Fallback: extract lines prefixed with $ or > ──
  const promptRe = /^[\s]*[$>]\s+(.+)$/gm;
  const promptCommands: string[] = [];
  while ((m = promptRe.exec(raw)) !== null) {
    const cmd = m[1].trim();
    if (cmd && !cmd.startsWith('#') && !cmd.startsWith('//')) {
      promptCommands.push(cmd);
    }
  }
  if (promptCommands.length > 0) {
    return promptCommands.map((cmd, i) => ({
      description: `Step ${i + 1}`,
      command: cmd,
    }));
  }

  // ── Last resort: treat every non-empty, non-comment line as a command ──
  const lines = raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('```'));
  const shellLike = lines.filter((l) =>
    /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\s/.test(l) || /^(\.\/|\/|[a-zA-Z]:\\)/.test(l),
  );
  if (shellLike.length > 0) {
    return shellLike.map((cmd, i) => ({
      description: `Step ${i + 1}`,
      command: cmd,
    }));
  }

  throw new Error(`AI response contains no executable commands: ${raw.slice(0, 200)}`);
}

export async function testConnection(config: AiConfig): Promise<string> {
  const provider = resolveProvider(config);
  const content = await chatCompletion(provider, [
    { role: 'user', content: 'Reply "ok" if you can read this.' },
  ]);
  return content;
}
