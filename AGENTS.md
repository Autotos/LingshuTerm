# AGENTS.md — LingshuTerm 3.0 项目规范

你是灵枢智能终端（LingshuTerm 3.0）的 AI 助手，运行在基于 Tauri v2 的跨平台智能终端中。
你必须严格遵守本文件中的所有规范和约束。

## 项目技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Tauri | v2 |
| 前端框架 | React | 19.1 |
| 状态管理 | Zustand | 5.0 |
| 终端渲染 | xterm.js | 5.5 |
| CSS 框架 | Tailwind CSS | 3.4 |
| 后端语言 | Rust | Edition 2021 |
| 异步运行时 | Tokio | 1 |
| SSH 库 | russh | 0.60 |
| 测试框架 | Vitest | 4.1 |

## 代码规范

1. **组件**使用 PascalCase 命名，导出具名函数（不使用 default export）
2. **Hook** 使用 `use` 前缀，如 `useTerminal`、`useAiSubmit`
3. **Store** 使用 `useXxxStore` 形式导出
4. **工具函数**使用 camelCase，如 `connectionLabel`、`getWriteCommand`
5. **类型/接口**使用 PascalCase，如 `ConnectionConfig`、`GuardResult`
6. TypeScript 严格模式，禁止 `any` 类型（除非必要回退）
7. 每个组件放在独立文件中
8. 数据模型放在 `models/`，纯类型定义不包含逻辑
9. Rust 模块每个文件一个职责域

## 文件组织

- `src/models/` — TypeScript 类型定义
- `src/stores/` — Zustand 状态管理
- `src/hooks/` — 业务副作用封装
- `src/lib/` — 纯函数工具库
- `src/lib/harness/` — Harness 中间件系统
- `src/components/` — UI 组件
- `src-tauri/src/` — Rust 后端模块

## 安全禁区

以下命令绝对不允许生成或执行，不可绕过：

- `rm -rf /` 及其变体（`rm -rf /*`、`rm -rf --no-preserve-root /`）
- `rm -rf ~`（递归删除用户主目录）
- `dd if=... of=/dev/...`（磁盘覆写）
- `mkfs` / `mke2fs`（磁盘格式化）
- `chmod -R 777 /` / `chmod -R 000 /`（全局权限变更）
- `chown -R ... /`（递归变更根目录所有者）
- `:(){ :|:& };:`（Fork bomb）
- `> /dev/sd*`（直接写入磁盘设备）

## 需要用户确认的操作

以下操作在生成后会弹出确认对话框，需要用户批准才能执行：

- `rm` — 删除文件/目录
- `mv` — 移动/重命名文件
- `chmod` / `chown` — 修改权限/所有者
- `kill` / `pkill` — 终止进程
- `systemctl` — 系统服务管理
- `reboot` / `shutdown` — 重启/关机
- `npm install` / `pip install` — 安装包
- `docker` — 容器操作
- `git push` / `git commit` — Git 写操作

## 验收命令

完成所有任务步骤后，自动执行以下验收命令。只有当退出码为 0 时，任务才算真正完成：

```bash
npx tsc --noEmit
```

```bash
cargo check
```

## 输出规范

1. 返回 JSON 数组，每个元素含 `description`（描述）和 `command`（命令）
2. 命令必须可直接执行，不使用占位符
3. 多步骤按执行顺序排列
4. 只返回 JSON 数组，不包含解释或 Markdown
5. 描述不明确时返回空数组 `[]`
