/**
 * Natural language terminal-creation action detector.
 *
 * Detects SSH / Telnet / Serial creation intent from Chinese natural language,
 * extracts connection parameters via regex, and produces a typed action payload
 * that the frontend can use to call sessionStore.addTerminal().
 */

import type { SshConfig, TelnetConfig, SerialConfig } from '@/models/connection';

// ─── Action type ───────────────────────────────────────────────────

export interface TerminalCreateAction {
  type: 'TERMINAL_CREATE';
  payload: {
    protocol: 'ssh' | 'telnet' | 'serial';
    host: string;
    port: number;
    username?: string;
    password?: string;
    // serial-specific
    portName?: string;
    baudRate?: number;
    /** User-specified session name (e.g. "会话名称：test") */
    sessionName?: string;
    /** Number of terminals to create (same config), e.g. "新建两个SSH终端" → 2 */
    count?: number;
    /** Expanded IP list from range, e.g. "192.168.1.2-10" → ["192.168.1.2", ..., "192.168.1.10"] */
    hosts?: string[];
  };
}

// ─── Keyword tables ────────────────────────────────────────────────

const SSH_KEYWORDS = /(ssh连接|ssh终端|ssh\b|远程连接|远程终端|新建.*ssh|打开.*ssh)/i;
const TELNET_KEYWORDS = /(telnet连接|telnet终端|telnet\b|新建.*telnet)/i;
const SERIAL_KEYWORDS = /(串口连接|串口终端|serial连接|打开串口|串口终端|serial\b)/i;

// ─── Regex extractors ──────────────────────────────────────────────
// NOTE: [：:\s]* means the label/value separator (colon or space) is OPTIONAL.
// This handles both "用户:admin" (with colon) and "用户admin" (without colon).

/** Common noise words that should not be treated as session names. */
const SESSION_NAME_NOISE = /^(?:一个|新的|这个|那个|的|一个?新的)$/i;

/** Extract user-specified session name from various natural language patterns. */
const SESSION_NAME_PATTERNS: RegExp[] = [
  // "名为test的会话" / "叫做demo的会话" — most specific, try first
  /(?:名为|叫做|叫)\s*(\S+?)\s*的?\s*会话/i,
  // "会话名称：test" / "会话名: my-session" / "session name: foo"
  /(?:会话名称|会话名|session\s*name)[：:\s]+(\S+)/i,
  // "新建Test会话" / "创建my-session会话" / "打开demo会话"
  /(?:新建|创建|打开|新开)\s*(\S+?)\s*会话/i,
  // "名称：dev" / "名称为dev" / "名字是prod"
  /(?:名称|名字)\s*(?:为|是|[：:])\s*(\S+)/i,
];

/** Extract IP address from text. Returns the first match. */
const IP_RE = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

/** Extract hostname labelled with host/ip/地址 etc. */
const HOST_RE = /(?:host|主机|ip|地址|Host|IP)[：:\s]*(\S+)/i;

