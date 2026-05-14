# 灵枢智能终端 3.0 — 统一会话与智能代理架构设计

**文档版本：** v3.0
**最后更新：** 2026-05-10
**文档用途：** 作为后续 AI 辅助开发的系统提示词 / 知识库基准

---

## 1. 项目概览

### 1.1 核心定位

灵枢智能终端 3.0（LingshuTerm 3.0）是一款基于 **Tauri v2** 的跨平台智能终端工具，在 2.0 基础上进行架构升级，核心变革为：

- **统一会话日志模型**：以 `SessionEvent` 时间线为唯一数据源，消除 Terminal 模式与 Blocks 模式的双系统割裂
- **统一渲染面板**：`UnifiedSessionPanel` 取代独立的 `TerminalPanel` / `BlocksPanel`，通过 `ViewSwitcher` 在 Terminal / Blocks / Split 三种渲染视图间切换
- **AI 智能代理 (AI Agent)**：悬浮宠物交互、自然语言意图识别、会话级智能体、长短期记忆、危险操作授权、定时任务调度
- **多协议远程连接**：SSH（纯 Rust 实现 via russh）、Telnet、串口（Serial）
- **本地 PTY**：基于 `portable-pty` 的跨平台伪终端
- **代码编辑器**：集成 Monaco Editor，支持多 Tab 虚拟工作区
- **会话管理器**：树形目录分组、HTML5 拖拽排序、右键菜单、加密持久化
- **终端日志审计**：实时记录终端输入输出、自动轮转（10MB）、文件树查看器
- **集成服务器管理**：一键启停 TFTP/FTP/HTTP/SSH 等网络服务、端口检测、进程守护

### 1.2 技术栈清单

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **桌面框架** | Tauri | v2 | 跨平台桌面容器、系统调用 |
| **前端框架** | React | 19.1 | UI 组件渲染 |
| **状态管理** | Zustand | 5.0 | 全局状态（8 个 Store） |
| **终端渲染** | xterm.js | 5.5 | 终端模拟 + FitAddon + WebglAddon |
| **代码编辑器** | Monaco Editor | 0.55 | 代码编辑视图 |
| **图标库** | Lucide React | 0.400 | 矢量图标 |
| **Markdown** | react-markdown + remark-gfm | 9.1 / 4.0 | Blocks 输出渲染 |
| **语法高亮** | Shiki | 4.0 | 代码块着色 |
| **图表** | Mermaid | 11.14 | 流程图渲染 |
| **CSS 框架** | Tailwind CSS | 3.4 | 原子化样式（自定义深色主题） |
| **后端语言** | Rust (Edition 2021) | - | PTY 管理、网络连接、持久化、AI Agent |
| **PTY 库** | portable-pty | 0.8 | 跨平台伪终端 |
| **SSH 库** | russh (ring 后端) | 0.60 | 纯 Rust SSH 客户端 |
| **串口** | serialport | 4.3 | COM 端口通信 |
| **加密** | ring | 0.17 | AES-256-GCM 密码存储 |
| **异步运行时** | Tokio | 1 | Rust 异步任务调度 |
| **序列化** | serde + serde_json | 1 | Rust ↔ JSON 互转 |
| **向量数据库** | rusqlite | 0.31 | AI Agent 长期记忆存储（3.0 新增） |
| **HTTP 客户端** | reqwest | 0.12 | 调用 OpenAI 兼容 API（3.0 新增） |
| **正则** | regex | 1 | 输出清洗 / 协议扫描 |
| **构建工具** | Vite | 7.0 | 前端构建 & HMR |
| **测试框架** | Vitest | 4.1 | 单元测试 (jsdom) |
| **类型检查** | TypeScript | 5.8 | 严格模式类型检查 |
| **测试工具** | Testing Library | 16.3 | React 组件测试 |

---

## 2. 目录结构深度解析

整体结构在 2.0 基础上进行重大调整，核心变化：新增 `sessionLogStore` 替代 `commandStore`、新增 `UnifiedSessionPanel` 组件簇、新增 `agent/` 模块、新增 `stream/` Rust 模块。

