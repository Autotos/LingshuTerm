# 灵枢智能终端 2.0 (LingshuTerm 2.0)

跨平台智能终端工具 —— 集成多协议远程连接、AI 任务编排、网络服务管理与终端日志审计于一体的下一代桌面终端。

## 核心功能

### 终端核心
- **本地 PTY** — 基于 `portable-pty`，自动检测 Bash / Zsh / PowerShell / Sh
- **WebGL 渲染** — xterm.js + WebGL Addon，Berkeley Mono 等宽字体，暗色主题
- **多会话多 Tab** — 一个 Session 可包含多个 Terminal Tab，侧边栏管理 + 顶部 Tab 栏切换
- **Chunked Stream** — ANSI 转义装饰分隔线区分每条命令的输入输出块
- **代码编辑器** — Monaco Editor，右侧抽屉式滑出，支持多文件 Tab

### 多协议远程连接
- **SSH** — 纯 Rust `russh` 客户端，密码认证
- **Telnet** — TCP 直连 + IAC 协商
- **串口 (Serial)** — `serialport` 波特率/数据位/停止位/校验位配置
- **会话保存** — 统一的 `session.json` 树形存储，支持启动自动恢复

### 服务器管理面板
一键启停 9 种网络服务，可视化配置：

| 服务 | 默认端口 | 配置项 |
|------|---------|--------|
| TFTP | 69 | 根目录、下载/上传提示、自动停止 |
| FTP | 21 | 用户管理、匿名访问、UTF-8、自动停止 |
| HTTP | 8080 | 端口、根目录 |
| SSH/SFTP | 22 | 端口 |
| Telnet | 23 | 端口 |
| NFS | 2049 | 端口 |
| VNC | 5900 | 端口 |
| Cron | — | 端口 |
| Iperf | 5201 | 端口 |

### 终端日志审计
- **实时记录** — 拦截 xterm.js 输出流写入日志文件
- **日志轮转** — 超过 10MB 自动重命名为 `name_YYYYMMDD_HHmmss.log`
- **Tab 级控制** — 每个 Terminal Tab 独立的录制开关（绿色脉冲 = 记录中）
- **日志查看器** — 右侧滑出面板，文件树 + 内容预览 + 右键菜单

### Session Manager
- 统一的 `session.json` 文件存储
- 树形结构：Session 节点 → Terminal 子节点
- 双击会话/终端：自动重建连接
- 旧数据自动迁移

## 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | Tauri v2 — Rust 后端 + WebView 前端 |
| **前端** | React 19 + TypeScript 5.8 + Vite 7 |
| **状态管理** | Zustand 5（含 `persist` 中间件） |
| **终端渲染** | xterm.js 5.5 + WebGL Addon + Fit Addon |
| **代码编辑器** | Monaco Editor 0.55 |
| **样式** | Tailwind CSS 3.4 + CSS 自定义属性暗色主题 |
| **图标** | Lucide React |
| **Rust PTY** | portable-pty 0.8 |
| **SSH** | russh 0.60（纯 Rust，无 OpenSSL 依赖） |
| **串口** | serialport 4.3 |
| **加密** | ring 0.17 — AES-256-GCM 密码存储 |
| **异步** | Tokio 1 |
| **序列化** | serde + serde_json |
| **日志** | tracing + tracing-subscriber |
| **正则** | regex 1 |

## 环境要求