/** Extract username: /user admin/ or /用户:admin/ or /admin@ip/ */
const USER_RE = /(?:user(?:name)?|用户|用户名|账号|User|Username)[：:\s]*(\S+)/i;
const USER_AT_RE = /(\S+)@(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

/** Extract password: /pass admin/ or /密码:admin/ */
const PASS_RE = /(?:pass(?:wd|word)?|密码|口令|Passwd|Password|Pass)[：:\s]*(\S+)/i;

/** Extract port: /端口 2222/ or /port:2222/ */
const PORT_RE = /(?:port|端口|Port)[：:\s]*(\d{1,5})/i;

/** Extract baud rate for serial connections */
const BAUD_RE = /(?:baud|波特率|Baud)[：:\s]*(\d+)/i;

/** Extract serial port name: /串口 COM3/ or /port:COM3/ */
const SERIAL_PORT_RE = /(?:port|串口|Port|端口)[：:\s]*(com\d+|tty\S+)/i;

/** Extract quantity: "两个SSH终端" / "新建3个终端" / "五个" */
const QUANTITY_RE = /(\d+|[一二三四五六七八九十两]+)\s*个/i;

/** Extract IP range suffix: "192.168.1.2-10" → base=192.168.1, start=2, end=10 */
const IP_RANGE_RE = /(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\s*[-–—]\s*(\d{1,3})/;

// ─── Chinese number → integer ──────────────────────────────────────

const CN_NUM: Record<string, number> = {
  '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,
  '六':6,'七':7,'八':8,'九':9,'十':10,
};

function parseChineseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (CN_NUM[s] !== undefined) return CN_NUM[s];
  // "十二" → 12, "二十" → 20
  if (s.length === 2 && CN_NUM[s[0]] !== undefined && CN_NUM[s[1]] !== undefined) {
    const a = CN_NUM[s[0]];
    const b = CN_NUM[s[1]];
    if (s[0] === '十') return 10 + b;
    if (s[1] === '十') return a * 10;
  }
  if (s.endsWith('十') && s.length === 2 && CN_NUM[s[0]] !== undefined) {
    return CN_NUM[s[0]] * 10;
  }
  // "十五" → a*10
  if (s.length === 2 && CN_NUM[s[0]] !== undefined && s[1] === '十' === false && CN_NUM[s[0]] < 10) {
    // just return the single-digit parse; multi-digit not needed for quantity
  }
  return null;
}

/** Extract quantity from input: "两个"→2, "3个"→3, null if not found. */
function extractQuantity(input: string): number | null {
  const m = QUANTITY_RE.exec(input);
  if (!m) return null;
  return parseChineseNumber(m[1]);
}

/** Expand an IP range like "192.168.1.2-10" into individual IP strings. */
function expandIpRange(input: string): string[] | null {
  const m = IP_RANGE_RE.exec(input);
  if (!m) return null;
  const prefix = m[1];
  const start = parseInt(m[2], 10);
  const end = parseInt(m[3], 10);
  if (start < 0 || end > 255 || start > end) return null;
  // Sanity cap to prevent accidental huge ranges (e.g. 1-255)
  if (end - start > 50) return null;
  const ips: string[] = [];
  for (let i = start; i <= end; i++) {
    ips.push(`${prefix}.${i}`);
  }
  return ips;
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Punctuation that is clearly sentence-ending and not part of a password.
 * Does NOT include ! @ # $ % ^ & * ( ) which are valid password chars.
 */
const TRAILING_PUNCT_RE = /[,.;;?，。；？、]+$/;

/** Strip trailing sentence punctuation that isn't part of the actual value. */
function cleanValue(s: string): string {
  return s.replace(TRAILING_PUNCT_RE, '').trim();
}

/** Extract user-specified session name from query, e.g. "新建Test会话" → "Test". */
export function extractSessionName(input: string): string | null {
  for (const re of SESSION_NAME_PATTERNS) {
    const m = re.exec(input);
    if (m) {
      const name = cleanValue(m[1]);
      if (!name || name.length >= 40) continue;
      if (IP_RE.test(name)) continue;
      if (SESSION_NAME_NOISE.test(name)) continue;
      return name;
    }
  }
  return null;
}

// ─── Parameter extractors ──────────────────────────────────────────

interface SshParams {
  host: string;
  port: number;
  username: string;
  password: string;
}

function extractSshParams(input: string): SshParams | null {
  let host = '';
  let username = 'root';
  let password = '';
  let port = 22;

  // Try user@host pattern first
  const userAt = USER_AT_RE.exec(input);
  if (userAt) {
    username = cleanValue(userAt[1]);
    host = cleanValue(userAt[2]);
  }

  // Extract host: labelled IP, or first bare IP
  if (!host) {
    const hostLabelled = HOST_RE.exec(input);
    if (hostLabelled) {
      host = cleanValue(hostLabelled[1]);
    }
  }
  if (!host) {
    const ipMatch = IP_RE.exec(input);
    if (ipMatch) host = cleanValue(ipMatch[1]);
  }

  // Extract username (if not already from user@host)
  if (username === 'root') {
    const userMatch = USER_RE.exec(input);
    if (userMatch) username = cleanValue(userMatch[1]);
  }

  // Extract password — do NOT strip trailing punctuation; any char can be part of a password.
  const passMatch = PASS_RE.exec(input);
  if (passMatch) password = passMatch[1].trim();

  // Extract port
  const portMatch = PORT_RE.exec(input);
  if (portMatch) {
    const p = parseInt(portMatch[1], 10);
    if (p >= 1 && p <= 65535) port = p;
  }

  if (!host) return null;
  return { host, port, username, password };
}

interface TelnetParams {
  host: string;
  port: number;
}

function extractTelnetParams(input: string): TelnetParams | null {
  let host = '';
  let port = 23;

  const hostLabelled = HOST_RE.exec(input);
  if (hostLabelled) host = cleanValue(hostLabelled[1]);

  if (!host) {
    const ipMatch = IP_RE.exec(input);
    if (ipMatch) host = cleanValue(ipMatch[1]);
  }

  const portMatch = PORT_RE.exec(input);
  if (portMatch) {
    const p = parseInt(portMatch[1], 10);
    if (p >= 1 && p <= 65535) port = p;
  }

  if (!host) return null;
  return { host, port };
}

interface SerialParams {
  portName: string;
  baudRate: number;
}

function extractSerialParams(input: string): SerialParams | null {
  let portName = '';
  let baudRate = 115200;

  const portMatch = SERIAL_PORT_RE.exec(input);
  if (portMatch) portName = cleanValue(portMatch[1]);

  const baudMatch = BAUD_RE.exec(input);
  if (baudMatch) {
    const b = parseInt(baudMatch[1], 10);
    if (b > 0) baudRate = b;
  }

  if (!portName) return null;
  return { portName, baudRate };
}

// ─── Main detection ────────────────────────────────────────────────

/**
 * Try to detect a terminal-creation intent from user input.
 * Returns a TerminalCreateAction if:
 *   1. Keywords match one of the protocols
 *   2. Required parameters can be extracted
 *
 * Returns null if no terminal-creation intent is detected.
 */
export function detectTerminalCreateIntent(input: string): TerminalCreateAction | null {
  const trimmed = input.trim();
  const sessionName = extractSessionName(trimmed) ?? undefined;
  const count = extractQuantity(trimmed) ?? undefined;
  const hosts = expandIpRange(trimmed) ?? undefined;

  // ── SSH ──
  if (SSH_KEYWORDS.test(trimmed)) {
    const params = extractSshParams(trimmed);
    if (params) {
      return {
        type: 'TERMINAL_CREATE',
        payload: {
          protocol: 'ssh',
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          sessionName,
          count,
          hosts,
        },
      };
    }
  }

  // ── Telnet ──
  if (TELNET_KEYWORDS.test(trimmed)) {
    const params = extractTelnetParams(trimmed);
    if (params) {
      return {
        type: 'TERMINAL_CREATE',
        payload: {
          protocol: 'telnet',
          host: params.host,
          port: params.port,
          sessionName,
          count,
          hosts,
        },
      };
    }
  }

  // ── Serial ──
  if (SERIAL_KEYWORDS.test(trimmed)) {
    const params = extractSerialParams(trimmed);
    if (params) {
      return {
        type: 'TERMINAL_CREATE',
        payload: {
          protocol: 'serial',
          host: '',
          port: 0,
          portName: params.portName,
          baudRate: params.baudRate,
          sessionName,
        },
      };
    }
  }

  return null;
}

/**
 * Diagnostic: explain WHY detection failed (or succeeded).
 * Returns an array of human-readable messages suitable for the output panel.
 */
export function diagnosticTrace(input: string): string[] {
  const lines: string[] = [];
  const trimmed = input.trim();
  lines.push(`[诊断] 输入: "${trimmed.slice(0, 80)}${trimmed.length > 80 ? '...' : ''}"`);

  // Check keywords
  const sshHit = SSH_KEYWORDS.test(trimmed);
  const telnetHit = TELNET_KEYWORDS.test(trimmed);
  const serialHit = SERIAL_KEYWORDS.test(trimmed);

  lines.push(`[诊断] 关键词检测: SSH=${sshHit}, Telnet=${telnetHit}, Serial=${serialHit}`);

  if (sshHit) {
    const params = extractSshParams(trimmed);
    if (params) {
      lines.push(`[诊断] SSH参数提取成功: host=${params.host}, port=${params.port}, user=${params.username}, pass=${params.password ? '***' : '(空)'}`);
    } else {
      lines.push('[诊断] SSH参数提取失败: 未找到有效的IP/域名');
      const ips = IP_RE.exec(trimmed);
      lines.push(`[诊断]   - IP检测: ${ips ? ips[1] : '未找到'}`);
      const hosts = HOST_RE.exec(trimmed);
      lines.push(`[诊断]   - Host标签: ${hosts ? hosts[1] : '未找到'}`);
    }
  }

  if (telnetHit) {
    const params = extractTelnetParams(trimmed);
    if (params) {
      lines.push(`[诊断] Telnet参数提取成功: host=${params.host}, port=${params.port}`);
    } else {
      lines.push('[诊断] Telnet参数提取失败: 未找到有效的IP/域名');
    }
  }

  if (serialHit) {
    const params = extractSerialParams(trimmed);
    if (params) {
      lines.push(`[诊断] Serial参数提取成功: port=${params.portName}, baud=${params.baudRate}`);
    } else {
      lines.push('[诊断] Serial参数提取失败: 未找到有效串口名');
    }
  }

  if (!sshHit && !telnetHit && !serialHit) {
    lines.push('[诊断] 未匹配任何终端创建关键词，将作为普通AI查询处理');
  }

  return lines;
}

// ─── LLM response parser ───────────────────────────────────────────

/**
 * Check if an LLM response (or parsed task array) contains a TERMINAL_CREATE action.
 * The LLM may return either:
 *   - A single JSON object: {"type":"TERMINAL_CREATE","payload":{...}}
 *   - An array where the first element has type: "TERMINAL_CREATE"
 */
export function parseLlmAction(raw: string): TerminalCreateAction | null {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(raw);
    if (parsed && parsed.type === 'TERMINAL_CREATE' && parsed.payload) {
      return parsed as TerminalCreateAction;
    }
    // Try array first element
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type === 'TERMINAL_CREATE') {
      return parsed[0] as TerminalCreateAction;
    }
  } catch {
    // Try to extract JSON object from text
    const jsonMatch = raw.match(/\{[\s\S]*"type"\s*:\s*"TERMINAL_CREATE"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && parsed.type === 'TERMINAL_CREATE' && parsed.payload) {
          return parsed as TerminalCreateAction;
        }
      } catch { /* ignore */ }
    }
  }
  return null;
}

/**
 * Convert a TerminalCreateAction payload into a typed connection config
 * suitable for sessionStore.addTerminal().
 */
export function actionToConnectionConfig(
  action: TerminalCreateAction,
): SshConfig | TelnetConfig | SerialConfig {
  const { payload } = action;
  switch (payload.protocol) {
    case 'ssh':
      return {
        protocol: 'ssh',
        host: payload.host,
        port: payload.port || 22,
        username: payload.username || 'root',
        password: payload.password || '',
      };
    case 'telnet':
      return {
        protocol: 'telnet',
        host: payload.host,
        port: payload.port || 23,
      };
    case 'serial':
      return {
        protocol: 'serial',
        portName: payload.portName || '',
        baudRate: payload.baudRate || 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      };
  }
}
