# 07 — 终端渲染系统

## 功能职责

终端渲染系统负责 xterm.js 实例的生命周期管理、DOM 挂载/卸载、输入缓冲和 WebGL 渲染。核心设计特点是**模块级终端实例缓存**，确保 React 组件重复挂载（reconciliation）时不会销毁和重建终端实例。

## 核心数据结构

### 终端缓存 ([useTerminal.ts:47-47](../src/hooks/useTerminal.ts))

```typescript
// 模块级 Map，key = connectionId，value = 终端实例
const terminalCache = new Map<string, CachedTerminal>();

interface CachedTerminal {
  terminal: Terminal;        // xterm.js Terminal 实例
  fitAddon: FitAddon;        // 自适应尺寸插件
  webglAddon: WebglAddon | null; // GPU 加速渲染器
}
```

### xterm.js 主题 ([xterm.ts](../src/lib/xterm.ts))

与 CSS 变量保持一致的暖灰暗色主题：
- 背景 `#0e0e0d`（`--void`），前景 `#faf9f6`（`--text-1`）
- 16 色 ANSI 调色板（黑/红/绿/黄/蓝/紫/青/白 + 亮色）
- 光标样式 `bar` + 闪烁
- 字体：`Berkeley Mono, JetBrains Mono, SF Mono` 栈

## 代码逻辑框架

### 终端初始化流程 ([useTerminal.ts:96-189](../src/hooks/useTerminal.ts))

```
useTerminal({ containerRef, sessionId })
  │
  ├─ 1. 检查模块级缓存
  │     terminalCache.get(sessionId)
  │     ├─ 命中 → 复用终端实例，直接 attach 到新 DOM
  │     └─ 未命中 → 创建新实例
  │
  ├─ 2. 创建新终端 (仅首次)
  │     new Terminal({ cols, rows, fontSize, fontFamily, theme, ... })
  │     terminal.loadAddon(new FitAddon())
  │     terminal.loadAddon(new WebglAddon())  ← 可能失败，回退 Canvas
  │     terminalCache.set(sessionId, cached)
  │
  ├─ 3. 挂载到 DOM
  │     terminal.open(container)  ← 幂等操作，已打开则跳过
  │
  ├─ 4. 初始尺寸适配
  │     rAF → tryFit()
  │     ├─ autoFit=true  → fitAddon.fit()
  │     ├─ autoFit=false → terminal.resize(defaultColumns, defaultRows)
  │     └─ 重试逻辑: 最多 60 次 (50ms 间隔) 等待容器就绪
  │
  ├─ 5. 用户输入事件
  │     terminal.onData(data → {
  │       if (!connectionReady) → inputBufferRef.push(data)
  │       else → invoke(getWriteCommand(sid), { sessionId, data })
  │     })
  │
  ├─ 6. 尺寸变化事件
  │     terminal.onResize({ cols, rows } → {
  │       debounce 150ms → invoke(getResizeCommand(sid), { cols, rows })
  │     })
  │
  └─ 7. Cleanup (组件卸载)
        // 不调用 terminal.dispose()！
        // 仅清空 React ref，终端实例留在缓存中
```

### 输入缓冲机制 ([useTerminal.ts:63-65,76-85](../src/hooks/useTerminal.ts))

当 SSH 连接尚未就绪（`connectionReadyRef.current === false`）时，用户按键被缓冲到 `inputBufferRef: string[]`。连接就绪后调用 `flushInputBuffer()` 一次性发送所有缓冲数据。

### WebGL 渲染器恢复 ([useTerminal.ts:364-383](../src/hooks/useTerminal.ts))

`wake()` 函数在 WebGL 上下文丢失时重建渲染器：
1. 销毁旧 WebglAddon
2. 创建新 WebglAddon
3. 更新模块级缓存
4. `fitAddon.fit()` + `terminal.refresh()`

## 扩展点与约束

### 约束

- **终端实例不 dispose**：Cleanup 函数仅清空 React ref，不调用 `dispose()`。实例存活在 `terminalCache` Map 中，直到手动调用 `disposeCachedTerminal(connectionId)` 或应用退出
- **WebGL 回退**：如果浏览器不支持 WebGL 或上下文丢失，自动降级为 Canvas 2D 渲染
- **输入缓冲**：仅在 `connectionReadyRef = false` 时缓冲。如果连接永远不就绪，缓冲数据会丢失
- **FitAddon 重试**：尺寸计算基于 `fontSize * 0.6`（估计字符宽度）和 `fontSize * 1.5`（估计字符高度），非等宽字体时会有偏差