```
LingshuTerm3.0/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── vitest.config.ts
│
├── src/                        # ── 前端源代码 ──
│   ├── main.tsx                # React 入口（StrictMode 包裹）
│   ├── App.tsx                 # 根组件（仅渲染 <Layout/>）
│   ├── index.css               # 全局样式（字体导入、滚动条、xterm 覆盖）
│   │
│   ├── models/                 # 数据模型层 — 纯 TypeScript 类型定义
│   │   ├── connection.ts       # 连接协议类型（SSH/Telnet/Serial/Local + TreeNode + StoragePayload）
│   │   ├── session.ts          # 会话元信息（SessionInfo + SessionStatus）
│   │   ├── sessionData.ts      # ★重构: SessionView 替代 SessionMode, SessionEvent 时间线模型
│   │   ├── terminal.ts         # 终端配置与事件荷载
│   │   ├── block.ts            # 命令块模型（保留兼容，新代码不再使用）
│   │   ├── task.ts             # AI 任务模型（nlToTasks → TaskGroup → TaskItem）
│   │   ├── editor.ts           # 编辑器模型
│   │   ├── agent.ts            # ★新增: AI Agent 消息、授权、任务模型
│   │   ├── logger.ts            # ★新增: 日志服务模型
│   │   └── __tests__/
│   │
│   ├── stores/                 # 状态管理层 — Zustand Store（8 个）
│   │   ├── connectionStore.ts  # 连接配置 CRUD + 分组管理
│   │   ├── sessionStore.ts     # 运行时 Session 注册表
│   │   ├── sessionLogStore.ts  # ★新增: 统一会话日志 — SessionEvent[] 替代 commandStore
│   │   ├── uiStore.ts          # UI 状态（sidebar 折叠 / SessionView / 模态框）
│   │   ├── settingsStore.ts    # 用户设置（终端字体/shell/AI 配置，localStorage 持久化）
│   │   ├── commandStore.ts     # 保留兼容旧代码，标记 @deprecated
│   │   ├── taskStore.ts        # AI 任务队列（nlToTasks）
│   │   ├── agentStore.ts       # ★新增: AI Agent 状态（对话、授权、宠物状态）
│   │   └── __tests__/
│   │
│   ├── hooks/                  # 自定义 Hooks
│   │   ├── useTerminal.ts      # xterm.js 生命周期管理
│   │   ├── useEditor.ts        # Monaco Editor 生命周期管理
│   │   ├── useBlockSession.ts  # 保留兼容旧 Blocks，标记 @deprecated
│   │   ├── useTaskQueue.ts     # AI 任务顺序执行引擎
│   │   ├── useAiSubmit.ts      # AI 自然语言提交（NL→Tasks）
│   │   ├── useSession.ts       # 聚合 Hook：组装只读 Session 视图
│   │   ├── useSessionStream.ts # ★新增: 统一会话流处理 Hook（pti-output→SessionEvent→Store）
│   │   ├── useDraggable.ts     # ★新增: 通用拖拽 Hook（用于悬浮宠物）
│   │   ├── useTerminalResize.ts# 终端容器尺寸监听
│   │   └── usePersistenceBootstrap.ts # 启动持久化恢复 + 运行时订阅
│   │
│   ├── lib/                    # 工具库
│   │   ├── sessionUtils.ts     # Session ID 前缀路由（getWriteCommand/getResizeCommand）
│   │   ├── connectionService.ts# 连接命令薄封装
│   │   ├── sessionService.ts   # 统一会话创建入口（create_session）
│   │   ├── aiService.ts        # OpenAI 兼容 API 客户端（nlToTasks / testConnection）
│   │   ├── aiDetect.ts         # 输入检测（自然语言 vs Shell 命令）
│   │   ├── persistenceSubscribe.ts # 四路 Store 订阅 → Rust 持久化（★重构适配 sessionLogStore）
│   │   ├── persistenceService.ts   # 持久化薄封装（load/save/append/session export）
│   │   ├── loggerService.ts        # ★新增: 日志服务（write/list/read/openInExplorer）
│   │   ├── monaco.ts           # Monaco Editor 工厂函数
│   │   ├── ansi.ts             # ANSI 转义序列解析（stripControl / parseAnsiToSegments）
│   │   ├── xterm.ts            # xterm.js 主题配置（独立工厂函数）
│   │   ├── outputDetector.ts   # 输出内容检测器（df/ps/git/du/JSON 特征识别）
│   │   ├── outputDispatch.ts   # 命令输出调度器（command + text → OutputKind）
│   │   └── fileParser.ts       # ls -al 长格式解析器
│   │
│   ├── components/             # UI 组件层
│   │   ├── Layout.tsx          # 主布局（集成 FloatingPet 和 AgentPanel）
│   │   ├── TitleBar.tsx        # 标题栏
│   │   ├── Sidebar.tsx         # 侧边栏（会话列表 + 任务列表）
│   │   ├── UnifiedSessionPanel.tsx # ★核心: 统一终端面板（Chunked Stream）
│   │   │   ├── TerminalRenderer.tsx # 终端渲染器（xterm.js）
│   │   ├── TerminalTabBar.tsx  # ★终端 Tab 栏（含日志录制开关）
│   │   ├── TerminalConnectModal.tsx # ★新建终端连接配置弹窗
│   │   ├── EditorPanel.tsx     # 编辑器面板
│   │   ├── LogViewer.tsx       # ★新增: 日志文件查看器
│   │   ├── CommandInput.tsx    # 底部命令输入栏（内联 AI 检测 + 历史记录 + Ctrl+C）
│   │   ├── BottomInputArea.tsx # 底部输入区路由
│   │   ├── TaskBoard.tsx       # AI 任务看板
│   │   ├── StatusBar.tsx       # 状态栏
│   │   ├── SettingsModal.tsx   # 设置面板（终端/AI/Shell/日志 配置）
│   │   ├── SessionTypeModal.tsx# 新建会话模态框（仅名称）
│   │   ├── SessionManager.tsx  # 会话管理器（session.json 树形结构）
│   │   ├── ContextMenu.tsx     # 通用右键菜单组件
│   │   ├── FloatingPet.tsx     # ★新增: AI Agent 悬浮宠物
│   │   ├── AgentPanel.tsx      # ★新增: AI Agent 对话面板
│   │   └── output/             # 结构化输出渲染器
│   │       ├── OutputRenderer.tsx      # 输出调度入口
│   │       ├── AnsiText.tsx           # ANSI SGR 彩色文本片段
│   │       ├── CodeBlock.tsx          # Shiki 语法高亮代码块
│   │       ├── MarkdownRenderer.tsx   # Markdown 渲染
│   │       ├── MermaidDiagram.tsx     # Mermaid 流程图
│   │       ├── JsonViewer.tsx         # JSON 树形查看
│   │       ├── DiskUsageCard.tsx      # df -h 可视化
│   │       ├── ProcessTable.tsx       # ps aux 进程表
│   │       ├── GitStatus.tsx          # git status 可视化
│   │       ├── DirectoryChart.tsx     # du -sh 目录大小图
│   │       ├── FileListTable.tsx      # ls -al 长格式表格
│   │       └── FileGrid.tsx           # ls 短格式文件网格
│   │
│   ├── assets/                 # 静态资源
│   └── test/                   # 测试基础设施
│       └── setup.ts            # Vitest 全局设置（jsdom + testing-library）
│
└── src-tauri/                  # ── Rust 后端源代码 ──
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── build.rs
    │
    └── src/
        ├── main.rs             # 应用入口（tracing 初始化 + 状态注入 + 命令注册）
        ├── lib.rs              # 模块声明
        │
        ├── shell.rs            # PtyManager — 本地 PTY 生命周期（创建/写/调大小/销毁）
        ├── connection.rs       # ConnectionManager — 远程连接（SSH/Telnet/Serial）
        ├── session_commands.rs # 统一会话创建入口（create_session 分发 Local↔Remote）
        │
        ├── commands.rs         # Tauri 命令（write/resize/destroy/execute_block_command）
        ├── connection_commands.rs # 远程连接命令（disconnect/write/resize/list_serial_ports）
        │
        ├── stream/             # ★核心新增: 统一会话流处理模块
        │   ├── mod.rs
        │   ├── core.rs         # UnifiedStreamCore (MarkerScanner + StreamCleaner 合并)
        │   ├── log.rs          # SessionLog 模型 — SessionEvent 序列化与 ndjson 读写
        │   └── event.rs        # SessionEvent 类型定义与 emit 封装
        │
        ├── block.rs            # ★重构: 仅保留 OSC 7701 MarkerScanner，移除 execute_block_command
        ├── output_sanitizer.rs # PTY 输出清洗（Warp/SGR/printf/__ls_rc 噪声过滤）
        ├── stream_cleaner.rs   # OSC 133 状态机 / 行过滤（Blocks 纯输出提取）
        │
        ├── executor.rs         # 抽象执行器 trait（ShellExecutor / ConnectionExecutor）
        ├── storage.rs          # 加密存储（AES-256-GCM 密码加密 + StoragePayload）
        ├── logger.rs           # ★新增: 日志写入/轮转/ANSI清洗/文件系统浏览器
        ├── persistence.rs      # ★重构: 统一 session.json 读写、迁移、密码加密
        ├── utils.rs            # 工具函数（workspace_dir / shell 检测）
        │
        ├── agent/              # ★新增: AI Agent 核心模块
        │   ├── mod.rs
        │   ├── manager.rs      # AgentManager 中央调度器
        │   ├── intent.rs       # IntentRouter 意图路由
        │   ├── config_agent.rs # ConfigAgent 配置管理
        │   ├── session_agent.rs# SessionAgent 会话智能体（每会话一个实例）
        │   ├── memory.rs       # MemoryStore 记忆系统（短期环形缓冲 + 长期 SQLite 向量库）
        │   ├── scheduler.rs    # Scheduler 定时任务引擎
        │   └── llm.rs          # LLM client 封装（OpenAI 兼容 API）
        │
        └── agent_commands.rs   # ★新增: AI Agent Tauri 命令注册

```

