# 灵枢智能终端 (LingshuTerm)

跨平台智能 Agent 终端 —— 融合传统终端、AI 自然语言任务编排与多协议远程连接于一体的下一代桌面终端。

## 功能概览

### 终端核心
- **本地 PTY 终端** — 基于 `portable-pty` 的全功能伪终端，支持 Bash / Zsh / PowerShell / Sh 自动检测
- **WebGL 渲染** — xterm.js + WebGL 加速，Berkeley Mono 等宽字体，暗色主题
- **多会话管理** — 侧边栏 Sessions 标签页支持多个终端会话同时运行，一键切换
- **Command Blocks** — Warp 风格的命令块，通过 OSC 7701 标记每条命令的起止，结构化展示输入/输出/退出码

### AI Agent Mode
- **自然语言 → Shell 命令** — 输入 `/ai 查看当前目录最大的5个文件`，AI 自动生成可执行任务列表
- **自动输入类型检测** — 智能区分 Shell 命令与自然语言（中英文），无需手动切换模式
- **OpenAI 兼容接口** — 支持任意 OpenAI API 兼容后端
- **预置 9 个 AI 供应商** — 百炼 (DashScope) / 火山方舟 (Ark) / 智谱 (GLM) / MiniMax / Kimi (Moonshot) / OpenAI / Ollama / LM Studio / llama.cpp
- **本地模型支持** — 无需 API Key 即可接入 `http://localhost:*` 的本地推理服务

### TaskBoard 任务看板
- **任务队列** — AI 生成的命令按顺序自动执行，侧边栏 Tasks 标签页实时展示进度
- **状态管理** — pending → running → success / error，带状态图标与输出折叠
- **失败暂停** — 某步失败自动暂停队列，用户可选择重试 / 跳过 / 停止
- **任务组管理** — 每次 AI 查询生成一个任务组，保留完整执行历史

### 多协议远程连接
- **SSH** — 基于 `russh` (纯 Rust) 的 SSH 2.0 客户端，密码认证，异步 I/O
- **Telnet** — 原生 TCP 连接，支持 IAC 协商 (ECHO / SUPPRESS_GO_AHEAD)
- **COM 串口** — 基于 `serialport` 的串口通信，支持波特率 / 数据位 / 停止位 / 校验位配置
- **已保存连接** — PuTTY 风格的连接管理器，localStorage 持久化，侧边栏一键快速连接
- **统一终端体验** — 所有协议共享 xterm.js 终端渲染，write/resize 命令按会话 ID 前缀自动路由

### 代码编辑器
- **Monaco Editor** — VS Code 同款编辑器内核，支持语法高亮

### 其他
- **自定义标题栏** — 无边框窗口 + 自定义拖拽区域
- **Settings Modal** — AI 供应商配置、连接测试、终端字体/滚动缓冲设置
- **状态栏** — 实时时钟、连接状态指示、协议类型显示

## 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | [Tauri 2](https://v2.tauri.app/) — Rust 后端 + WebView 前端 |
| **前端** | React 19 + TypeScript 5.8 + Vite 7 |
| **状态管理** | Zustand 5（含 `persist` 中间件） |
| **终端** | xterm.js 5.5 + WebGL Addon + Fit Addon |
| **编辑器** | Monaco Editor 0.55 |
| **样式** | TailwindCSS 3.4 + CSS 自定义属性暗色主题 |
| **图标** | Lucide React |
| **Markdown** | react-markdown + remark-gfm |
| **测试** | Vitest 4 + Testing Library (React) + jsdom |
| **Rust PTY** | portable-pty 0.8 |
| **SSH** | russh 0.60（纯 Rust，无 OpenSSL 依赖） |
| **串口** | serialport 4.3 |
| **日志** | tracing + tracing-subscriber |

## 项目结构

