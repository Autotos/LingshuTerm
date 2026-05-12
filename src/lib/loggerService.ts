import { invoke } from '@tauri-apps/api/core';

export interface LogEntry {
  name: string;
  path: string;
  size: number;
  is_rotated: boolean;
}

export interface LoggerConfig {
  logPath: string;
  maxSizeMb: number;
}

/**
 * Terminal session log persistence service.
 *
 * Writes terminal output to `{logPath}/{sessionName}/{terminalName}.log`.
 * Automatically rotates files when they exceed maxSizeMb.
 */
export const LoggerService = {
  async write(
    config: LoggerConfig,
    sessionName: string,
    terminalName: string,
    data: string,
  ): Promise<void> {
    if (!data) return;
    await invoke('write_log', {
      logPath: config.logPath,
      sessionName,
      terminalName,
      data,
      maxSizeMb: config.maxSizeMb,
    }).catch((err) => console.warn('[LoggerService] write_log failed:', err));
  },

  async list(config: LoggerConfig, sessionName: string): Promise<LogEntry[]> {
    return invoke<LogEntry[]>('list_logs', {
      logPath: config.logPath,
      sessionName,
    });
  },

  async read(path: string): Promise<string> {
    return invoke<string>('read_log_file', { path });
  },

  async openInExplorer(path: string): Promise<void> {
    await invoke('open_in_explorer', { path });
  },
};