---

## 3. 核心数据流与状态管理

### 3.1 Store 全景图

项目使用 **8 个**独立的 Zustand Store（新增 `sessionLogStore` 和 `agentStore`，`commandStore` 标记为 @deprecated）。

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                             Zustand Stores                                    │
├─────────────────┬────────────────┬────────────────┬──────────────────────────┤
│ sessionStore    │ uiStore        │ settingsStore  │ connectionStore          │
│ (运行时会话)     │ (UI 状态)      │ (用户设置)      │ (连接配置+分组)           │
│                 │                │                │                          │
│ sessions:Map    │ activeView     │ settings:      │ savedConnections[]       │
│ activeSession   │ sidebarTab     │   shell        │ groups[]                 │
│ terminals[]     │ sessionModal   │   terminal     │ → buildTree()            │
│ isLogging:bool  │ terminalModal  │   ai           │ → TreeNode[]             │
│                 │                │   logging:     │                          │
│                 │                │     enabled    │                          │
│                 │                │     logPath    │                          │
│                 │                │     maxSizeMb  │                          │
├─────────────────┼────────────────┼────────────────┼──────────────────────────┤
│ sessionLogStore │ taskStore      │ agentStore     │ commandStore (deprecated)│
│ ★核心新增        │ (AI 任务)      │ ★新增          │ 保留兼容旧 Blocks 逻辑    │
│                 │                │                │                          │
│ logs: Record<   │ groups[]       │ messages[]     │ blocks[]                 │
│  sessionId,     │ (TaskGroup)    │ pendingAuths[] │ (CommandBlock)           │
│  SessionEvent[]>│                │ petState       │                          │
└─────────────────┴────────────────┴────────────────┴──────────────────────────┘
```

### 3.2 关键变更：SessionView 与 sessionLogStore

#### SessionMode → SessionView

`SessionMode` (`'terminal' | 'blocks' | 'editor'`) 变为 `SessionView` (`'terminal' | 'blocks' | 'split'`)。Editor 模式保持在独立面板中。`SessionView` 是纯粹的 UI 渲染策略，不影响会话生命周期。

```typescript
// src/models/sessionData.ts (新)
export type SessionView = 'terminal' | 'blocks' | 'split';
```

#### commandStore → sessionLogStore

`commandStore` 被标记为 @deprecated。所有会话的输入、输出、命令开始/结束等事件统一记录在 `sessionLogStore` 中，形成一个不可变的 `SessionEvent[]` 时间线。Blocks 视图是此时间线的一个派生视图。

```typescript
// src/models/sessionData.ts (新)
type SessionEventType =
  | 'input'
  | 'output'
  | 'command-start'
  | 'command-end'
  | 'system';

interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  data: unknown;
  ts: number; // Unix timestamp ms
}

// sessionLogStore 核心 shape
interface SessionLogState {
  logs: Record<string, SessionEvent[]>;
  appendLog: (sessionId: string, event: SessionEvent) => void;
  clearSessionLogs: (sessionId: string) => void;
  hydrate: (sessionId: string, events: SessionEvent[]) => void;
}
```

### 3.3 统一终端数据流（核心路径）

```
┌─────────────────────────────────────────────────────────────┐
│                    Rust 后端                                 │
│                                                             │
│  PTY / SSH 输出流                                            │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────────────┐                                   │
│  │ UnifiedStreamCore    │                                   │
│  │                      │                                   │
│  │ 1. MarkerScanner     │  scan OSC 7701 → block-cmd-*     │
│  │ 2. StreamCleaner     │  OSC 133 状态机 → block-output    │
│  │ 3. sanitize_output() │  清洗噪音 → pty-output             │
│  └──────┬───────────────┘                                   │
│         │                                                   │
│         ▼                                                   │
│  emit events: pty-output / block-output / block-cmd-*       │
│         │                                                   │
└─────────┼───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    前端 useSessionStream                     │
│                                                             │
│  listen('pti-output')   → terminal.write() + persistChunk() │
│  listen('block-output') → sessionLogStore.appendLog()       │
│  listen('block-cmd-*')  → sessionLogStore.appendLog()       │
│         │                                                   │
│         ▼                                                   │
│  sessionLogStore (唯一权威日志源)                             │
│         │                                                   │
│    ┌────┴────┐                                             │
│    ▼         ▼                                              │
│ Terminal    Blocks                                          │
│ Renderer    Renderer                                        │
│ (xterm.js) (deriveCommandGroups)                            │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 AI Agent 数据流

```
┌──────────────────────────────────────────────────────────────┐
│ CommandInput                                                │
│   detectInputType() → shell or AI NL                        │
│         │                                                   │
│    ┌────┴────────┐                                         │
│    ▼              ▼                                          │
│ Shell命令       AI NL查询                                    │
│ 写入PTY         invoke('agent_submit_query')                │
│                     │                                       │
│                     ▼                                       │
│         Rust: AgentManager.handle_user_message()            │
│                     │                                       │
│                     ▼                                       │
│              IntentRouter.quick_route()                      │
│            ┌────────┼──────────┐                            │
│            ▼        ▼          ▼                            │
│        Config    Exec/Chat  Unknown                         │
│        Agent     Agent      → LLM Classification            │
│          │          │              │                         │
│          └──────────┴──────────────┘                        │
│                     │                                       │
│                     ▼                                       │
│              AgentResponse                                  │
│                     │                                       │
│                     ▼                                       │
│         emit('agent-response')                              │
│                     │                                       │
│                     ▼                                       │
│         agentStore.addMessage()                             │
│                     │                                       │
│              ┌──────┴──────┐                                │
│              ▼              ▼                               │
│        AgentPanel    FloatingPet                            │
│        对话面板       悬浮宠物更新                             │
└──────────────────────────────────────────────────────────────┘
```

### 3.5 会话创建流程

```
用户点击 "+ New" → SessionTypeModal
  → 填写表单（协议/主机/端口/凭据）
  → createSessionCmd({ protocol, ... })
  → invoke('create_session', { config })
  → Rust: session_commands::create_session
    ├─ ConnectionConfig::Local → PtyManager::create_session
    │   → portable-pty 创建 PTY → 生成 session-N → 返回 session_id
    │   → init MarkerScanner + StreamCleaner for session
    │   → spawn read_pty_output 线程
    │   → emit('session-created')
    └─ 其他 → ConnectionManager::connect
        → 创建远程连接 → 生成 ssh-N/telnet-N/serial-N → 返回 session_id
        → init MarkerScanner + StreamCleaner for session
        → spawn reader task
  → 前端 addSession({ id, status, ... })
  → Sidebar 显示新会话，自动激活
  → UnifiedSessionPanel 挂载 → TerminalRenderer 初始化 xterm.js
```

### 3.6 Session ID 命名规范（不变）

| 前缀 | 协议 | 示例 | 管理器 |
|------|------|------|--------|
| `session-` | 本地 PTY | `session-1` | PtyManager |
| `ssh-` | SSH 远程 | `ssh-3` | ConnectionManager |
| `telnet-` | Telnet | `telnet-2` | ConnectionManager |
| `serial-` | 串口 | `serial-1` | ConnectionManager |

前端通过 `sessionUtils.getWriteCommand(sessionId)` 根据前缀路由到正确的 Rust 命令。

---

## 4. 关键技术实现细节

### 4.1 统一终端渲染 (`UnifiedSessionPanel`)

**结构**: 包含 `ViewSwitcher` 和动态的 `Renderer`。

```
UnifiedSessionPanel
├── Toolbar (当前会话信息 + 视图切换按钮)
├── ViewSwitcher
│   ├── Terminal Tab → TerminalRenderer
│   ├── Blocks Tab  → BlocksRenderer
│   └── Split Tab   → SplitRenderer (未来)
└── Renderer (动态)
    ├── TerminalRenderer: xterm.js 实例，直接从 pti-output 写入
    ├── BlocksRenderer: React 渲染，从 sessionLogStore 派生 CommandGroup[]
    └── SplitRenderer: 上下分栏 (terminal + blocks)
```

