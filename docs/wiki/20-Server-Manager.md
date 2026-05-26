# 20 — 集成服务器管理

## 功能职责

集成服务器管理面板提供 9 种网络服务的一键启停，包括进程管理、端口检测和运行日志查看。

## 核心数据结构

### ServerManager (Rust) ([server_manager.rs](../src-tauri/src/server_manager.rs))

```rust
struct ServerManager {
    processes: HashMap<String, Child>,     // 运行中的服务进程
    configs: HashMap<String, ServerConfig>,// 服务配置
}
```

### 服务配置 ([serverService.ts](../src/lib/serverService.ts))

```typescript
interface ServiceConfig {
  port: number;
  rootDir?: string;
  args: string[];
  showDownloadMsg?: boolean;
  showUploadMsg?: boolean;
  autoStopEnabled?: boolean;
  autoStopSecs?: number;
  ftpUsers?: FtpUser[];
  allowAnonymous?: boolean;
  useUtf8?: boolean;
  promptBeforeConnect?: boolean;
}

interface ServiceStatus {
  service: string;
  running: boolean;
  pid?: number;
  port: number;
  uptime_secs?: number;
  error?: string;
}
```

## 支持的服务列表

| 服务 | 默认端口 | 说明 |
|------|---------|------|
| TFTP | 69 | 简单文件传输 |
| FTP | 21 | 文件传输（支持匿名/用户认证） |
| HTTP | 80/8080 | 静态文件服务 |
| SSH/SFTP | 22 | 安全 Shell + 文件传输 |
| Telnet | 23 | 远程登录 |
| NFS | 2049 | 网络文件系统 |
| VNC | 5900 | 远程桌面 |
| Cron | - | 定时任务引擎 |
| Iperf | 5201 | 网络性能测试 |

## 代码逻辑框架

### 服务操作命令

| Tauri Command | 说明 |
|--------------|------|
| `list_services()` | 返回 `ServiceInfo[]`（id/name/description/default_port） |
| `service_status(service)` | 返回 `ServiceStatus`（running/pid/port/uptime） |
| `start_service(service)` | 启动服务，检查端口占用，返回 `ServiceStatus` |
| `stop_service(service)` | 终止进程，清理 PID 记录 |
| `update_service_config(service, config)` | 更新服务配置 |
| `get_service_config(service)` | 获取当前配置 |

### UI 布局 ([ServerManagementModal.tsx](../src/components/ServerManagementModal.tsx))

```
┌──────────────────────────────────────────────────────┐
│  左侧服务列表 (240px)     │  右侧详情预览区           │
│                          │                           │
│  ● TFTP    ▶ ■ ⚙       │  服务日志和状态信息        │
│  ○ FTP     ▶ ■ ⚙       │                           │
│  ○ HTTP    ▶ ■ ⚙       │                           │
│  ...                     │                           │
└──────────────────────────────────────────────────────┘
```

- **状态指示灯**：● 绿色（运行中）/ ○ 灰色（已停止）
- **操作按钮**：▶ 启动 / ■ 停止 / ⚙ 配置
- **入口**：TitleBar "Servers" 按钮

## 扩展点与约束

### 约束

- **依赖内置二进制**：每个服务有对应的内置二进制路径，非安装包的服务需要手动提供可执行文件
- **端口冲突**：`start_service` 在启动前检查端口占用，但存在 TOCTOU 竞态条件
- **进程存活监控**：仅通过 PID 判断进程状态，不发送心跳检测
