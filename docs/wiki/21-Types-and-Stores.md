# 21 — 类型定义与状态管理

## TypeScript 类型全景

### 连接模型 ([connection.ts](../src/models/connection.ts))

```typescript
type ConnectionConfig =
  | { protocol: 'ssh', host, port, username, password }
  | { protocol: 'telnet', host, port }
  | { protocol: 'serial', portName, baudRate, dataBits, stopBits, parity }
  | { protocol: 'local', shell, cwd? }

type TreeNode = { key, title, children?: TreeNode[], isLeaf, data? }
```

支持函数：`connectionLabel()`（人类可读的连接描述）、`connectionShortLabel()`（Tab 短名称）、`buildTree()`（扁平列表→树形结构）。

### 会话模型 ([sessionData.ts](../src/models/sessionData.ts))

```typescript
type SessionEventType = 'input' | 'output' | 'command-start' | 'command-end' | 'system';

interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  data: unknown;
  ts: number;
}
```

### 任务模型 ([task.ts](../src/models/task.ts))

```typescript
interface TaskGroup {
  id: string;
  query: string;          // 用户原始自然语言
  steps: AiTaskStep[];    // LLM 返回的命令步骤
  status: TaskStatus;     // 'pending' | 'running' | 'done' | 'error'
  createdAt: number;
}

interface AiTaskStep {
  description: string;
  command: string;
}
```

### 终端模型 ([terminal.ts](../src/models/terminal.ts))

```typescript
interface TerminalConfig {
  fontSize: number;
  fontFamily: string;
  scrollback: number;
  autoFit: boolean;
  defaultColumns: number;
  defaultRows: number;
}
```

### Block 模型 ([block.ts](../src/models/block.ts))

```typescript
interface CommandBlock {
  id: string;
  command: string;
  output: string;
  status: 'running' | 'success' | 'error';
  exitCode?: number;
}
```

### 编辑器模型 ([editor.ts](../src/models/editor.ts))

```typescript
interface EditorTab {
  id: string;
  path: string;           // 文件路径（本地或远程）
  content: string;
  language: string;       // Monaco language ID
  isDirty: boolean;       // 是否有未保存更改
}
```

## Zustand Store 全景图

### Store 依赖图

```
                    ┌─────────────┐
                    │ settingsStore│ ← HarnessConfig, AiConfig, Terminal
                    └──────┬──────┘
                           │ 消费
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                  ▼
  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
  │sessionStore  │   │   uiStore   │   │ outputStore │
  │(运行时状态)   │   │(UI 控制)    │   │(AI 输出流)  │
  └──────┬──────┘   └─────────────┘   └─────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐ ┌──────────────┐
│taskStore│ │sessionLogStore│
│(任务队列)│ │(会话日志)     │
└─────────┘ └──────────────┘

  独立 Store (无直接依赖):
  ┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
  │ connectionStore  │ │ editorStore │ │  sftpStore  │
  │ (连接配置+分组)   │ │ (编辑器Tab) │ │ (SFTP 状态) │
  └─────────────────┘ └─────────────┘ └─────────────┘
  ┌─────────────┐ ┌────────────────┐ ┌─────────────────┐
  │commandStore  │ │ taskBlockStore │ │manualTaskStore  │
  │ (@deprecated)│ │ (任务块覆盖层) │ │ (手动任务)       │
  └─────────────┘ └────────────────┘ └─────────────────┘
```

### Store 实现模式

所有 Store 遵循统一的 Zustand 模式：

```typescript
export const useXxxStore = create<XxxState>()((set, get) => ({
  // state
  data: initialValue,

  // actions
  updateData: (patch) => set((state) => ({ ...state, ...patch })),
  resetData: () => set({ data: initialValue }),
}));
```

**关键原则**：
- 不可变更新：所有 action 使用 `set(state => ({...state, ...}))`
- Selector 优化：组件使用选择器订阅特定字段，避免不必要的重渲染
- 跨 Store 读取：通过 `useXxxStore.getState()` 在非 React 上下文中读取状态

### 持久化映射

| Store | 持久化方式 | 触发时机 |
|-------|----------|---------|
| `connectionStore` | `save_connections()` → Rust | 每次 CRUD 后立即 |
| `sessionLogStore` | `append_timeline_batch()` → Rust | 16KB/200ms 缓冲批量 |
| `settingsStore` | `save_settings()` → Rust + localStorage | debounce 500ms |
| `editorStore` | `save_session_editor()` → Rust | 编辑器 Tab 变化时 |
| `sessionStore` | `save_session_meta()` → Rust | 会话元信息变更时 |
