# 11 — Layout 主布局与全局状态

## 功能职责

`Layout.tsx` 是应用的主布局组件，负责：
- 组装 TitleBar、Sidebar、TerminalPanel、EditorPanel、SftpPanel、OutputPanel、BottomInputArea、StatusBar 的 DOM 层级
- 管理全局状态 Hook 的调用和 props 分发
- 渲染全局 Modal（Settings、SessionType、TerminalConnect、SessionManager、LogViewer、ServerManagement）
- 渲染 Harness ConfirmDialog

## Store 依赖架构图

```mermaid
graph TB
    subgraph "配置层 (Config)"
        SETTINGS[settingsStore<br/>AppSettings]
    end

    subgraph "运行时层 (Runtime)"
        SESSION[sessionStore<br/>sessions: Map<br/>activeSessionId]
        UI[uiStore<br/>sidebarTab<br/>sessionView]
        OUTPUT[outputStore<br/>output: string<br/>status]
    end

    subgraph "持久化层 (Persistence)"
        CONN[connectionStore<br/>savedConnections<br/>groups]
        LOG[sessionLogStore<br/>logs: Record]
        TASK[taskStore<br/>groups: TaskGroup[]]
        EDITOR[editorStore<br/>tabs: EditorTab[]]
        SFTP[sftpStore<br/>currentPath<br/>files]
    end

    subgraph "任务/工具层 (Task/Tool)"
        TBLOCK[taskBlockStore<br/>taskBlocks]
        MTASK[manualTaskStore<br/>manualTasks]
        CMD[commandStore<br/>@deprecated]
    end

    SETTINGS -.->|harness config| SESSION
    SETTINGS -.->|ai config| OUTPUT
    SETTINGS -.->|logging config| LOG

    SESSION -->|activeSessionId| UI
    SESSION -->|terminals[]| LOG
    SESSION -->|sessionId| TASK
    SESSION -->|sessionId| SFTP

    TASK -->|createGroup| UI

    CONN -.->|buildTree| SESSION
```

## 核心组件树

```
Layout
├── TitleBar              ← 标题栏（窗口拖拽 + 按钮组）
├── div.flex-1.overflow-hidden
│   ├── Sidebar           ← 左侧边栏（会话树 + 任务面板）
│   └── main.flex-1
│       ├── TerminalTabBar← 终端 Tab 栏
│       ├── UnifiedSessionPanel ← ★核心：终端/Blocks 面板
│       ├── EditorPanel   ← Monaco 编辑器（右侧抽屉）
│       ├── SftpPanel     ← SFTP 文件管理（右侧抽屉）
│       ├── OutputPanel   ← AI 输出面板（底部）
│       ├── BottomInputArea← 命令输入栏（底部）
│       └── StatusBar     ← 状态栏（底部）
│
├── SettingsModal         ← 全局设置
├── SessionTypeModal      ← 新建会话
├── TerminalConnectModal  ← 新建终端连接
├── SessionManager        ← 会话管理器
├── LogViewer             ← 日志查看器
├── ServerManagementModal ← 服务器管理
└── ConfirmDialog         ← Harness 权限确认
```

## 全局状态分布

### 12 个 Zustand Store

| Store | 文件 | 核心状态 | 消费组件 |
|-------|------|---------|---------|
| `sessionStore` | [sessionStore.ts](../src/stores/sessionStore.ts) | sessions: Map, activeSessionId | Layout, TerminalPanel, Sidebar |
| `uiStore` | [uiStore.ts](../src/stores/uiStore.ts) | sidebarTab, sessionView | Sidebar, Layout |
| `settingsStore` | [settingsStore.ts](../src/stores/settingsStore.ts) | settings: AppSettings | SettingsModal, StatusBar |
| `connectionStore` | [connectionStore.ts](../src/stores/connectionStore.ts) | savedConnections, groups | SessionManager, TerminalConnectModal |
| `taskStore` | [taskStore.ts](../src/stores/taskStore.ts) | groups: TaskGroup[] | TaskBoard, useTaskQueue |
| `outputStore` | [outputStore.ts](../src/stores/outputStore.ts) | output: string, status | OutputPanel, useAiSubmit |
| `sessionLogStore` | [sessionLogStore.ts](../src/stores/sessionLogStore.ts) | logs: Record<string, SessionEvent[]> | BlocksPanel, SessionManager |
| `sftpStore` | [sftpStore.ts](../src/stores/sftpStore.ts) | currentPath, files: FileEntry[] | SftpPanel |
| `editorStore` | [editorStore.ts](../src/stores/editorStore.ts) | tabs: EditorTab[] | EditorPanel |
| `commandStore` | [commandStore.ts](../src/stores/commandStore.ts) | (deprecated) | 旧 Blocks 组件 |
| `taskBlockStore` | [taskBlockStore.ts](../src/stores/taskBlockStore.ts) | taskBlocks | TaskBlockOverlay |
| `manualTaskStore` | [manualTaskStore.ts](../src/stores/manualTaskStore.ts) | manualTasks | TaskBoard |

## Hook 调用清单 ([Layout.tsx:60-64](../src/components/Layout.tsx))

```typescript
const { executeCommand, isExecuting } = useBlockSession({ sessionId });
const { submitAiQuery, cancelAiQuery, isLoading, error, clearAiError, confirmDialog }
  = useAiSubmit({ sessionId });
useTaskQueue({ sessionId });  // 自动执行待处理的任务队列
```

## 扩展点与约束

### 约束

- **12 个独立 Store**：每个 Store 通过 `create()` 独立创建，互相之间通过 `getState()` 读取，不通过 Provider 树传递
- **Zustand 订阅**：组件通过 selector 函数订阅特定状态切片，避免不必要的重渲染
- **持久化时机**：连接配置每次 CRUD 后立即持久化；会话日志 16KB/200ms 缓冲批量写到 NDJSON 文件
- **StrictMode 防护**：所有 Effect 使用 `cancelled` flag + cleanup 函数防止双重挂载