**TerminalRenderer**: 
- 使用 xterm.js 的 `write()` 方法进行高性能渲染
- 每个已打开的 Session 保留独立 TerminalPanel 实例（CSS display:none 隐藏，不 dispose）
- 切换时 `isVisible → true → requestAnimationFrame(() => fitAddon.fit())`
- 初始化顺序严格：`new Terminal() → loadAddon(FitAddon) → open() → loadAddon(WebglAddon) → rAF(fit)`
- ResizeObserver 持续监听容器尺寸变化

**BlocksRenderer**: 
- 从 `sessionLogStore` 获取当前会话的日志
- 通过 `deriveCommandGroups(logs)` 函数实时计算出命令块列表
- 必须使用 `react-window` 进行虚拟滚动以保证大日志性能

### 4.2 统一日志模型 (`SessionEvent`)

这是 3.0 架构的基石。所有会话活动都被记录为结构化的 `SessionEvent`。

```typescript
// src/models/sessionData.ts
type SessionEventType =
  | 'input'        // 用户输入
  | 'output'       // PTY 出出（经过 sanitize）
  | 'command-start'// 命令块开始（OSC 7701 S marker）
  | 'command-end'  // 命令块结束（OSC 7701 E marker，含 exitCode）
  | 'system';      // 系统事件（session-created, session-ended, session-error）

interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  data: unknown; // 具体数据根据 type 而定
  ts: number;    // Unix timestamp ms
}

// 派生函数：从 SessionEvent[] 计算命令块
function deriveCommandGroups(events: SessionEvent[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  let current: CommandGroup | null = null;
  for (const ev of events) {
    if (ev.type === 'command-start') {
      current = { id: ev.data.commandId, command: ev.data.command, output: '', status: 'running', events: [] };
    } else if (ev.type === 'command-end' && current) {
      current.status = ev.data.exitCode === 0 ? 'success' : 'error';
      current.exitCode = ev.data.exitCode;
      groups.push(current);
      current = null;
    } else if (ev.type === 'output' && current) {
      current.output += ev.data;
    }
  }
  return groups;
}
```

**持久化格式**: `session.timeline.ndjson`，每行一个 JSON 对象。

```
{"id":"evt-001","sessionId":"session-1","type":"command-start","data":{"commandId":"blk-1","command":"ls -la"},"ts":1715328000000}
{"id":"evt-002","sessionId":"session-1","type":"output","data":"file1  file2  file3\n","ts":1715328000100}
{"id":"evt-003","sessionId":"session-1","type":"command-end","data":{"commandId":"blk-1","exitCode":0},"ts":1715328000200}
```

### 4.3 Rust 后端输出处理流水线

当前 2.0 的三人输出流派在 3.0 中合并为 `UnifiedStreamCore`。

```
read_pty_output / SSH channel loop
  │
  ├─ 1. MarkerScanner.scan_chunk(raw_bytes)
  │     → 扫描 OSC 7701: S;id 和 E;id;exit_code
  │     → emit('block-cmd-started') / emit('block-cmd-completed')
  │     → 前端 → sessionLogStore.appendLog({ type: 'command-start' / 'command-end' })
  │
  ├─ 2. StreamCleaner.process_chunk(raw_bytes)
  │     → OSC 133 状态机: WaitingForPrompt → InPrompt → InCommand
  │     → 降级路径: 行过滤（prompt/printf/__ls_rc/$? 行过滤）
  │     → emit('block-output')
  │     → 前端 → sessionLogStore.appendLog({ type: 'output', data: cleanText })
  │
  └─ 3. sanitize_output(utf8_text)
        → re_printf_7701_line → re_ls_rc_line → re_standalone_dollar_question
        → re_osc_7701 → re_osc_133 → re_bracketed_paste
        → emit('pti-output')
        → 前端 → TerminalRenderer: terminal.write(data) + persistTerminalChunk()
```

### 4.4 AI Agent 核心 (`SessionAgent`)

每个活跃会话绑定一个 `SessionAgent` 实例。

**订阅日志**: `SessionAgent` 会订阅来自 `useSessionStream` 的所有 `SessionEvent`，将其存入环形缓冲区（短期记忆，默认保留最近 2048 个事件）。

**错误检测**: 实时分析 `output` 事件，检测错误模式（exitCode != 0、stderr 关键词），并可在必要时主动向用户发起诊断请求。

**上下文感知**: 在回答用户关于特定会话的问题时，能自动检索短期记忆（环形缓冲）和长期记忆（SQLite 向量库 via rusqlite），提供精准上下文。

**意图路由 (IntentRouter)**:
- `Config`: 修改配置（"把字体改成 14px"）
- `Exec`: 执行 Shell 命令（"帮我查看磁盘使用"）
- `Chat`: 通用对话（"什么是 Docker?"）
- `Unknown`: 交给 LLM 做意图分类

**记忆系统 (MemoryStore)**:
- **短期记忆**: 环形缓冲区 `VecDeque<SessionEvent>`，仅保留最近 N 条
- **长期记忆**: SQLite + 向量嵌入（使用 rusqlite 存储），支持语义检索
- **会话摘要**: 定期将短期记忆压缩为摘要存入长期记忆

### 4.5 加密存储（不变）

```
存储文件：{HOME}/.LingShuTerm/workspace/connections.json
密钥文件：{HOME}/.LingShuTerm/workspace/.key

格式：
{
  "connections": [{ id, name, config: { protocol, host, password: "base64(nonce||ciphertext)" } }],
  "groups": ["GroupA", "GroupB"]
}

加密方案：AES-256-GCM (ring crate)
  - 密钥：首次运行时随机生成 256-bit 密钥，持久化到 .key
  - Nonce：每次加密随机生成 96-bit nonce
  - 密文：base64(nonce || ciphertext || tag)
  - 向后兼容：旧格式纯数组自动迁移为 StoragePayload
```

