# 16 — 设置面板与日志查看器

## 功能职责

设置面板管理用户偏好配置（终端外观、AI 服务商、Harness 规则、日志参数），通过 Zustand + localStorage 持久化。日志查看器提供终端录制文件的可视化浏览和搜索。

## SettingsModal ([SettingsModal.tsx](../src/components/SettingsModal.tsx))

### 配置 Tab 清单

| Tab | 持久化字段 | 说明 |
|-----|----------|------|
| 终端 (Terminal) | `terminal.fontSize` / `fontFamily` / `scrollback` / `autoFit` / `defaultColumns` / `defaultRows` | xterm.js 外观设置 |
| Shell | `shell.path` / `shell.args` | 默认 Shell 路径和参数 |
| AI | `ai` (AiConfig) | 服务商选择、模型、API Key、maxTokens、temperature |
| Harness | `harness` (HarnessConfig) | 权限规则集、阈值、验收配置 |
| 日志 (Logging) | `logging.enabled` / `logPath` / `maxSizeMb` | 终端录制开关和参数 |

### AI 服务商配置

支持 9 种预设服务商 + 自定义 URL：
- 切换预设自动填充 baseUrl 和默认 model
- API Key 输入框（password 类型）
- "测试连接" 按钮 → `aiService.testConnection()` → 显示 "ok" 验证结果

### Harness 规则配置

允许用户查看和编辑权限规则列表：
- 每个规则显示 label、pattern、action（颜色标记）、reason
- 支持新增/删除自定义规则
- 通过 `useSettingsStore.updateHarnessSettings()` 持久化

## 日志查看器 ([LogViewer.tsx](../src/components/LogViewer.tsx))

### 功能

- 右侧滑出面板（640px）
- 左侧：文件树（Session 分组 + 历史轮转文件）
- 右侧：日志内容 `<pre>` 只读预览
- 右键菜单：打开目录 / 复制路径

### Rust 后端命令 ([logger.rs](../src-tauri/src/logger.rs))

| 命令 | 说明 |
|------|------|
| `write_log(logPath, sessionName, terminalName, data, maxSizeMb)` | 追加日志，自动 ANSI 清洗 + 轮转 |
| `list_logs()` | 列出所有日志文件 |
| `read_log_file(path)` | 读取日志文件完整内容 |
| `open_in_explorer(path)` | 系统文件管理器打开路径 |

### 日志轮转

```
{logPath}/{sessionName}/{terminalName}.log           ← 当前日志
{logPath}/{sessionName}/{terminalName}_20260526_143022.log  ← 轮转备份（>10MB 触发）
```

## 扩展点与约束

### 约束

- **设置存储**：`useSettingsStore` 使用 `localStorage` (key: `lingshu-settings`) 作为即时存储，Rust 后端 `persistence.rs` 的 `load_settings`/`save_settings` 作为持久化备份
- **日志文件名清洗**：`:`、`/`、`\`、`*`、`?`、`"`、`<`、`>`、`|` 自动替换为 `_`
- **日志最大大小**：默认 10MB，通过 `logging.maxSizeMb` 配置