```
LingshuTerm2.0/
├── src/                          # 前端源码
│   ├── components/               # React 组件
│   │   ├── Layout.tsx            #   主布局（Sidebar + Main + StatusBar）
│   │   ├── Sidebar.tsx           #   侧边栏（Sessions / Tasks / Connections）
│   │   ├── TerminalPanel.tsx     #   终端面板
│   │   ├── BlocksPanel.tsx       #   Command Blocks 面板
│   │   ├── CommandBlock.tsx      #   单个命令块组件
│   │   ├── CommandInput.tsx      #   命令输入框（支持 AI 检测）
│   │   ├── TaskBoard.tsx         #   AI 任务看板
│   │   ├── ConnectionForm.tsx    #   连接配置弹窗（SSH/Telnet/Serial）
│   │   ├── EditorPanel.tsx       #   Monaco 编辑器面板
│   │   ├── SettingsModal.tsx     #   设置弹窗
│   │   ├── StatusBar.tsx         #   底部状态栏
│   │   └── TitleBar.tsx          #   自定义标题栏
│   ├── hooks/                    # React Hooks
│   │   ├── useTerminal.ts        #   xterm 终端生命周期 + I/O 路由
│   │   ├── useBlockSession.ts    #   Command Block 事件监听
│   │   ├── useAiSubmit.ts        #   AI 查询提交
│   │   ├── useTaskQueue.ts       #   任务队列自动执行引擎
│   │   ├── useEditor.ts          #   Monaco Editor 初始化
│   │   └── useTerminalResize.ts  #   终端 resize 观察
│   ├── lib/                      # 工具库
│   │   ├── aiDetect.ts           #   输入类型检测（Shell vs AI）
│   │   ├── aiService.ts          #   OpenAI 兼容 API 客户端
│   │   ├── connectionService.ts  #   连接命令 Tauri invoke 封装
│   │   ├── sessionUtils.ts       #   会话 ID 前缀路由工具
│   │   ├── ansi.ts               #   ANSI 转义处理
│   │   ├── monaco.ts             #   Monaco 配置
│   │   └── xterm.ts              #   xterm 配置
│   ├── stores/                   # Zustand 状态存储
│   │   ├── sessionStore.ts       #   会话管理
│   │   ├── taskStore.ts          #   任务队列
│   │   ├── commandStore.ts       #   Command Blocks
│   │   ├── connectionStore.ts    #   已保存连接（localStorage 持久化）
│   │   ├── settingsStore.ts      #   应用设置
│   │   └── uiStore.ts            #   UI 状态（侧边栏/视图/弹窗）
│   ├── models/                   # TypeScript 类型定义
│   │   ├── session.ts            #   会话信息
│   │   ├── block.ts              #   命令块
│   │   ├── task.ts               #   任务项 / 任务组
│   │   ├── connection.ts         #   连接配置（SSH/Telnet/Serial）
│   │   ├── terminal.ts           #   终端事件 Payload
│   │   └── editor.ts             #   编辑器类型
│   ├── test/                     # 测试基础设施
│   │   └── setup.ts              #   Vitest 全局 setup（mock Tauri API）
│   ├── index.css                 # 全局样式 + CSS 变量暗色主题
│   ├── App.tsx                   # 应用入口
│   └── main.tsx                  # React 挂载点
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               #   入口 — 状态注册 + 命令注册
│   │   ├── lib.rs                #   模块声明
│   │   ├── shell.rs              #   PtyManager — 本地伪终端管理
│   │   ├── block.rs              #   BlockTracker — OSC 7701 命令块追踪
│   │   ├── commands.rs           #   PTY 相关 Tauri 命令
│   │   ├── connection.rs         #   ConnectionManager — SSH/Telnet/Serial
│   │   ├── connection_commands.rs#   连接相关 Tauri 命令
│   │   └── executor.rs           #   Executor trait（桌面/Android 抽象）
│   ├── Cargo.toml                #   Rust 依赖配置
│   └── tauri.conf.json           #   Tauri 应用配置
├── vitest.config.ts              # Vitest 测试配置
├── vite.config.ts                # Vite 构建配置
├── tsconfig.json                 # TypeScript 配置
├── tailwind.config.js            # TailwindCSS 配置
├── postcss.config.js             # PostCSS 配置
└── package.json                  # npm 依赖与脚本
```

## 环境要求