### 4.6 Session 持久化（3.0 重构）

```
{HOME}/.LingShuTerm/workspace/sessions/{session_id}/
  ├─ meta.json             # Session 元信息（id/name/shell/cwd/createdAt/lastAccessed）
  ├─ session.timeline.ndjson  # ★新: 统一会话日志（每行一个 SessionEvent JSON）
  └─ editor.json           # Editor 视图数据
```

旧格式中的 `blocks.json` 和 `terminal.ndjson` 不再写入。迁移脚本将 2.0 的数据合并到 `session.timeline.ndjson`。

### 4.7 主题系统（不变）

| 变量 | 色值 | 语义 |
|------|------|------|
| `--void` | `#0e0e0d` | 最深底色 |
| `--deep` | `#161615` | 面板背景 |
| `--surface` | `#1c1c1b` | 卡片表面 |
| `--text-1` | `#faf9f6` | 主文本（暖白） |
| `--text-2` | `#afaeac` | 次要文本 |
| `--accent` | `#7c6f64` | 暖色强调 |
| `--border` | `rgba(226,226,226,0.1)` | 半透明边框 |

xterm.js 主题与 Monaco Editor 主题均与 CSS 变量保持色彩一致。

### 4.8 输出结构化渲染系统（不变）

当 `OutputRenderer` 收到 Blocks 中的命令输出时，按优先级进行类型检测：

1. JSON（`{` 或 `[` 开头且可 parse）→ `JsonViewer`
2. `df -h` 表头特征 → `DiskUsageCard`
3. `ps aux` 表头特征 → `ProcessTable`
4. `git status` 特征词 → `GitStatus`
5. `du -sh` 行格式 → `DirectoryChart`
6. `ls -al` 长格式 → `FileListTable`
7. `ls/dir/tree` 短格式 → `FileGrid`
8. `cat foo.ext` 代码文件 → `CodeBlock` (Shiki 高亮)
9. Markdown 特征 → `MarkdownRenderer`
10. 含 Mermaid 代码 → `MermaidDiagram`
11. 其他 → `AnsiText` (原生 ANSI SGR 渲染)

### 4.9 终端日志审计系统 (Terminal Logging & Auditing)

#### 4.9.1 功能概述

实时记录终端（xterm.js）的输入输出到本地文件系统，支持日志轮转、UI 查看器和配置管理。

- **实时记录**：拦截 xterm.js 的输出流，将清洗后的文本写入日志文件
- **自动轮转**：当文件超过 `maxSizeMB`（默认 10MB），自动重命名为 `name_YYYYMMDD_HHmmss.log` 并创建新文件
- **Tab 级控制**：每个 Terminal Tab 有独立的"录制"开关（绿色脉冲圆点表示记录中，灰色表示停止）
- **UI 查看器**：右侧滑出面板展示日志文件树，支持双击打开查看内容、右键打开目录或复制路径

#### 4.9.2 数据流架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     数据采集层                                   │
│  xterm.js onData (输入)  →  [暂不记录]                          │
│  UnifiedSessionPanel  ←  useSessionStream ← session-event       │
│       ↓                                                         │
│  handleTerminalOutput(data)                                      │
│       ↓                                                         │
│  检查 per-terminal isLogging 标志                                │
│       ↓                                                         │
├─────────────────────────────────────────────────────────────────┤
│                     处理层 (LoggerService)                       │
│                                                                  │
│  LoggerService.write(config, sessionName, terminalName, data)    │
│       ↓                                                         │
│  invoke('write_log', { logPath, sessionName, terminalName,       │
│                        data, maxSizeMb })                        │
│       ↓                                                         │
├─────────────────────────────────────────────────────────────────┤
│                     存储层 (Rust backend)                        │
│                                                                  │
│  write_log:                                                      │
│    → strip_ansi() 清除 ESC 序列                                  │
│    → 换行标准化 (\r\n → \n)                                      │
│    → 写入 {logPath}/{sessionName}/{terminalName}.log             │
│    → 检查大小 → 触发轮转                                         │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.9.3 文件存储结构

```
{Log Path}/
├── Default/
│   ├── Terminal_session-1.log          # 当前日志
│   ├── Terminal_session-1_20260512_143022.log  # 轮转备份
│   └── Terminal_session-1_20260512_120000.log
├── Production_Server/
│   └── SSH_Connection.log
└── ...
```

**路径设计**：终端名称中的非法文件名字符（`:`, `/`, `\`, `*`, `?`, `"`, `<`, `>`, `|`）自动替换为 `_`。

#### 4.9.4 Rust 后端命令

| 命令 | 用途 |
|------|------|
| `write_log` | 追加日志条目，自动轮转 |
| `list_logs` | 列出某会话的所有日志文件 |
| `read_log_file` | 读取日志文件全文 |
| `open_in_explorer` | 在系统文件管理器中打开路径 (Windows/macOS/Linux) |

#### 4.9.5 配置项 (Settings Schema)

```typescript
interface LoggingSettings {
  enabled: boolean;       // 全局开关（默认 true）
  logPath: string;        // 日志根路径（空 = {workspace}/logs）
  maxSizeMb: number;      // 单文件最大大小（默认 10 MB）
}
```

配置通过 `useSettingsStore` 持久化到 `localStorage` (`lingshu-settings` key)。

#### 4.9.6 前端组件架构

```
TitleBar
  └── ScrollText 按钮 → 切换 LogViewer

TerminalTabBar
  └── Circle 圆点按钮 (per-tab) → toggleTerminalLogging()

LogViewer (右侧滑出面板, 640px)
  ├── 左侧: 文件树
  │   ├── Session 节点 (展开/折叠)
  │   ├── 当前日志文件 (双击 → 右侧查看)
  │   ├── 历史轮转文件 (History 分组)
  │   └── 右键菜单: 打开目录 / 复制路径
  └── 右侧: 日志内容预览 (<pre> 只读)
```

