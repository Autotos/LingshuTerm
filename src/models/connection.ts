// ─── Connection protocol types (must match Rust ConnectionConfig) ─────

export type Protocol = 'ssh' | 'telnet' | 'serial' | 'local';

/** Connection type alias exposed to UI layer; semantically equivalent to Protocol. */
export type ConnectionType = Protocol;

export interface SshConfig {
  protocol: 'ssh';
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface TelnetConfig {
  protocol: 'telnet';
  host: string;
  port: number;
}

export interface SerialConfig {
  protocol: 'serial';
  portName: string;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
}

/**
 * Local shell config — launches a local PTY via portable-pty.
 * `shell` is the absolute path or bare executable name (e.g. "pwsh", "cmd.exe", "/bin/bash").
 * `cwd` is optional; when omitted Rust falls back to `std::env::current_dir()`.
 */
export interface LocalConfig {
  protocol: 'local';
  shell: string;
  cwd?: string;
}

export type ConnectionConfig = SshConfig | TelnetConfig | SerialConfig | LocalConfig;

/** Known local shell kinds surfaced in the UI selector. */
export type LocalShellKind = 'cmd' | 'powershell' | 'bash' | 'zsh';

/**
 * Descriptor returned by the Rust `list_local_shells` command; used to populate
 * the Local panel's shell dropdown. `path` is what we pass back as `shell`.
 */
export interface LocalShellOption {
  kind: LocalShellKind;
  label: string;
  path: string;
}

// ─── Saved connection entry (persisted in encrypted storage) ──

export interface SavedConnection {
  id: string;
  name: string;
  config: ConnectionConfig;
  createdAt: string;
  /** ISO timestamp of last quick-connect or edit, used for recency sort */
  lastUsedAt?: string;
  /** Directory group this connection belongs to. undefined = root level */
  group?: string;
}

// ─── Session Manager tree types ────────────────────────────────

export interface TreeNode {
  id: string;
  label: string;
  type: 'directory' | 'session';
  children?: TreeNode[];
  sessionData?: SavedConnection;
}

export interface StoragePayload {
  connections: SavedConnection[];
  groups: string[];
}

// ─── Serial port info (from Rust) ────────────────────────────────────

export interface PortInfo {
  name: string;
  port_type: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

let _connIdCounter = 0;
export function generateConnectionId(): string {
  return `conn-${Date.now()}-${++_connIdCounter}`;
}

export function defaultSshConfig(): SshConfig {
  return { protocol: 'ssh', host: '', port: 22, username: 'root', password: '' };
}

export function defaultTelnetConfig(): TelnetConfig {
  return { protocol: 'telnet', host: '', port: 23 };
}

export function defaultSerialConfig(): SerialConfig {
  return { protocol: 'serial', portName: '', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' };
}

export function defaultLocalConfig(shell = ''): LocalConfig {
  return { protocol: 'local', shell };
}

export function connectionLabel(config: ConnectionConfig): string {
  switch (config.protocol) {
    case 'ssh':
      return `${config.username}@${config.host}:${config.port}`;
    case 'telnet':
      return `${config.host}:${config.port}`;
    case 'serial':
      return `${config.portName} @ ${config.baudRate}`;
    case 'local':
      return config.shell || 'local';
  }
}

/** Short label for tab display — host:port only, omitting username. */
export function connectionShortLabel(config: ConnectionConfig): string {
  switch (config.protocol) {
    case 'ssh':
      return config.port !== 22
        ? `${config.host}:${config.port}`
        : config.host;
    case 'telnet':
      return config.port !== 23
        ? `${config.host}:${config.port}`
        : config.host;
    case 'serial':
      return config.portName;
    case 'local':
      return config.shell ? config.shell.split(/[/\\]/).pop() || config.shell : 'local';
  }
}
