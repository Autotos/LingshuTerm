import type { CommandBlock } from './block';
import type { TaskGroup } from './task';
import type { SessionInfo } from './session';

/** UI rendering mode for a session. */
export type SessionMode = 'terminal' | 'editor';

// ─── 3.0 Unified Session Event types ───────────────────────────

export type SessionEventType =
  | 'input'
  | 'output'
  | 'command-start'
  | 'command-end'
  | 'block-output'
  | 'system';

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  data: unknown;
  ts: number;
}

/** Derived: a group of events forming one command block. */
export interface CommandGroup {
  id: string;
  command: string;
  output: string;
  status: 'running' | 'success' | 'error';
  exitCode: number | null;
  startedAt: number | null;
  completedAt: number | null;
}

/**
 * Derive CommandGroup[] from a flat SessionEvent[] timeline.
 * Transforms the unified log into block-structured data for display.
 */
export function deriveCommandGroups(events: SessionEvent[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  let current: CommandGroup | null = null;

  for (const ev of events) {
    if (ev.type === 'command-start') {
      const d = ev.data as { commandId: string; command: string };
      current = {
        id: d.commandId,
        command: d.command,
        output: '',
        status: 'running',
        exitCode: null,
        startedAt: ev.ts,
        completedAt: null,
      };
    } else if (ev.type === 'command-end' && current) {
      const d = ev.data as { commandId: string; exitCode: number };
      current.status = d.exitCode === 0 ? 'success' : 'error';
      current.exitCode = d.exitCode;
      current.completedAt = ev.ts;
      groups.push(current);
      current = null;
    } else if (ev.type === 'block-output' && current) {
      current.output += (ev.data as { data: string }).data ?? (ev.data as string) ?? '';
    }
  }

  // Flush any unterminated command
  if (current) {
    current.status = 'error';
    current.exitCode = -1;
    current.completedAt = Date.now();
    groups.push(current);
  }

  return groups;
}

/** Generate a unique event ID. */
let _evtCounter = 0;
export function generateEventId(): string {
  return `evt-${Date.now()}-${++_evtCounter}`;
}

/**
 * Terminal 模式下的派生数据
 * - logs: 终端输出的历史日志片段（由 Rust 持久化端的 NDJSON 回放得到，运行中主要由 xterm 实时渲染）
 * - scrollPosition: 终端 viewport 的 y 坐标，用于切换回该 Session 时恢复
 */
export interface TerminalData {
  type: 'terminal';
  shell: string;
  cwd: string;
  scrollPosition: number;
  logs: string[];
}

/**
 * Blocks 模式下的派生数据
 * - tasks: 该 Session 下所有的命令块（项目中 CommandBlock 即为"任务"语义）
 * - currentFlow: 最近一次 AI 生成的任务流自然语言 query，用于标题展示
 */
export interface BlocksData {
  type: 'blocks';
  tasks: CommandBlock[];
  currentFlow: string;
  /** 可选：AI 生成的任务组（TaskBoard 用） */
  taskGroups?: TaskGroup[];
}

/**
 * 单个编辑器中的 Tab / 虚拟文件
 */
export interface EditorFile {
  /** 虚拟路径（不一定对应真实磁盘） */
  path: string;
  /** 文件内容 */
  content: string;
  /** Monaco language id，默认 plaintext */
  language?: string;
}

/**
 * Editor 模式下的派生数据（虚拟工作区，不写穿真实磁盘）
 */
export interface EditorData {
  type: 'editor';
  files: Record<string, string>;
  openFiles: string[];
  /** 当前激活的文件路径 */
  activeFile: string | null;
  theme: string;
}

/**
 * 统一的 Session 聚合视图
 * 注意：这是由多个分片 store（sessionStore/commandStore/taskStore/editorStore）组装出来的只读快照，
 * 业务修改请继续调用各自 store 的 action，不要直接 mutate 本结构
 */
export interface Session {
  id: string;
  name: string;
  mode: SessionMode;
  data: {
    terminal: TerminalData;
    blocks: BlocksData;
    editor: EditorData;
  };
  createdAt: string;
  lastAccessed: string;
  /** 原始元信息（shell / status / connectionType 等） */
  info: SessionInfo;
}

/** 为某个 session 生成空的 EditorData（首次进入或未持久化时使用） */
export function emptyEditorData(): EditorData {
  return {
    type: 'editor',
    files: {},
    openFiles: [],
    activeFile: null,
    theme: 'lingshu-dark',
  };
}

/** 为某个 session 生成空的 TerminalData */
export function emptyTerminalData(shell = 'default', cwd = '~'): TerminalData {
  return {
    type: 'terminal',
    shell,
    cwd,
    scrollPosition: 0,
    logs: [],
  };
}

/** 为某个 session 生成空的 BlocksData */
export function emptyBlocksData(): BlocksData {
  return {
    type: 'blocks',
    tasks: [],
    currentFlow: '',
    taskGroups: [],
  };
}