#### 4.9.7 状态管理

- **`TerminalInstance.isLogging`** (`boolean`): 每个终端 Tab 的日志开关
- **`sessionStore.toggleTerminalLogging(sessionId, terminalId)`**: 切换开关
- **`sessionStore.resolveTerminalMeta(connectionId)`**: 根据连接 ID 查找会话/终端名称和 isLogging 状态

### 4.10 集成服务器管理面板 (Integrated Server Management Panel)

#### 4.10.1 功能概述

在工具栏提供统一的服务管理入口，支持一键启动/停止各种网络服务进程。

- **支持服务列表**：TFTP, FTP, HTTP, SSH/SFTP, Telnet, NFS, VNC, Cron, Iperf
- **进程管理**：后台 spawn 子进程，维护运行中进程的 PID Map
- **端口检测**：启动前检查端口是否被占用
- **状态预览**：右侧面板显示服务运行日志和状态信息

#### 4.10.2 UI 布局设计

```
┌──────────────────────────────────────────────────────┐
│  Servers                                    [X]      │
├──────────────────────┬───────────────────────────────┤
│  服务列表 (240px)     │  详情预览区                   │
│                      │                               │
│  ● TFTP    ▶ ■ ⚙    │  Welcome to LingshuTerm       │
│  ○ FTP     ▶ ■ ⚙    │  Network Services             │
│  ○ HTTP    ▶ ■ ⚙    │                               │
│  ○ SSH     ▶ ■ ⚙    │  Select a service to view     │
│  ○ Telnet  ▶ ■ ⚙    │  its status and logs.         │
│  ○ NFS     ▶ ■ ⚙    │                               │
│  ○ VNC     ▶ ■ ⚙    │                               │
│  ○ Cron    ▶ ■ ⚙    │                               │
│  ○ Iperf   ▶ ■ ⚙    │                               │
│                      │                               │
└──────────────────────┴───────────────────────────────┘
```

- **左侧列表**：每行包含状态指示灯 (●/○ 绿/灰)、服务名称、启动/停止按钮 (▶/■)、设置按钮 (⚙)
- **右侧预览**：显示选中服务的欢迎信息、运行日志或配置面板
- **入口**：TitleBar 增加 "Servers" 按钮（图标：`Server` 或 `Network`）

#### 4.10.3 核心逻辑架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    ServerManager (Rust)                           │
│                                                                  │
│  struct ServerManager {                                          │
│    processes: HashMap<String, Child>,  // 运行中服务 PID Map      │
│    configs:   HashMap<String, ServerConfig>,                     │
│  }                                                               │
│                                                                  │
│  impl ServerManager {                                            │
│    fn start(service: &str, config: &ServerConfig) → Result<Pid>  │
│    fn stop(service: &str) → Result<()>                           │
│    fn status(service: &str) → ServiceStatus                      │
│    fn check_port(port: u16) → bool  // 端口占用检测              │
│    fn list_services() → Vec<ServiceInfo>                         │
│  }                                                               │
├─────────────────────────────────────────────────────────────────┤
│                    Tauri Commands                                 │
│                                                                  │
│  start_service(service, config) → Result<String>                 │
│  stop_service(service) → Result<()>                              │
│  service_status(service) → ServiceStatus                         │
│  list_services() → Vec<ServiceInfo>                              │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.10.4 数据结构

```typescript
interface ServerConfig {
  serviceName: string;       // 服务标识 (tftp, ftp, http, ...)
  displayName: string;       // 显示名称
  port: number;              // 监听端口
  binaryPath?: string;       // 二进制路径（可选，内置默认）
  args: string[];            // 启动参数
  workingDir?: string;       // 工作目录
  autoStart: boolean;        // 是否随应用启动
}

interface ServiceStatus {
  service: string;
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;           // 运行秒数
  error?: string;
}
```

#### 4.10.5 服务配置预设

| 服务 | 默认端口 | 默认二进制 | 说明 |
|------|---------|-----------|------|
| TFTP | 69 | 内置 (tftp-server) | 简单文件传输 |
| FTP | 21 | 内置 (ftp-server) | 文件传输 |
| HTTP | 80/8080 | 内置 (http-server) | 静态文件服务 |
| SSH/SFTP | 22 | 内置 (ssh-server) | 安全 Shell |
| Telnet | 23 | 内置 (telnet-server) | 远程登录 |
| NFS | 2049 | 内置 (nfs-server) | 网络文件系统 |
| VNC | 5900 | 内置 (vnc-server) | 远程桌面 |
| Cron | - | 内置 (cron-daemon) | 定时任务 |
| Iperf | 5201 | 内置 (iperf3) | 网络性能测试 |

---

## 5. 开发规范

### 5.1 TypeScript 配置

```jsonc
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true,
  "jsx": "react-jsx",
  "moduleResolution": "bundler",
  "paths": { "@/*": ["./src/*"] }
}
```

### 5.2 组件命名规范

- **页面/布局组件**：PascalCase，如 `Layout`、`UnifiedSessionPanel`、`SessionManager`
- **内部子组件**：PascalCase + 语义后缀，如 `TreeNodeRow`、`ViewSwitcher`、`ProtocolIcon`
- **Hooks**：`use` 前缀，如 `useTerminal`、`useSessionStream`、`useDraggable`
- **Store**：`useXxxStore` 形式导出，如 `useSessionStore`、`useSessionLogStore`
- **工具函数**：camelCase，如 `buildTree`、`connectionLabel`、`getWriteCommand`
- **类型/接口**：PascalCase，如 `ConnectionConfig`、`SessionInfo`、`SessionEvent`

