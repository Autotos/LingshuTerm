# 13 — 命令输入与输出渲染

## 功能职责

命令输入系统负责检测用户在底部输入栏的输入类型（Shell 命令 vs AI 自然语言），通过不同路径处理。输出渲染系统负责将命令结果以结构化方式展示。

## 核心流程

### 输入检测 ([aiDetect.ts](../src/lib/aiDetect.ts))

```
detectInputType(input: string): 'shell' | 'ai-nl'
  │
  ├─ 检测是否为自然语言
  │   ├─ 中文关键字/句式
  │   ├─ 英文描述性语句（> 3 个单词，无常见命令前缀）
  │   └─ 问句模式
  │
  ├─ Shell 命令特征
  │   ├─ 以常见命令开头（ls/cd/grep/npm/git/cargo 等）
  │   ├─ 包含管道 | 或重定向 >
  │   └─ 包含文件路径（/ 或 .\）
  │
  └─ 返回: 'shell' | 'ai-nl'
```

### CommandInput 组件 ([CommandInput.tsx](../src/components/CommandInput.tsx))

提供 Tab 补全、历史记录导航（↑↓）、Ctrl+C 中断等终端级输入体验。

### 输出调度 ([outputDispatch.ts](../src/lib/outputDispatch.ts))

```
dispatchOutput(command: string, output: string): OutputKind
  │
  ├─ outputDetector.detect(output)
  │   ├─ JSON → JsonViewer
  │   ├─ df -h → DiskUsageCard
  │   ├─ ps aux → ProcessTable
  │   ├─ git status → GitStatus
  │   ├─ du -sh → DirectoryChart
  │   ├─ ls -al → FileListTable
  │   ├─ ls → FileGrid
  │   ├─ 代码文件 → CodeBlock
  │   ├─ Markdown → MarkdownRenderer
  │   ├─ Mermaid → MermaidDiagram
  │   └─ 其他 → AnsiText
  │
  └─ OutputRenderer: render(kind, data) → React 组件
```

## 扩展点与约束

### 约束

- **AI 检测是正则启发式**：不是 LLM 分类，可能误判 Shell 命令为自然语言（反之亦然）
- **输出检测优先级**：JSON 匹配优先级最高（`{` 或 `[` 开头且可 parse），可能将有效的 JSON 格式文本误判
- **Shift+Enter**：在 CommandInput 中按下会在当前终端中发送换行符，不触发提交
- **Enter**：触发提交，走 Shell 或 AI 路径