- **Node.js** >= 18
- **Rust** >= 1.75 (推荐 stable 最新版)
- **Tauri CLI** v2 (`npm install -D @tauri-apps/cli`)
- **系统依赖** (仅编译时):
  - Windows: NASM 汇编器 (`choco install nasm`)
  - Linux: `libwebkit2gtk-4.1-dev`, `libssl-dev`, `libudev-dev` 等 ([参考 Tauri 官方文档](https://v2.tauri.app/start/prerequisites/))
  - macOS: Xcode Command Line Tools

## 快速开始

### 1. 克隆并安装依赖

```bash
git clone <仓库地址>
cd LingshuTerm2.0
npm install
```

### 2. 开发模式

```bash
npm run tauri:dev
```

这会同时启动 Vite 开发服务器 (端口 1420) 和 Tauri 原生窗口，支持热更新。

### 3. 生产构建

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。

### 4. 仅前端开发

```bash
npm run dev       # 启动 Vite 开发服务器
npm run build     # TypeScript 检查 + Vite 生产构建
npm run preview   # 预览生产构建
```

### 5. 运行测试

```bash
npm run test      # Vitest watch 模式
npm run test:run  # 单次运行（CI 友好）
```

## 使用指南

### 本地终端

启动后默认创建一个本地 PTY 会话。切换到 **Terminal** 视图即可使用完整的终端功能，支持所有 Shell 特性（补全、快捷键、颜色等）。

侧边栏 **Sessions** 标签页展示所有活跃会话，点击切换。底部 `+ New` 按钮可创建新会话。

### Command Blocks

切换到 **Blocks** 视图，在底部输入框输入命令并回车。每条命令以结构化的"命令块"展示，包含：
- 输入的命令文本
- 实时输出流
- 执行状态 (运行中 / 成功 / 失败) 与退出码

### AI Agent Mode

在 Blocks 视图的输入框中，有两种方式触发 AI：

1. **显式前缀** — 输入 `/ai ` 后跟自然语言描述：
   ```
   /ai 查看当前目录最大的5个文件
   /ai 创建一个 Node.js 项目并安装 express
   ```

2. **自动检测** — 直接输入中文或英文自然语言，系统会自动识别：
   ```
   帮我查看磁盘空间
   how to install docker
   ```

AI 将生成一组 Shell 命令，显示在侧边栏 **Tasks** 标签页中。你可以：
- 查看每步命令的描述和内容
- 观察自动执行进度
- 任务失败时选择 **重试** / **跳过** / **暂停**
- 展开查看每步的输出详情

> 首次使用需要在 Settings 中配置 AI 供应商。点击标题栏齿轮图标打开设置，选择预置供应商或填入自定义 API 地址。本地模型 (Ollama / LM Studio) 无需 API Key。

### 远程连接

1. 点击侧边栏 **Connect** 标签页
2. 点击底部 `+ New Connection` 打开连接配置弹窗
3. 选择协议 (SSH / Telnet / Serial) 并填写参数：

**SSH:**
| 字段 | 说明 | 默认值 |
|------|------|--------|
| Host | 远程主机地址或域名 | — |
| Port | SSH 端口 | 22 |
| Username | 登录用户名 | root |
| Password | 登录密码 | — |

**Telnet:**
| 字段 | 说明 | 默认值 |
|------|------|--------|
| Host | 远程主机地址 | — |
| Port | Telnet 端口 | 23 |

**Serial (COM):**
| 字段 | 说明 | 默认值 |
|------|------|--------|
| Serial Port | 串口设备 (下拉自动探测) | — |
| Baud Rate | 波特率 | 115200 |
| Data Bits | 数据位 | 8 |
| Stop Bits | 停止位 | 1 |
| Parity | 校验 | None |

4. 点击 **Connect** 直接连接，或点击 **Save** 保存到连接列表以便后续快速连接
5. 连接成功后自动切换到对应终端会话，状态栏显示协议类型

已保存的连接在侧边栏列表中展示，单击即可快速连接，鼠标悬停显示删除按钮。

### Settings 设置

点击标题栏齿轮图标打开设置弹窗：

**AI 标签页:**
- Provider Preset — 快速选择预置供应商
- API Base URL — 自定义接口地址
- API Key — 认证密钥（本地模型可留空）
- Model — 模型名称
- Temperature / Max Tokens — 生成参数
- Test Connection — 验证 API 连通性

**Terminal 标签页:**
- Shell Path — 自定义 Shell 路径（留空自动检测）
- Font Family / Font Size — 终端字体
- Scrollback Lines — 滚动缓冲行数

## 架构说明

### Rust 后端

```
main.rs
  ├── PtyManager (shell.rs)          — 本地伪终端进程管理
  │     └── BlockTracker (block.rs)  — OSC 7701 命令块标记追踪
  ├── ConnectionManager (connection.rs) — 多协议远程连接管理
  │     ├── SSH   → russh async client + tokio::spawn reader
  │     ├── Telnet → std::net::TcpStream + IAC negotiation
  │     └── Serial → serialport crate + std::thread reader
  └── Tauri Commands
        ├── commands.rs              — create/write/resize/destroy session
        └── connection_commands.rs   — connect/disconnect/write/resize/list_serial_ports
```

所有终端输出通过 Tauri 事件系统 (`pty-output`, `session-ended`, `session-error`) 推送到前端，前端按 `session_id` 路由到对应的 xterm 实例。

### 前端数据流

```
用户输入
  ↓
aiDetect.ts → Shell 命令 → invoke('write_to_terminal') → PTY
            → AI 查询   → aiService.nlToTasks() → taskStore → useTaskQueue 自动执行
                                                              ↓
                                        invoke('execute_block_command') → PTY
                                                              ↓
                                        Tauri Events → commandStore → BlocksPanel 渲染
```

### 会话 ID 路由

会话 ID 前缀决定命令的路由目标：

| 前缀 | 类型 | Write 命令 | Resize 命令 |
|------|------|-----------|-------------|
| `session-*` | 本地 PTY | `write_to_terminal` | `resize_terminal` |
| `ssh-*` | SSH | `write_to_connection` | `resize_connection` |
| `telnet-*` | Telnet | `write_to_connection` | `resize_connection` |
| `serial-*` | 串口 | `write_to_connection` | `resize_connection` |

路由逻辑封装在 `sessionUtils.ts` 中，`useTerminal.ts` 自动调用。

## 开发相关

### 常用命令

```bash
npm run dev          # Vite 开发服务器
npm run tauri:dev    # Tauri + Vite 开发模式
npm run tauri:build  # 生产构建
npm run build        # 仅前端构建 (tsc + vite)
npm run test         # Vitest watch
npm run test:run     # Vitest 单次运行
```

### 添加新的 Tauri 命令

1. 在 `src-tauri/src/` 对应模块中实现 `#[tauri::command]` 函数
2. 在 `main.rs` 的 `generate_handler!` 宏中注册
3. 在 `src/lib/` 中添加 `invoke()` 封装
4. 在组件中调用

### 添加新的连接协议

1. 在 `connection.rs` 的 `ConnectionConfig` 枚举中添加新变体
2. 实现 `ConnectionManager::connect_xxx()` 方法
3. 更新前端 `models/connection.ts` 的类型定义
4. 在 `ConnectionForm.tsx` 中添加对应的表单字段
5. 在 `sessionUtils.ts` 的 `CONNECTION_PREFIXES` 中添加新前缀

### 测试架构

- **测试框架**: Vitest 4 + jsdom 环境
- **组件测试**: @testing-library/react
- **全局 Mock**: Tauri API (`invoke`, `listen`) 在 `src/test/setup.ts` 中全局 mock
- **测试文件**: 按模块就近放置在 `__tests__/` 目录中

当前测试覆盖：
- `aiDetect.test.ts` — AI 输入类型检测 (15 tests)
- `aiService.test.ts` — AI API 调用与响应解析 (13 tests)
- `sessionUtils.test.ts` — 会话路由辅助函数 (11 tests)
- `connection.test.ts` — 连接模型工具函数 (8 tests)
- `connectionStore.test.ts` — 连接存储 CRUD 操作 (8 tests)

## 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- 或 [RustRover](https://www.jetbrains.com/rust/) / [CLion](https://www.jetbrains.com/clion/) + Tauri 插件