### 5.3 文件组织规范

- 每个组件一个文件，导出单个具名函数（不使用 default export，App.tsx 除外）
- 数据模型放在 `models/`，纯类型定义不包含逻辑
- Store 放在 `stores/`，每个 Store 独立文件
- 业务副作用封装在 `hooks/`
- 纯函数工具放在 `lib/`
- Rust 模块每个文件一个职责域

### 5.4 状态管理规范

- **不可变更新**：所有 Store action 使用 `set(state => ({...state, ...}))` 或不可变展开
- **Selector 优化**：使用 `useMemo` 缓存过滤结果，避免每次返回新引用导致无限循环
- **持久化时机**：连接配置每次 CRUD 后立即持久化；Session 日志采用 16KB/200ms 缓冲批量写入
- **新规范**：禁止在组件内直接处理原始 `pti-output` 事件。所有数据必须先经过 `useSessionStream` 进入 `sessionLogStore`

### 5.5 防 StrictMode 双挂载规范

- 使用 `cancelled` flag + 局部 `unlisteners` 数组隔离每次 Effect run
- 回调入口先 `if (cancelled) return`
- cleanup 中 `cancelled = true` + 遍历 unlisten
- 用 `bootstrappedRef` 防止 `create_session` 重复调用

### 5.6 性能优化规范

- `BlocksRenderer` 必须实现虚拟滚动（`react-window`）
- `session.timeline.ndjson` 文件应采用分片策略（如每 10MB 一个文件）防止文件过大
- AI Agent 的记忆检索需使用 SQLite 索引优化
- xterm.js 初始化顺序必须严格：`FitAddon → open → WebglAddon → rAF → fit`

### 5.7 向后兼容

- 提供脚本或运行时逻辑，将 2.0 的 `terminal.ndjson` 和 `blocks.json` 迁移到新的 `session.timeline.ndjson` 格式
- `commandStore` 保留但标记 @deprecated，旧 `BlocksPanel` 代码可继续使用
- `useBlockSession` 保留兼容，新代码使用 `useSessionStream`

### 5.8 安全规范

- AI Agent 执行危险操作前必须获得用户明确授权（`pendingAuths[]` 机制）
- 所有敏感配置需使用 AES-256-GCM 加密存储（ring crate）
- 网络连接需验证主机密钥指纹（SSH via russh）
- Rust 端 session_id 做严格白名单校验（只允许 A-Z a-z 0-9 _ - .），防目录穿越

### 5.9 测试规范

- **运行**：`npx vitest run`（CI）/ `npx vitest`（watch）
- **环境**：jsdom（模拟浏览器 DOM）+ `@testing-library`
- **覆盖率**：模型层、Store 层、工具函数层
- **Rust 测试**：`cargo test`（含单元测试和集成测试）

---

## 6. 构建 & 运行命令

```bash
# 前端开发
npm run dev

# Tauri 开发模式
npm run tauri:dev

# 生产构建
npm run tauri:build

# TypeScript 类型检查
npx tsc --noEmit

# Rust 类型检查
cargo check

# 前端测试
npx vitest run

# Rust 测试
cargo test
```

---

## 7. 架构演进策略

### 7.1 从 2.0 到 3.0 的迁移路径

| 阶段 | 内容 | C影响范围 |
|------|------|----------|
| **Phase 1** | 新增 `sessionLogStore` + `useSessionStream` | 新增文件，不影响现有的 |
| **Phase 2** | 新增 `UnifiedSessionPanel` 组件簇 | 新增组件，与旧的 TerminalPanel/BlocksPanel 并行 |
| **Phase 3** | Rust 端重组为 `UnifiedStreamCore` | 重构 shell.rs / connection.rs 的输出处理 |
| **Phase 4** | 实现 AI Agent 核心模块 | 新增 agent/ 模块 + agentStore |
| **Phase 5** | 迁移持久化到 `session.timeline.ndjson` | 重构 persistence.rs / persistenceSubscribe.ts |
| **Phase 6** | 移除 @deprecated 代码 | 清理 commandStore / useBlockSession / 旧组件 |

### 7.2 架构优势

- **架构统一性**：彻底消除 Terminal/Blocks 双系统割裂，单一 SessionEvent 时间线
- **可扩展性**：易于添加新的渲染视图（Timeline View、Diff View）；AI Agent 系统可扩展
- **性能优化**：终端模式使用原生 xterm.js 渲染；Blocks 模式采用虚拟滚动；统一事件流减少数据转换开销
- **用户体验**：无缝的视图切换体验；完整的命令历史记录；智能的 AI 辅助功能

---

## 8. 后续发展路线图

### 8.1 短期目标（3.0 核心）

- 实现 `sessionLogStore` + `useSessionStream` 统一日志系统
- 实现 `UnifiedSessionPanel` + `ViewSwitcher`
- 实现基础 AI Agent 功能（AgentPanel + FloatingPet）

### 8.2 中期目标

- 添加会话回放功能（基于 SessionEvent 时间线）
- 实现 AI 自动摘要
- 支持多 Agent 协作
- `SplitRenderer` 分栏视图

### 8.3 长期目标

- 构建开发者工作流平台
- 支持插件生态系统
- 实现跨平台同步协作
- Android 平台支持（已有 executor.rs 中的 Android stubs）

---

**文档结束**

*本架构设计文档基于对 LingshuTerm 2.0 全量代码的深入分析，结合 3.0 架构愿景重新生成，作为后续所有开发工作的核心指导文件。*
