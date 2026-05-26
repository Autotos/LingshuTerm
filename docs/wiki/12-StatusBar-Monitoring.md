# 12 — StatusBar 服务器监控

## 功能职责

StatusBar 是终端底部状态栏，显示：
- 当前活动终端的连接名称（截断 + title tooltip）
- SSH 连接时实时服务器统计（CPU/MEM/DISK/NET/USERS）
- 当前会话终端数量
- 实时时钟

## 核心数据结构

### ServerStats 接口 ([StatusBar.tsx:60-75](../src/components/StatusBar.tsx))

```typescript
interface ServerStats {
  cpu: { total: number; user: number; system: number; idle: number };
  cpu_count: number;
  load_avg: string;     // "1.0,2.0,3.0"
  uptime: number;       // 秒
  mem: { total: string; used: string; free: string; buffers: string; cached: string };
  disk_root: { dev: string; total: string; used: string; avail: string; pct: string };
  disk_parts: Array<{ mount: string; dev: string; total: string; used: string; avail: string; pct: string }>;
  net: { ifaces: string; rx: number; tx: number };
  users: { count: number; list: Array<{ name: string; tty: string; time: string }> };
}
```

## 代码逻辑框架

### 轮询机制 ([StatusBar.tsx:101-176](../src/components/StatusBar.tsx))

```
useEffect[connectionId, isSsh]
  │
  ├─ 非 SSH 终端 → setStats(null) → return
  │
  └─ SSH 终端 → 启动 5 秒轮询
      poll() {
        invoke('query_server_stats', { sessionId: connId })
        → JSON.parse(json)
        → 构建 ServerStats
        → 计算网络速率 (bytes delta / 5s)
        → setStats(stats)
      }
      setInterval(poll, 5000)
```

### Tooltip 系统 ([StatusBar.tsx:250-270](../src/components/StatusBar.tsx))

```
StatItem({ label, value, tooltip })
  │
  ├─ triggerRef (React ref on <span>)
  │
  ├─ onMouseEnter → getBoundingClientRect()
  │     → setPos({ left: rect.left + rect.width/2, top: rect.top - 8 })
  │
  ├─ onMouseLeave → setPos(null)
  │
  └─ pos && <span className="stat-tooltip"
                 style={{ left, top, transform: 'translate(-50%, -100%)' }}>
               {tooltip}
             </span>
```

**关键实现细节**：
- 使用 `position: fixed`（而非 `absolute`），避免父容器 `overflow:hidden` 裁剪
- 通过 `getBoundingClientRect()` 动态计算视口坐标
- `z-index: 99999` + `box-shadow` 确保显示在最上层
- `pointer-events: none` 避免 tooltip 干扰鼠标事件

### 各模块 Tooltip 内容

| 模块 | 显示内容 |
|------|---------|
| CPU | User%/System%/Idle%、核心数、1/5/15m 负载、运行时长 |
| MEM | Used/Free/Buffers/Cache (MB)、Total |
| DISK | 前 3 个分区（设备名/挂载点/已用/总量/可用） |
| NET | 网卡名、总 RX/TX 流量、实时速率 |
| USERS | 用户名列表 + 终端 + 登录时间 |

## 扩展点与约束

### 约束

- **仅 SSH 终端**：非 SSH 终端（本地 PTY、Telnet、Serial）不显示统计信息
- **轮询间隔固定 5 秒**：不可配置
- **网络速率计算**：基于 5 秒内的 RX/TX 字节差值，首次轮询时显示 "0B/s"
- **Tooltip 定位**：`translate(-50%, -100%)` 策略可能导致最左侧/最右侧 item 的 tooltip 部分超出视口