- **Node.js** >= 18
- **Rust** >= 1.75（推荐 stable 最新版）
- **系统依赖**（仅编译时）：
  - Windows: 无需额外依赖（已使用 ring 后端替代 OpenSSL）
  - Linux: `libwebkit2gtk-4.1-dev`, `libudev-dev` 等（[参考 Tauri 文档](https://v2.tauri.app/start/prerequisites/)）
  - macOS: Xcode Command Line Tools

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri:dev
```

启动 Vite 开发服务器（端口 1420）+ Tauri 原生窗口，支持热更新。

### 生产构建

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`：
- **`nsis/`** — Windows 安装包 (`.exe`)
- **`msi/`** — Windows MSI 安装包
- **`portable/`** — 免安装便携版

## 项目结构

```
LingshuTerm2.0/
├── src/                              # 前端源码
│   ├── components/
│   │   ├── Layout.tsx                # 主布局（TitleBar + Sidebar + Main + StatusBar）
│   │   ├── TitleBar.tsx              # 自定义标题栏（无边框窗口）
│   │   ├── Sidebar.tsx               # 侧边栏（会话列表 + 新建/保存/删除）
│   │   ├── UnifiedSessionPanel.tsx   # 统一终端面板（Chunked Stream）
│   │   ├── TerminalRenderer.tsx      # xterm.js 渲染器
│   │   ├── TerminalTabBar.tsx        # 终端 Tab 栏（含日志录制开关）
│   │   ├── TerminalConnectModal.tsx  # 新建终端连接配置弹窗
│   │   ├── EditorPanel.tsx           # Monaco 编辑器面板
│   │   ├── BottomInputArea.tsx       # 底部命令输入栏
│   │   ├── SessionManager.tsx        # 会话管理器（session.json 树形结构）
│   │   ├── SessionTypeModal.tsx      # 新建会话弹窗
│   │   ├── SettingsModal.tsx         # 设置面板（AI / Terminal / Logging）
│   │   ├── ServerManagementModal.tsx # 服务器管理面板（含 TFTP/FTP 配置）
│   │   ├── LogViewer.tsx             # 日志查看器
│   │   ├── StatusBar.tsx             # 底部状态栏
│   │   ├── ContextMenu.tsx           # 通用右键菜单
│   │   └── TaskBoard.tsx             # AI 任务看板
│   ├── hooks/
│   │   ├── useTerminal.ts            # xterm 终端生命周期 + I/O 路由
│   │   ├── useSessionStream.ts       # 统一会话事件流监听
│   │   ├── useBlockSession.ts        # 底部输入栏命令执行
│   │   ├── useEditor.ts              # Monaco Editor 初始化
│   │   └── usePersistenceBootstrap.ts# 启动恢复 + 持久化订阅
│   ├── lib/
│   │   ├── loggerService.ts          # 日志服务（write/list/read）
│   │   ├── serverService.ts          # 服务器管理 API 封装
│   │   ├── persistenceService.ts     # 持久化薄封装
│   │   ├── persistenceSubscribe.ts   # Store 变更 → 磁盘写回
│   │   ├── sessionService.ts         # 会话创建
│   │   ├── sessionUtils.ts           # 会话 ID 前缀路由
│   │   └── monaco.ts                 # Monaco 配置
│   ├── stores/
│   │   ├── sessionStore.ts           # 会话 + 终端管理
│   │   ├── sessionLogStore.ts        # 统一事件时间线
│   │   ├── settingsStore.ts          # 应用设置（含日志配置）
│   │   ├── connectionStore.ts        # 已保存连接
│   │   ├── uiStore.ts                # UI 状态
│   │   ├── editorStore.ts            # 编辑器状态
│   │   ├── taskStore.ts              # AI 任务队列
│   │   └── commandStore.ts           # @deprecated 旧 Blocks 兼容
│   └── models/
│       ├── session.ts                # SessionInfo + TerminalInstance
│       ├── sessionData.ts            # SessionEvent + CommandGroup
│       ├── connection.ts             # 连接协议类型
│       ├── block.ts                  # 命令块模型（保留兼容）
│       └── terminal.ts               # 终端事件荷载
├── src-tauri/                        # Rust 后端
│   ├── src/
│   │   ├── main.rs                   # 入口 + Tauri 命令注册
│   │   ├── lib.rs                    # 模块声明
│   │   ├── shell.rs                  # PtyManager — 本地伪终端
│   │   ├── block.rs                  # OSC 7701 命令块标记
│   │   ├── commands.rs               # PTY write/resize/destroy
│   │   ├── connection.rs             # ConnectionManager — SSH/Telnet/Serial
│   │   ├── connection_commands.rs    # 连接 write/resize/disconnect
│   │   ├── session_commands.rs       # 统一 create_session + list_local_shells
│   │   ├── persistence.rs            # session.json 读写/迁移 + 密码加密
│   │   ├── storage.rs                # AES-256-GCM 加密存储
│   │   ├── logger.rs                 # 日志写入/轮转/ANSI 清洗
│   │   ├── server_manager.rs         # 服务器管理（启停/状态/配置）
│   │   ├── stream/                   # 统一事件流模块
│   │   │   ├── core.rs               # UnifiedStreamCore
│   │   │   └── event.rs              # SessionEvent 类型定义
│   │   ├── output_sanitizer.rs       # PTY 输出清洗
│   │   ├── stream_cleaner.rs         # OSC 133 状态机
│   │   └── utils.rs                  # 工作空间路径
│   ├── capabilities/default.json     # Tauri 权限配置
│   ├── Cargo.toml                    # Rust 依赖
│   └── tauri.conf.json               # Tauri 应用配置
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.js
```

## 使用指南

### 会话与终端管理

1. 启动后自动创建 `Default` 会话
2. 点击 `+ New Session` 创建新会话（仅名称）
3. 点击会话右侧的 `+` 或 Tab 栏的 `+` 打开连接配置弹窗
4. 选择连接类型（Remote SSH/Telnet/Serial 或 Local Shell），填写参数，点击 Connect
5. 终端 Tab 自动创建并建立连接，Tab 栏支持切换/关闭
6. 侧边栏每个会话有保存（💾）、添加终端（+）、删除（🗑）按钮
7. 双击会话 → 自动重建所有保存的终端连接

### 服务器管理

1. 点击标题栏 **Server** 图标打开服务器管理面板
2. 左侧列表显示 9 种服务，每行有状态指示灯和启停按钮
3. 点击 **TFTP** 进入详细配置：根目录选择、下载/上传提示、端口、自动停止
4. 点击 **FTP** 进入用户管理：添加/编辑/删除用户、匿名访问、UTF-8 编码
5. 点击 ▶ 启动服务，点击 ■ 停止服务
6. 右侧 Server output 区域实时显示运行日志

### 日志审计

1. 点击标题栏 **ScrollText** 图标打开日志查看器
2. 左侧文件树按 Session 分组展示日志文件
3. 点击 Terminal Tab 上的 **录制圆点**（绿色脉冲 = 记录中）
4. 日志自动写入 `{workspace}/logs/{SessionName}/{TerminalName}.log`
5. 文件超过 10MB 自动轮转，历史文件在 "History" 分组下

### Settings 设置

点击标题栏齿轮图标打开设置弹窗：

- **AI** — 供应商配置、API Key、模型选择、连接测试
- **Terminal** — Shell 路径、字体、滚动缓冲
- **Logging** — 日志开关、根路径、最大文件大小

## 常用命令

```bash
npm run dev           # Vite 开发服务器（仅前端）
npm run tauri:dev     # Tauri + Vite 开发模式
npm run tauri:build   # 生产构建（Windows .exe/.msi）
npm run build         # TypeScript 检查 + Vite 构建
npm run test          # Vitest watch 模式
npm run test:run      # Vitest 单次运行
```

## 会话 ID 路由

| 前缀 | 类型 | Write 命令 | Resize 命令 |
|------|------|-----------|-------------|
| `session-*` | 本地 PTY | `write_to_terminal` | `resize_terminal` |
| `ssh-*` | SSH | `write_to_connection` | `resize_connection` |
| `telnet-*` | Telnet | `write_to_connection` | `resize_connection` |
| `serial-*` | 串口 | `write_to_connection` | `resize_connection` |

路由逻辑封装在 `sessionUtils.ts` 中。

## 许可证

MIT
