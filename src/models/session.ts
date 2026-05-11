import type { SessionMode } from './sessionData';
import type { ConnectionConfig } from './connection';

export interface TerminalInstance {
  /** Frontend-generated terminal tab ID. */
  id: string;
  /** Display title (e.g. "Terminal 1"). */
  title: string;
  /** The backend PTY/connection ID returned by Rust `create_session`. */
  connectionId: string;
  /** The connection config used to create this terminal (for persistence/reconnect). */
  config: ConnectionConfig;
}

export interface SessionInfo {
  /** Frontend-generated session container ID. */
  id: string;
  status: SessionStatus;
  /** Display name for this session. */
  title: string;
  createdAt: string;
  /** Terminals belonging to this session. */
  terminals: TerminalInstance[];
  /** Index into terminals[] for the currently active tab. */
  activeTerminalIndex: number;
  /** 当前视图模式，默认 terminal */
  mode?: SessionMode;
  /** ISO timestamp 最后一次激活时间 */
  lastAccessed?: string;
}

export type SessionStatus = 'connected' | 'disconnected' | 'error';

/** Generate a frontend-side session container ID. */
let _sessionCounter = 0;
export function generateSessionId(): string {
  return `session-${Date.now()}-${++_sessionCounter}`;
}

/** Generate a frontend-side terminal instance ID. */
let _terminalCounter = 0;
export function generateTerminalId(): string {
  return `term-${Date.now()}-${++_terminalCounter}`;
}
