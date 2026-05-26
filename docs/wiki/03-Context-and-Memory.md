# 03 — 上下文注入与记忆系统

## 功能职责

上下文注入系统负责在每次 LLM 调用前自动组装完整的 System Prompt。它将项目级规范（AGENTS.md）、跨会话进度（PROGRESS.md）和个人偏好（Long-Term Memory）注入到 Prompt 中，确保 AI 在"懂规矩、知进度、有记忆"的状态下工作。

三层记忆架构：
- **项目级**：AGENTS.md（全局规范，所有会话共享）
- **会话级**：Short-Term Memory（滑动窗口，最近 10 轮对话）
- **持久化**：Long-Term Memory（最多 200 条偏好/知识） + PROGRESS.md（任务进度）

## 核心数据结构

### Memory 模型 ([memoryService.ts:1-37](../src/lib/memoryService.ts))

```typescript
interface ShortTermEntry {
  role: MemoryRole;   // 'system' | 'user' | 'assistant'
  content: string;
  ts: number;
}

interface LongTermEntry {
  id: string;
  category: 'preference' | 'knowledge' | 'command' | 'error_fix';
  content: string;
  ts: number;
}

interface MemorySnapshot {
  shortTerm: ShortTermEntry[];
  longTerm: LongTermEntry[];
  agentMd: string;    // 会话级 AGENT.md（不同于项目根目录 AGENTS.md）
}
```

### Context Injection 结果 ([types.ts:82-90](../src/lib/harness/types.ts))

```typescript
interface InjectResult {
  systemPrompt: string;        // 完整的 System Prompt
  messages: ChatMessage[];     // 可直接传给 LLM API 的消息数组
  verifyCommands: string[];    // 从 AGENTS.md 提取的验收命令
  resumeMode: boolean;         // 是否为恢复模式（有 PROGRESS.md）
}
```

## 代码逻辑框架

### System Prompt 组装 ([contextInjector.ts:85-140](../src/lib/harness/contextInjector.ts))

```
buildInjection(sessionId, userInput, preMessages?)
  │
  ├─ 1. readAgentsMd()
  │     ├─ 检查内存缓存（5分钟 TTL）
  │     ├─ 调用 invoke('read_agents_md') 读取项目根目录 AGENTS.md
  │     └─ 不存在 → 返回 DEFAULT_AGENTS_MD 模板
  │
  ├─ 2. 组装 System Prompt 部件
  │     parts = [
  │       AGENTS.md 内容,          ← 项目规范
  │       '---',
  │       BASE_SYSTEM_PROMPT,       ← NL→commands 行为规则
  │     ]
  │
  ├─ 3. progressWriter.load(sessionId)
  │     └─ 存在进行中任务 → 注入恢复上下文
  │     parts += [
  │       '---',
  │       '## 正在继续之前的任务',
  │       `任务: ${taskDescription}`,
  │       '已完成步骤:', ...,
  │       `当前步骤: ${currentStep}`,
  │       '待完成:', ...,
  │     ]
  │
  ├─ 4. extractVerifyCommands(agentsMd)
  │     └─ 正则解析 AGENTS.md 中 ## 验收命令 区块的 ```bash``` 代码块
  │
  └─ 5. 返回 { systemPrompt, messages, verifyCommands, resumeMode }
```

### 验收命令提取 ([contextInjector.ts:53-78](../src/lib/harness/contextInjector.ts))

从 AGENTS.md 中提取两种格式的验收命令：
1. `## 验收命令` 标题下的 `` ```bash ``` `` 代码块（去注释空行）
2. `verify:` 或 `验收命令:` 前缀的内联格式

结果自动去重（`new Set()`）。

### 记忆持久化 (memoryService.ts)

```
loadMemory(sessionId) → MemorySnapshot
  ├─ 读取 memory_short.json → ShortTermEntry[]
  ├─ 读取 memory_long.json → LongTermEntry[]
  └─ 读取 AGENT.md → string (会话级)

appendShortTerm(sessionId, entries)
  └─ load → push → trim (滑动窗口: 10轮 / 4000 tokens) → write

updateLongTerm(sessionId, entries)
  └─ load → 精确去重 → push → trim (最多200条) → write

assemblePrompt(sessionId, userInput)
  └─ { system: AGENT.md + LongTerm, messages: ShortTerm + [userInput] }
```

**Token 估算**：`Math.ceil(text.replace(/\s/g, '').length / 2.5)`，粗略估算中英文混合文本的 token 数。

**Rust 后端命令**：
- `read_memory_file(sessionId, filename)` — 读取 `{workspace}/sessions/{id}/{filename}`
- `write_memory_file(sessionId, filename, content)` — 写入，自动创建目录

## 扩展点与约束

### 如何自定义 AGENTS.md

在项目根目录编辑 `AGENTS.md`，Harness 系统在最多 5 分钟内自动感知变更（通过 `invalidateAgentsCache()` 可强制刷新）。格式自由，但 `## 验收命令` 区块会被自动解析。

### 如何新增记忆类别

在 `LongTermEntry.category` 联合类型中添加新值，然后在 `updateLongTerm()` 调用时使用新类别。

### 约束

- **缓存策略**：AGENTS.md 缓存 5 分钟。如需实时更新，调用 `invalidateAgentsCache()`。
- **Token 预算**：Short-Term Memory 限制为 10 轮或 4000 tokens。超过阈值的旧条目直接移除，不生成摘要。
- **PROGRESS.md 恢复**：仅当文件状态为"进行中"时触发恢复模式。
- **会话级 vs 项目级 AGENTS.md**：会话级（[memoryService.ts 中的 `agentMd`](../src/lib/memoryService.ts)）存于 `sessions/{id}/AGENT.md`；项目级存于根目录 `AGENTS.md`。前者由用户手动管理，后者由团队统一维护。
