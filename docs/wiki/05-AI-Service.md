# 05 — AI 服务客户端

## 功能职责

AI 服务客户端封装了与 OpenAI 兼容 API 的通信逻辑，提供自然语言到命令序列的转换能力。支持多服务商切换（DashScope、Ark、GLM、OpenAI、Ollama 等），通过 Rust 后端代理绕过浏览器 CORS 限制。

## 核心数据结构

### 服务商配置 ([aiService.ts:8-16](../src/lib/aiService.ts))

```typescript
interface AiProviderConfig {
  id: string;           // 唯一标识（如 'provider-1'）
  name: string;         // 显示名称（如 '百炼 (DashScope)'）
  baseUrl: string;      // API 端点（如 'https://dashscope.aliyuncs.com/compatible-mode/v1'）
  apiKey: string;
  model: string;        // 模型名（如 'qwen-turbo'）
  maxTokens: number;    // 默认 2048
  temperature: number;  // 默认 0.3
}

interface AiConfig {
  currentProviderId: string;
  providers: AiProviderConfig[];
}
```

### 预设服务商 ([aiService.ts:63-73](../src/lib/aiService.ts))

| Preset Key | 显示名 | Base URL | 默认模型 |
|------------|--------|----------|---------|
| `dashscope` | 百炼 (DashScope) | `dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` |
| `ark` | 火山方舟 (Ark) | `ark.cn-beijing.volces.com/api/v3` | `doubao-pro-32k` |
| `zhipu` | 智谱 (GLM) | `open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| `minimax` | MiniMax | `api.minimax.chat/v1` | `abab6.5s-chat` |
| `moonshot` | Kimi (Moonshot) | `api.moonshot.cn/v1` | `moonshot-v1-8k` |
| `openai` | OpenAI | `api.openai.com/v1` | `gpt-4o-mini` |
| `ollama` | Ollama (本地) | `localhost:11434/v1` | `qwen2.5:7b` |
| `lmstudio` | LM Studio (本地) | `localhost:1234/v1` | `default` |
| `llamacpp` | llama.cpp (本地) | `localhost:8080/v1` | `default` |

### Rust 代理类型 ([ai_proxy.rs:1-29](../src-tauri/src/ai_proxy.rs))

```rust
struct ProxyRequest {
    base_url: String,
    api_key: String,
    model: String,
    max_tokens: u32,
    temperature: f32,
    messages: Vec<ChatMessage>,
}

struct ProxyResponse {
    status: u16,
    body: String,
    ok: bool,
}
```

## 代码逻辑框架

### 调用链路

```
nlToTasks(config, query, signal?, preMessages?)
  │
  ├─ 1. resolveProvider(config) → 获取当前激活的服务商
  │
  ├─ 2. 组装 messages
  │     ├─ preMessages 存在 → 直接使用（来自 Harness Context Injector）
  │     └─ preMessages 不存在 → 使用默认 SYSTEM_PROMPT + user query
  │
  ├─ 3. chatCompletion(provider, messages, signal)
  │     └─ invoke('ai_proxy_request', { req })  ← Tauri IPC
  │         └─ Rust: ai_proxy_request() [ai_proxy.rs:34-73]
  │             └─ POST {baseUrl}/chat/completions
  │                 │  headers: { Authorization: Bearer {apiKey} }
  │                 │  body: { model, messages, max_tokens, temperature }
  │                 └─ 返回 { status, body, ok }
  │
  └─ 4. 解析响应
        ├─ JSON 数组 (期望格式) → AiTaskStep[]
        ├─ Markdown 代码块 ↓ → 提取 bash/sh/shell 命令
        ├─ $ / > 前缀行 → 提取命令
        └─ Shell-like 行 → 最后回退
```

### 响应解析的 4 层回退 ([aiService.ts:250-318](../src/lib/aiService.ts))

```
1. JSON 数组: raw.match(/\[[\s\S]*\]/) → JSON.parse → AiTaskStep[]
   ↓ 失败
2. 代码块: raw.match(/```(?:bash|sh|shell|zsh|cmd|powershell)\s*\n([\s\S]*?)```/g)
   → 逐行提取（过滤 # 和 // 注释）
   ↓ 失败
3. 提示符行: raw.match(/^[\s]*[$>]\s+(.+)$/gm)
   → 提取 $ 或 > 后的命令
   ↓ 失败
4. Shell-like 行: 逐行匹配 /^[a-zA-Z0-9_]+\s/ 或路径模式
   → 最后回退
```

### TERMINAL_CREATE 动作解析 ([aiService.ts:202-237](../src/lib/aiService.ts))

独立于 `nlToTasks` 的 `nlToAction` 函数，检测 LLM 是否返回终端创建意图：

```typescript
interface TerminalActionResponse {
  type: 'TERMINAL_CREATE';
  payload: {
    protocol: 'ssh' | 'telnet' | 'serial';
    host: string;
    port: number;
    username?: string;
    password?: string;
    portName?: string;     // serial only
    baudRate?: number;     // serial only
  };
}
```

## 扩展点与约束

### 如何新增服务商

在 [aiService.ts:63-73](../src/lib/aiService.ts) 的 `AI_PRESETS` 中添加条目，或在 SettingsModal UI 中手动配置自定义 URL。

### 约束

- **单轮调用**：`nlToTasks` 是单次 HTTP 请求，不支持 streaming / SSE
- **无重试机制**：网络错误直接抛异常，调用方（harnessPipeline）负责重试
- **Term Markdown 代码块提取**：仅支持 8 种语言标签（bash/sh/shell/zsh/cmd/powershell/ps1），不支持无标签代码块
- **Rust 代理**：`reqwest` 不信任自签名证书；使用 HTTPS 的服务商需有效证书
