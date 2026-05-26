# 灵枢智能终端 3.0 — 统一会话与 Harness 中间件架构设计

**文档版本：** v3.4  
**最后更新：** 2026-05-24  
**文档用途：** 作为后续 AI 辅助开发的系统提示词 / 知识库基准

---

## 目录

1. [项目概览](#1-项目概览)
2. [目录结构](#2-目录结构)
3. [Harness 中间件系统（新增核心）](#3-harness-中间件系统新增核心)
4. [现有核心数据流](#4-现有核心数据流)
5. [关键技术实现细节](#5-关键技术实现细节)
6. [开发规范](#6-开发规范)
7. [构建 & 运行命令](#7-构建--运行命令)
8. [后续发展路线图](#8-后续发展路线图)

---

## 1. 项目概览

### 1.1 核心定位

灵枢智能终端 3.0（LingshuTerm 3.0）是一款基于 **Tauri v2** 的跨平台智能终端工具，核心特性为：

- **Harness 中间件架构**：在 NL→Commands 管道上插入权限护栏、上下文注入、进度落盘、验证循环四层中间件
- **AI 智能代理 (AI Agent)**：自然语言意图识别、单轮规划 + Harness 校验、长短期记忆、危险操作授权
- **多协议远程连接**：SSH（纯 Rust 实现 via russh）、Telnet、串口（Serial）
- **本地 PTY**：基于 `portable-pty` 的跨平台伪终端
- **代码编辑器**：集成 Monaco Editor，支持多 Tab 虚拟工作区
- **会话管理器**：树形目录分组、HTML5 拖拽排序、右键菜单、加密持久化
- **终端日志审计**：实时记录终端输入输出、自动轮转（10MB）、文件树查看器
- **集成服务器管理**：一键启停 TFTP/FTP/HTTP/SSH 等网络服务、端口检测、进程守护
- **服务器状态监控**：SSH 连接时实时显示 CPU/MEM/DISK/NET/USERS 及详细 Tooltip

**核心公式：Agent = Model + Harness**

### 1.2 技术栈清单

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **桌面框架** | Tauri | v2 | 跨平台桌面容器、系统调用 |
| **前端框架** | React | 19.1 | UI 组件渲染 |
| **状态管理** | Zustand | 5.0 | 全局状态 |
| **终端渲染** | xterm.js | 5.5 | 终端模拟 + FitAddon + WebglAddon |
| **代码编辑器** | Monaco Editor | 0.55 | 代码编辑视图 |
| **图标库** | Lucide React | 0.400 | 矢量图标 |
| **Markdown** | react-markdown + remark-gfm | 9.1 / 4.0 | Blocks 输出渲染 |
| **语法高亮** | Shiki | 4.0 | 代码块着色 |
| **图表** | Mermaid | 11.14 | 流程图渲染 |
| **CSS 框架** | Tailwind CSS | 3.4 | 原子化样式（自定义深色主题） |
| **后端语言** | Rust (Edition 2021) | - | PTY 管理、网络连接、持久化、AI Proxy |
| **PTY 库** | portable-pty | 0.8 | 跨平台伪终端 |
| **SSH 库** | russh (ring 后端) | 0.60 | 纯 Rust SSH 客户端 |
| **串口** | serialport | 4.3 | COM 端口通信 |
| **加密** | ring | 0.17 | AES-256-GCM 密码存储 |
| **异步运行时** | Tokio | 1 | Rust 异步任务调度 |
| **序列化** | serde + serde_json | 1 | Rust ↔ JSON 互转 |
| **HTTP 客户端** | reqwest | 0.12 | 调用 OpenAI 兼容 API |
| **正则** | regex | 1 | 输出清洗 / 协议扫描 |
| **构建工具** | Vite | 7.0 | 前端构建 & HMR |
| **测试框架** | Vitest | 4.1 | 单元测试 (jsdom) |
| **类型检查** | TypeScript | 5.8 | 严格模式类型检查 |

---

## 2. 目录结构

```
LingshuTerm3.0/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── AGENTS.md                       # ★项目级 AI 行为规范（Harness Context Injector 读取）
├── PROGRESS.md                     # ★跨会话任务进度（Harness Progress Writer 管理）
│
├── src/                            # ── 前端源代码 ──
│   ├── main.tsx                    # React 入口
│   ├── App.tsx                     # 根组件
│   ├── index.css                   # 全局样式（主题变量 + Tooltip 样式）
│   │
│   ├── models/                     # 数据模型层
│   │   ├── connection.ts           # 连接协议类型（SSH/Telnet/Serial/Local）
│   │   ├── session.ts              # 会话元信息
│   │   ├── sessionData.ts          # SessionEvent 时间线模型
│   │   ├── terminal.ts             # 终端配置与事件荷载
│   │   ├── block.ts                # 命令块模型
│   │   ├── task.ts                 # AI 任务模型（nlToTasks → TaskGroup → TaskItem）
│   │   └── editor.ts               # 编辑器模型
│   │
│   ├── stores/                     # 状态管理层 — Zustand Store
│   │   ├── connectionStore.ts      # 连接配置 CRUD + 分组管理
│   │   ├── sessionStore.ts         # 运行时 Session 注册表
│   │   ├── uiStore.ts              # UI 状态
│   │   ├── settingsStore.ts        # 用户设置（终端/AI/Harness 配置）
│   │   ├── taskStore.ts            # AI 任务队列
│   │   ├── outputStore.ts          # 输出流状态
│   │   └── sessionLogStore.ts      # 统一会话日志
│   │
│   ├── hooks/                      # 自定义 Hooks
│   │   ├── useTerminal.ts          # xterm.js 生命周期管理
│   │   ├── useEditor.ts            # Monaco Editor 生命周期管理
│   │   ├── useAiSubmit.ts          # ★AI 提交入口（→ harnessPipeline）
│   │   ├── useSession.ts           # 聚合 Hook：组装只读 Session 视图
│   │   ├── useSessionStream.ts     # 统一会话流处理 Hook
│   │   └── usePersistenceBootstrap.ts # 启动持久化恢复
│   │
│   ├── lib/                        # 工具库
│   │   ├── sessionUtils.ts         # Session ID 前缀路由
│   │   ├── connectionService.ts    # 连接命令薄封装
│   │   ├── sessionService.ts       # 统一会话创建入口
│   │   ├── aiService.ts            # OpenAI 兼容 API 客户端（nlToTasks / testConnection）
│   │   ├── aiDetect.ts             # 输入检测（自然语言 vs Shell 命令）
│   │   ├── memoryService.ts        # 分层记忆系统（Short-Term / Long-Term / AGENT.md）
│   │   ├── terminalAction.ts       # 终端创建动作解析
│   │   ├── commandParser.ts        # 命令解析器
│   │   ├── persistenceService.ts   # 持久化薄封装
│   │   ├── persistenceSubscribe.ts # Store 订阅 → Rust 持久化
│   │   ├── loggerService.ts        # 日志服务
│   │   ├── harness/                # ★新增: Harness 中间件系统
│   │   │   ├── types.ts            # 共享类型定义
│   │   │   ├── contextInjector.ts  # AGENTS.md 读取 + System Prompt 注入
│   │   │   ├── permissionManager.ts# 权限护栏规则引擎
│   │   │   ├── progressWriter.ts   # PROGRESS.md 读写 + 跨会话恢复
│   │   │   ├── verificationRunner.ts # 验收命令执行 + 失败回传
│   │   │   ├── harnessPipeline.ts  # 主 Pipeline 编排器
│   │   │   └── defaults.ts         # 默认规则集 + 默认 AGENTS.md 模板
│   │   ├── monaco.ts               # Monaco Editor 工厂函数
│   │   ├── ansi.ts                 # ANSI 转义序列解析
│   │   ├── xterm.ts                # xterm.js 主题配置
│   │   ├── outputDetector.ts       # 输出内容检测器
│   │   ├── outputDispatch.ts       # 命令输出调度器
│   │   └── fileParser.ts           # ls -al 长格式解析器
│   │
│   ├── components/                 # UI 组件层
│   │   ├── Layout.tsx              # 主布局
│   │   ├── TitleBar.tsx            # 标题栏
│   │   ├── Sidebar.tsx             # 侧边栏
│   │   ├── TerminalPanel.tsx       # 终端面板
│   │   ├── BlocksPanel.tsx         # Blocks 面板
│   │   ├── TerminalTabBar.tsx      # 终端 Tab 栏
│   │   ├── TerminalRenderer.tsx    # 终端渲染器（xterm.js）
│   │   ├── TerminalConnectModal.tsx# 新建终端连接配置弹窗
│   │   ├── EditorPanel.tsx         # 编辑器面板
│   │   ├── CommandInput.tsx        # 底部命令输入栏
│   │   ├── BottomInputArea.tsx     # 底部输入区路由
│   │   ├── TaskBoard.tsx           # AI 任务看板
│   │   ├── TaskModal.tsx           # 任务执行模态框
│   │   ├── StatusBar.tsx           # ★状态栏（服务器监控 + Tooltip）
│   │   ├── SettingsModal.tsx       # ★设置面板（含 Harness 规则配置）
│   │   ├── SessionTypeModal.tsx    # 新建会话模态框
│   │   ├── SessionManager.tsx      # 会话管理器
│   │   ├── ContextMenu.tsx         # 通用右键菜单组件
│   │   ├── ConfirmDialog.tsx       # ★新增: 权限确认弹窗（alwaysAsk 触发）
│   │   ├── SftpPanel.tsx           # SFTP 文件管理面板
│   │   ├── LogViewer.tsx           # 日志文件查看器
│   │   └── output/                 # 结构化输出渲染器
│   │       ├── OutputRenderer.tsx
│   │       ├── AnsiText.tsx
│   │       ├── CodeBlock.tsx
│   │       ├── MarkdownRenderer.tsx
│   │       ├── MermaidDiagram.tsx
│   │       ├── JsonViewer.tsx
│   │       ├── DiskUsageCard.tsx
│   │       ├── ProcessTable.tsx
│   │       ├── GitStatus.tsx
│   │       ├── DirectoryChart.tsx
│   │       ├── FileListTable.tsx
│   │       └── FileGrid.tsx
│   │
│   └── assets/                     # 静态资源
│
└── src-tauri/                      # ── Rust 后端源代码 ──
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── main.rs                 # 应用入口 + 命令注册
        ├── lib.rs                  # 模块声明
        ├── shell.rs                # PtyManager — 本地 PTY 生命周期
        ├── connection.rs           # ConnectionManager — 远程连接 + query_server_stats
        ├── session_commands.rs     # 统一会话创建 + query_server_stats 命令
        ├── commands.rs             # PTY 命令（write/resize/destroy/block）
        ├── connection_commands.rs  # 连接命令（disconnect/write/resize/list_serial）
        ├── executor.rs             # 抽象执行器 trait（ShellExecutor / ConnectionExecutor）
        ├── block.rs                # OSC 7701 MarkerScanner + 命令包装
        ├── ai_proxy.rs             # AI API 代理（绕过浏览器 CORS）
        ├── harness_commands.rs     # ★新增: Harness 后端命令
        │                           #   - read_agents_md: 读取 AGENTS.md
        │                           #   - write_progress_md: 写入 PROGRESS.md
        │                           #   - run_verify_cmd: 静默执行验收命令
        │                           #   - read_memory_file / write_memory_file (已有)
        ├── persistence.rs          # Session 持久化读写
        ├── storage.rs              # 加密存储（AES-256-GCM）
        ├── logger.rs               # 日志写入/轮转/ANSI 清洗
        ├── server_manager.rs       # 集成服务器管理
        ├── sftp.rs                 # SFTP 文件操作
        ├── stream/                 # 统一会话流处理
        │   ├── core.rs             # UnifiedStreamCore
        │   ├── log.rs              # SessionLog 模型
        │   └── event.rs            # SessionEvent 类型 + emit 封装
        ├── output_sanitizer.rs     # PTY 输出清洗
        ├── stream_cleaner.rs       # OSC 133 状态机
        └── utils.rs                # 工具函数
```

---

## 3. Harness 中间件系统（新增核心）

### 3.1 设计理念

**Agent = Model + Harness**

当前 AI 系统是单轮 NL→commands 映射器（用户输入 → LLM → 命令列表），缺乏安全校验、上下文注入、进度持久化和结果验证。

Harness 系统在现有管道上插入 4 层独立中间件，每层可单独测试和替换：

```
用户输入
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ [1] Context Injector (上下文注入器)                   │
│     读取 AGENTS.md → 注入 System Prompt             │
│     读取 PROGRESS.md → 注入任务上下文                 │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                    LLM 调用                          │
│         aiService.nlToTasks()  (复用现有)            │
│         返回: AiTaskStep[]                           │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│ [2] Permission Manager (权限护栏)                    │
│     alwaysDeny  → 直接拒绝，返回错误                  │
│     alwaysAllow → 静默通过                            │
│     alwaysAsk   → 弹出 ConfirmDialog，等用户确认      │
└─────────────────────────┬───────────────────────────┘
                          │
                    ┌─────┴─────┐
                    │ 用户确认?  │
                    │ (alwaysAsk)│
                    └─────┬─────┘
                          │ 允许
                          ▼
┌─────────────────────────────────────────────────────┐
│                命令执行 (现有 Block 系统)             │
│         execute_block_command() per step            │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│ [3] Progress Writer (进度落盘)                       │
│     判断是否长任务 (>3 步 或 >500 字符)              │
│     写入 PROGRESS.md：已完成/当前/待办/验收命令       │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│ [4] Verification Runner (验证循环)                   │
│     读取验收命令 (来自 AGENTS.md)                      │
│     静默执行验收                                     │
│     exitCode=0 → 完成                               │
│     exitCode≠0 → 收集错误 → 回传 LLM 修复 (最多3次)   │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
                      输出结果给用户
```

### 3.2 类型定义 (`src/lib/harness/types.ts`)

```typescript
// ─── 权限相关 ───

export type GuardAction = 'deny' | 'allow' | 'ask';

export interface GuardRule {
  /** 正则或 glob 模式匹配命令 */
  pattern: string | RegExp;
  /** 命中后的行为 */
  action: GuardAction;
  /** 人类可读的原因说明（显示在确认弹窗中） */
  reason?: string;
}

export interface GuardResult {
  action: GuardAction;
  matchedRule?: GuardRule;
  /** 审计日志条目 */
  auditEntry: {
    command: string;
    action: GuardAction;
    timestamp: number;
    reason?: string;
  };
}

// ─── 上下文相关 ───

export interface HarnessContext {
  /** AGENTS.md 内容（系统提示词） */
  agentsMd: string;
  /** PROGRESS.md 内容（任务进度，null 表示无进行中任务） */
  progressMd: string | null;
  /** 默认验收命令列表 */
  verifyCommands: string[];
}

// ─── 进度相关 ───

export type ProgressStatus = '进行中' | '已完成' | '已暂停';

export interface ProgressSnapshot {
  status: ProgressStatus;
  completedSteps: string[];
  currentStep: string;
  pendingSteps: string[];
  verifyCommands: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 验证相关 ───

export type VerifyStatus = 'pass' | 'fail' | 'running';

export interface VerifyResult {
  status: VerifyStatus;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  attempt: number;
  maxRetries: number;
}

// ─── Pipeline 类型 ───

export interface HarnessConfig {
  /** 权限规则集 */
  guardRules: GuardRule[];
  /** AGENTS.md 路径（默认项目根目录） */
  agentsPath: string;
  /** PROGRESS.md 路径 */
  progressPath: string;
  /** 验证最大重试次数 */
  maxVerifyRetries: number;
  /** 长任务阈值（步骤数） */
  longTaskStepThreshold: number;
  /** 长任务阈值（总命令长度） */
  longTaskLengthThreshold: number;
}

export interface PipelineResult {
  steps: AiTaskStep[];
  guardResults: GuardResult[];
  verifyResults: VerifyResult[];
  progressUpdated: boolean;
  finalStatus: 'success' | 'partial' | 'denied' | 'failed';
}
```

### 3.3 Context Injector (`contextInjector.ts`)

**职责**：在 LLM 调用前自动注入项目级指令和任务进度

**数据流**：
```
1. 调用 invoke('read_agents_md') 读取项目根目录 AGENTS.md
2. 如果文件不存在，写入默认模板（defaults.ts 中定义）
3. 调用 progressWriter.load() 检查是否有进行中的任务
4. 构建 System Prompt:
   ┌──────────────────────┐
   │ AGENTS.md 内容       │  ← 项目规范、技术栈、验收标准
   │ ─────────────────── │
   │ 原有 System Prompt   │  ← nlToTasks 的行为规则
   │ ─────────────────── │
   │ PROGRESS.md 摘要     │  ← (如有) 正在继续的任务进度
   │ ─────────────────── │
   │ Long-Term Memory     │  ← 持久化知识/偏好
   └──────────────────────┘
5. 传递给 memoryService.assemblePrompt() → aiService.nlToTasks()
```

**关键设计决策**：
- AGENTS.md 位于**项目工作区根目录**，非 session 级
- 内容缓存 5 分钟（`Map<string, { content: string; ts: number }>`），避免每次读取磁盘
- 支持热重载：文件修改后下次 LLM 调用自动生效
- 默认模板包含：项目技术栈、代码风格规范、验收命令、安全禁区

### 3.4 Permission Manager (`permissionManager.ts`)

**职责**：命令执行前的安全拦截

**规则引擎**（三级优先级，从高到低）：
```
1. alwaysDeny  ← 最高优先级，匹配后直接拒绝，不可绕过
2. alwaysAllow ← 次优先级，白名单，静默通过
3. alwaysAsk   ← 最低优先级，命中后弹出 ConfirmDialog
```

**默认规则集** (`defaults.ts`)：

```typescript
alwaysDeny: [
  // 毁灭性操作
  'rm -rf /', 'rm -rf /*', 'rm -rf ~',
  'rm -rf --no-preserve-root /',
  // 磁盘擦除
  'dd if=.*of=/dev/', '> /dev/sd',
  // Fork bomb
  ':(){ :|:& };:',
  // 格式化
  'mkfs.*', 'mke2fs.*',
  // 全局权限变更
  'chmod -R 777 /', 'chmod -R 000 /',
  'chown -R .* /',
],

alwaysAllow: [
  // 只读/无害命令
  'ls', 'cd', 'pwd', 'cat', 'head', 'tail', 'echo',
  'grep', 'find', 'which', 'whoami', 'date', 'uname',
  'wc', 'sort', 'uniq', 'cut', 'tr', 'awk', 'sed',
  'du', 'df', 'free', 'ps', 'top', 'htop', 'uptime',
  'ping', 'traceroute', 'nslookup', 'dig', 'curl', 'wget',
  // 开发工具
  'npm test', 'npm run build', 'npm run lint',
  'pnpm test', 'pnpm build', 'pnpm lint',
  'yarn test', 'yarn build',
  'git status', 'git log', 'git diff', 'git branch',
  'cargo check', 'cargo test',
  'tsc --noEmit', 'npx vitest run',
],

alwaysAsk: [
  // 默认：所有不在上述列表中的命令
  // 显式列出常见危险操作以便显示原因
  { pattern: 'rm ', reason: '删除文件/目录操作' },
  { pattern: 'mv ', reason: '移动/重命名文件' },
  { pattern: 'chmod ', reason: '修改文件权限' },
  { pattern: 'chown ', reason: '修改文件所有者' },
  { pattern: 'kill ', reason: '终止进程' },
  { pattern: 'systemctl ', reason: '系统服务管理' },
  { pattern: 'reboot', reason: '重启系统' },
  { pattern: 'shutdown', reason: '关闭系统' },
  { pattern: 'npm (install|uninstall)', reason: '安装/卸载 npm 包' },
  { pattern: 'pip (install|uninstall)', reason: '安装/卸载 Python 包' },
  { pattern: 'docker ', reason: 'Docker 容器操作' },
  { pattern: 'git (push|commit|merge|rebase)', reason: 'Git 写操作' },
]
```

**匹配算法**：
- 对命令的第一段（可执行文件名）和完整命令字符串分别进行正则匹配
- 使用 `RegExp.test()` 进行高效匹配
- 按优先级顺序检查：deny → allow → ask
- 首个命中即返回，除非更高优先级规则后命中

**审计日志**：每次拦截记录完整 `auditEntry`，通过 `loggerService.write()` 写入独立日志文件。

### 3.5 Progress Writer (`progressWriter.ts`)

**职责**：长任务进度持久化 & 跨会话恢复

**触发条件**（满足任一即写 PROGRESS.md）：
- 任务步骤数 > `longTaskStepThreshold`（默认 3）
- 总命令字符数 > `longTaskLengthThreshold`（默认 500）
- 用户消息中包含 "保存进度"、"暂停"、"稍后继续"

**PROGRESS.md 格式**：
```markdown
# 任务进度

> **创建时间**: 2026-05-24 15:30
> **最后更新**: 2026-05-24 16:00
> **状态**: 进行中

## 已完成的步骤
- [x] `npm init -y` — 初始化项目 (exit: 0)
- [x] `npm install express` — 安装依赖 (exit: 0)

## 当前步骤
- [ ] `npm run dev` — 启动开发服务器

## 待办步骤
- [ ] `npm test` — 运行测试
- [ ] `git add . && git commit -m "feat: add express app"` — 提交代码

## 验收命令
- `npm run build`
- `npm test`

## 备注
用户需要在 8080 端口启动服务，已配置好 CORS
```

**恢复逻辑**（在新会话启动时）：
1. `progressWriter.load()` 检查 PROGRESS.md 是否存在且状态为"进行中"
2. 存在 → 提取已完成/当前/待办步骤，构建进度摘要
3. 将摘要注入 System Prompt（由 contextInjector 调用）:
   ```
   你正在继续一个之前未完成的任务。以下是进度概要：
   - 已完成 2/5 步：已完成 npm init 和 npm install
   - 当前步骤：npm run dev
   - 待完成：npm test, git commit
   请基于这些信息继续执行。
   ```

**API**：
```typescript
export const progressWriter = {
  /** 加载当前进度（null = 无进行中任务） */
  load(): Promise<ProgressSnapshot | null>,
  /** 保存/更新进度 */
  save(snapshot: ProgressSnapshot): Promise<void>,
  /** 标记为完成 */
  complete(): Promise<void>,
  /** 清除进度文件 */
  clear(): Promise<void>,
};
```

### 3.6 Verification Runner (`verificationRunner.ts`)

**职责**：自动验收 + 失败重试循环

**验收命令来源**（优先级从高到低）：
1. 用户在输入中明确指定的验收命令（如 "完成后跑 npm test"）
2. AGENTS.md 中 `## 验收命令` 区块定义的命令
3. 系统默认（空，跳过验证）

**工作流**：
```
1. 所有任务步骤执行完毕
2. 从 AGENTS.md 或用户输入提取验收命令列表
3. 如果没有验收命令 → 跳过，直接返回结果
4. 如果有验收命令 → 逐条静默执行（调用 execute_block_command）
5. 检查 exitCode:
   ├─ exitCode = 0 → 标记为 PASS，继续下一条验收命令
   └─ exitCode ≠ 0 →
      a. 收集 stdout + stderr
      b. attempt += 1
      c. 如果 attempt <= maxRetries (默认 3):
         - 构建修复请求: "验收命令 `{cmd}` 失败 (exit={code})，错误: {stderr}，请生成修复命令"
         - 重新调用 aiService.nlToTasks()
         - 对修复后的命令重新走 Guard → Execute → Verify 流程
      d. 如果 attempt > maxRetries:
         - 标记为 FAIL，返回完整错误信息给用户
6. 所有验收命令 PASS → 标记任务完成
```

**与现有系统的对接**：
- 利用现有的 `invoke('execute_block_command', { sessionId, command })` 静默执行
- 监听 `block-cmd-completed` 事件获取退出码
- 不需要修改 Rust 层（harness_commands.rs 中的 `run_verify_cmd` 作为统一包装）

### 3.7 主 Pipeline 编排 (`harnessPipeline.ts`)

```typescript
// 主入口：替代 useAiSubmit 中直接调用 nlToTasks 的逻辑
export async function harnessPipeline(
  userInput: string,
  sessionId: string,
  config: HarnessConfig,
  onConfirm: (step: AiTaskStep) => Promise<boolean>, // 权限确认回调
  onProgress: (status: string) => void,               // 进度回调
): Promise<PipelineResult> {
  
  const result: PipelineResult = {
    steps: [],
    guardResults: [],
    verifyResults: [],
    progressUpdated: false,
    finalStatus: 'success',
  };

  // ── Phase 1: Context Injection ──
  onProgress('正在读取项目上下文...');
  const systemPrompt = await contextInjector.buildSystemPrompt(sessionId);

  // ── Phase 2: LLM Call ──
  onProgress('AI 正在分析任务...');
  const steps = await aiService.nlToTasks(
    aiConfig, userInput, undefined,
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userInput }],
  );
  result.steps = steps;

  // ── Phase 3: Permission Guard ──
  for (const step of steps) {
    const guardResult = permissionManager.check(step.command, config.guardRules);
    result.guardResults.push(guardResult);

    if (guardResult.action === 'deny') {
      result.finalStatus = 'denied';
      onProgress(`命令被拒绝: ${step.command}`);
      break;
    }

    if (guardResult.action === 'ask') {
      const approved = await onConfirm(step);
      if (!approved) {
        onProgress(`用户跳过: ${step.command}`);
        continue;
      }
    }

    // Execute...
    onProgress(`执行中: ${step.command}`);
  }

  // ── Phase 4: Progress Persistence ──
  if (steps.length > config.longTaskStepThreshold) {
    await progressWriter.save(/* snapshot */);
    result.progressUpdated = true;
  }

  // ── Phase 5: Verification Loop ──
  const verifyCmds = contextInjector.extractVerifyCommands();
  if (verifyCmds.length > 0) {
    for (const cmd of verifyCmds) {
      const vr = await verificationRunner.run(cmd, sessionId, config);
      result.verifyResults.push(vr);
      if (vr.status === 'fail') result.finalStatus = 'failed';
    }
  }

  return result;
}
```

### 3.8 与现有代码的对接点

| 现有代码 | 对接方式 | 变更级别 |
|---------|---------|---------|
| `useAiSubmit.ts` | `submitAiQuery()` 改为调用 `harnessPipeline()` | 中等 |
| `aiService.ts` | `SYSTEM_PROMPT` 移至 `defaults.ts`，由 contextInjector 管理 | 小 |
| `memoryService.ts` | `assemblePrompt()` 增加 AGENTS.md / PROGRESS.md 注入 | 小 |
| `SettingsModal.tsx` | 新增 "Harness 规则" 配置 Tab | 中 |
| `BottomInputArea.tsx` | 集成 `ConfirmDialog` 组件 | 小 |
| `ConfirmDialog.tsx` | 全新组件，渲染权限确认弹窗 | 新 |
| Rust `main.rs` | 注册 `harness_commands` 中的新命令 | 小 |
| Rust `lib.rs` | 新增 `harness_commands` 模块声明 | 小 |
| Rust `persistence.rs` | 已有 `read_memory_file` / `write_memory_file`，复用 | 无 |

### 3.9 Harness 后端命令 (`harness_commands.rs`)

```rust
// 新增 Tauri commands

/// 读取项目根目录的 AGENTS.md
#[tauri::command]
fn read_agents_md() -> Result<String, String>;

/// 写入 PROGRESS.md
#[tauri::command]
fn write_progress_md(content: String) -> Result<(), String>;

/// 读取 PROGRESS.md
#[tauri::command]
fn read_progress_md() -> Result<String, String>;

/// 静默执行验收命令（不通过 UI PTY）
/// 返回 { exitCode, stdout, stderr }
#[tauri::command]
async fn run_verify_cmd(
    session_id: String,
    command: String,
    timeout_secs: u64,
) -> Result<VerifyCmdResult, String>;
```

### 3.10 前端确认弹窗组件 (`ConfirmDialog.tsx`)

```
┌─────────────────────────────────────────────┐
│  ⚠ 权限确认                                 │
├─────────────────────────────────────────────┤
│                                             │
│  即将执行以下命令：                          │
│  ┌─────────────────────────────────────────┐│
│  │ $ rm -rf ./node_modules                ││
│  │ — 删除 node_modules 目录                ││
│  └─────────────────────────────────────────┘│
│                                             │
│  原因: 删除文件/目录操作                     │
│                                             │
│  [拒绝]              [允许本次]  [全部允许]  │
└─────────────────────────────────────────────┘
```

**交互选项**：
- **拒绝**：跳过此步骤，Pipeline 继续执行后续步骤
- **允许本次**：仅本次放行，后续 alwaysAsk 命令继续弹窗
- **全部允许**：本次会话中所有后续 alwaysAsk 命令自动放行

---

## 4. 现有核心数据流

### 4.1 AI 自然语言处理流程（当前 + Harness 后）

```
CommandInput
  │
  ├─ detectInputType() → AI NL (非 Shell 语法)
  │
  ▼
useAiSubmit.submitAiQuery()
  │
  ├─ Phase 0: 正则快速匹配 TERMINAL_CREATE 意图
  │   └─ 命中 → executeTerminalCreate() → 创建终端连接
  │
  ├─ ★ Phase 1: harnessPipeline()  ← Harness 接管
  │   ├─ Context Injector: 注入 AGENTS.md + PROGRESS.md
  │   ├─ LLM 调用: aiService.nlToTasks()
  │   ├─ Permission Manager: 权限校验 + ConfirmDialog
  │   ├─ Progress Writer: 长任务写 PROGRESS.md
  │   └─ Verification Runner: 验收命令 + 失败重试
  │
  └─ 输出结果到 outputStore → 渲染
```

### 4.2 终端输出流

```
PTY / SSH 输出流
  │
  ├─ MarkerScanner: 扫描 OSC 7701 标记 → block-cmd-started/completed 事件
  ├─ StreamCleaner: OSC 133 状态机 → block-output 事件
  ├─ output_sanitizer: 清洗噪音 → pti-output 事件
  │
  ▼
useSessionStream (前端)
  ├─ terminal.write(data) → xterm.js 渲染
  └─ sessionLogStore.appendLog() → 日志持久化
```

### 4.3 Session ID 命名规范

| 前缀 | 协议 | 示例 | 管理器 |
|------|------|------|--------|
| `session-` | 本地 PTY | `session-1` | PtyManager |
| `ssh-` | SSH 远程 | `ssh-3` | ConnectionManager |
| `telnet-` | Telnet | `telnet-2` | ConnectionManager |
| `serial-` | 串口 | `serial-1` | ConnectionManager |

---

## 5. 关键技术实现细节

### 5.1 服务器状态监控 (StatusBar + query_server_stats)

当活动终端为 SSH 连接时，StatusBar 每 5 秒轮询 `query_server_stats` Rust 命令。该命令通过单独的 SSH exec channel 执行纯 shell 脚本，收集：

- **CPU**: total / user / system / idle 百分比，核心数，负载均值，运行时长
- **MEM**: used / free / buffers / cached (MB，来自 `free -m`)
- **DISK**: 根分区摘要 + 前 3 个分区详情 (来自 `df -h`)
- **NET**: 监控网卡名 + 总 RX/TX 字节 + 实时速率
- **USERS**: 在线用户数 + 用户名/终端/登录时间列表

Tooltip 使用 `position: fixed` + JavaScript 动态定位（`getBoundingClientRect`），不受父容器 `overflow:hidden` 裁剪。

### 5.2 加密存储

```
存储文件：{HOME}/.LingShuTerm/workspace/connections.json
密钥文件：{HOME}/.LingShuTerm/workspace/.key

加密方案：AES-256-GCM (ring crate)
  - 密钥：首次运行时随机生成 256-bit 密钥
  - Nonce：每次加密随机生成 96-bit nonce
  - 密文：base64(nonce || ciphertext || tag)
```

### 5.3 记忆系统 (memoryService.ts)

三层记忆模型：

- **Short-Term Memory**: 环形缓冲，最近 10 轮对话（滑动窗口 + Token 预算 4000）
- **Long-Term Memory**: 持久化知识（偏好/命令/错误修复），最多 200 条
- **AGENT.md**: 每个会话级行为规范（与项目级 AGENTS.md 不同）

Harness 系统在此基础上新增：
- **AGENTS.md**（项目级）: 作为 System Prompt 注入，全局生效
- **PROGRESS.md**: 跨会话任务进度

### 5.4 命令块执行 (Block System)

Rust 层的 `block.rs` 使用 OSC 7701 协议包装命令：
1. 发送 `\x1b]7701;S;<command_id>\x07` (开始标记)
2. 执行用户命令
3. 发送 `\x1b]7701;E;<command_id>;<exit_code>\x07` (结束标记)

前端 `MarkerScanner` 解析标记，触发 `block-cmd-started` / `block-cmd-completed` 事件。Harness 的 Verification Runner 复用此机制静默执行验收。

### 5.5 结构化输出渲染

当 `OutputRenderer` 收到命令输出时，按优先级检测类型：

1. JSON → `JsonViewer`
2. `df -h` → `DiskUsageCard`
3. `ps aux` → `ProcessTable`
4. `git status` → `GitStatus`
5. `du -sh` → `DirectoryChart`
6. `ls -al` → `FileListTable`
7. `ls` 短格式 → `FileGrid`
8. 代码文件 → `CodeBlock` (Shiki)
9. Markdown → `MarkdownRenderer`
10. Mermaid → `MermaidDiagram`
11. 其他 → `AnsiText`

### 5.6 终端日志审计

- 实时记录 xterm.js 输入输出到本地文件
- 自动轮转：超过 10MB 重命名为 `name_YYYYMMDD_HHmmss.log`
- Tab 级独立开关（绿色脉冲圆点 = 记录中）
- UI 查看器：右侧滑出面板展示文件树和日志内容

---

## 6. 开发规范

### 6.1 命名规范

- **组件**: PascalCase，如 `Layout`, `StatusBar`, `ConfirmDialog`
- **Hooks**: `use` 前缀，如 `useTerminal`, `useAiSubmit`
- **Store**: `useXxxStore` 形式导出
- **工具函数**: camelCase，如 `connectionLabel`, `getWriteCommand`
- **类型/接口**: PascalCase，如 `ConnectionConfig`, `GuardResult`

### 6.2 状态管理规范

- 不可变更新：`set(state => ({...state, ...}))`
- 持久化时机：连接配置立即持久化；会话日志 16KB/200ms 缓冲批量写

### 6.3 安全规范

- AI Agent 执行命令前必须经过 Permission Manager 校验
- `alwaysDeny` 规则不可被用户绕过
- 所有敏感配置使用 AES-256-GCM 加密存储
- Rust 端 session_id 做严格白名单校验（A-Z a-z 0-9 _ - .）

### 6.4 测试规范

- **前端**: `npx vitest run` (jsdom + @testing-library)
- **Rust**: `cargo test`
- **Harness 模块**: 每个中间件独立单元测试

---

## 7. 构建 & 运行命令

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

## 8. 后续发展路线图

### Phase 1: Harness 中间件核心 (当前)
- [x] 设计 Harness 架构
- [ ] 实现 `contextInjector` + `permissionManager` + `progressWriter` + `verificationRunner`
- [ ] 实现 `harnessPipeline` 主编排器
- [ ] 实现 `ConfirmDialog` 前端确认弹窗
- [ ] 实现 `harness_commands.rs` 后端命令

### Phase 2: 集成与配置
- [ ] 将 `useAiSubmit` 迁移到 `harnessPipeline`
- [ ] SettingsModal 新增 Harness 规则配置面板
- [ ] 编写默认 `AGENTS.md` 模板
- [ ] 审计日志查看器

### Phase 3: 长期增强
- [ ] 多 Agent 协作
- [ ] 插件生态系统
- [ ] Android 平台支持（已有 executor.rs stubs）

---

**文档结束**

*本架构设计文档基于对 LingshuTerm 代码库的深入分析，结合 Harness Engineering 设计理念重新生成，作为后续所有开发工作的核心指导文件。*
