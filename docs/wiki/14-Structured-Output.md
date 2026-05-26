# 14 — 结构化输出组件

## 功能职责

当 Shell 命令执行完毕后，输出内容经过 `outputDetector` 自动识别类型，由对应的 React 组件渲染为交互式卡片。这替代了传统的纯文本终端输出，提供更丰富的信息密度。

## 组件清单

| 组件 | 文件 | 触发条件 | 展示内容 |
|------|------|---------|---------|
| `JsonViewer` | [JsonViewer.tsx](../src/components/output/JsonViewer.tsx) | JSON 字符串 | 可折叠的树形结构 |
| `DiskUsageCard` | [DiskUsageCard.tsx](../src/components/output/DiskUsageCard.tsx) | `df -h` 输出 | 磁盘使用率进度条 |
| `ProcessTable` | [ProcessTable.tsx](../src/components/output/ProcessTable.tsx) | `ps aux` 输出 | 可排序/筛选的进程表格 |
| `GitStatus` | [GitStatus.tsx](../src/components/output/GitStatus.tsx) | `git status` 关键词 | 分支名 + 变更文件列表 |
| `DirectoryChart` | [DirectoryChart.tsx](../src/components/output/DirectoryChart.tsx) | `du -sh` 行格式 | 目录大小条形图 |
| `FileListTable` | [FileListTable.tsx](../src/components/output/FileListTable.tsx) | `ls -al` 长格式 | 权限/大小/日期表格 |
| `FileGrid` | [FileGrid.tsx](../src/components/output/FileGrid.tsx) | `ls` 短格式 | 文件图标网格 |
| `CodeBlock` | [CodeBlock.tsx](../src/components/output/CodeBlock.tsx) | 已知代码文件扩展名 | Shiki 语法高亮代码块 |
| `MarkdownRenderer` | [MarkdownRenderer.tsx](../src/components/output/MarkdownRenderer.tsx) | Markdown 特征 | 富文本渲染 |
| `MermaidDiagram` | [MermaidDiagram.tsx](../src/components/output/MermaidDiagram.tsx) | Mermaid 代码块 | 流程图/时序图 SVG |
| `AnsiText` | [AnsiText.tsx](../src/components/output/AnsiText.tsx) | 回退 | 原生 ANSI SGR 彩色文本 |

## 检测优先级 ([outputDetector.ts](../src/lib/outputDetector.ts))

```
1. JSON (可 parse)              → JsonViewer
2. df -h 表头 (Filesystem...)   → DiskUsageCard
3. ps aux 表头 (USER PID...)    → ProcessTable
4. git status 关键词             → GitStatus
5. du -sh 行格式                 → DirectoryChart
6. ls -al 长格式 (drwx...日期)   → FileListTable
7. ls/dir/tree 短格式            → FileGrid
8. 代码文件 (根据文件扩展名)      → CodeBlock
9. Markdown (#*[]`)              → MarkdownRenderer
10. Mermaid (```mermaid)         → MermaidDiagram
11. 其他                         → AnsiText
```

## 扩展点与约束

### 如何新增输出类型

1. 在 [outputDetector.ts](../src/lib/outputDetector.ts) 中添加检测函数
2. 在 [outputDispatch.ts](../src/lib/outputDispatch.ts) 中添加类型和路由
3. 创建新的 React 渲染组件
4. 在 [OutputRenderer.tsx](../src/components/output/OutputRenderer.tsx) 的 switch/case 中添加渲染分支

### 约束

- **解析失败静默回退**：每个检测器失败时自动跳到下一个，不会中断整个渲染流程
- **类型检测基于字符串特征**：不执行语义分析，可能误判（如 git 输出中包含 `df` 关键词）
- **ANSI 清洗**：在传给结构化组件之前，ANSI 转义序列已被 `stripControl()` 移除
