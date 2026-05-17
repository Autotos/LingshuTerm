/**
 * `ls -al` 长格式输出解析器。
 *
 * 将原始 ANSI-cleaned 文本解析为结构化条目列表，供 FileListTable 渲染。
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface LsAlEntry {
  /** 完整 10 字符权限字符串（如 `-rw-r--r--` / `drwxr-xr-x` / `lrwxrwxrwx`） */
  permission: string;
  /** 硬链接数 */
  links: number;
  /** 所有者 */
  owner: string;
  /** 所属组 */
  group: string;
  /** 字节大小 */
  size: number;
  /** 月份缩写（Jan-Dec） */
  month: string;
  /** 日期 */
  day: string;
  /** 时间（HH:MM 或 YYYY） */
  time: string;
  /** 文件名 */
  name: string;
  /** 软链接目标（仅 link 类型有效） */
  linkTarget?: string;
  /** 从权限位推断的类型 */
  kind: 'dir' | 'link' | 'exe' | 'file';
}

// ---------------------------------------------------------------------------
// 正则
// ---------------------------------------------------------------------------

/** 匹配一行 ls -al 长格式输出。
 *  分组：1=权限  2=链接数  3=所有者  4=组  5=大小  6=月  7=日  8=时间/年份  9=文件名(含链接目标)
 */
const LS_AL_LINE_RE = /^([d\-lcbps][rwxsStT\-]{9})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\w{3})\s+(\d{1,2})\s+(\S{1,5})\s+(.+)$/;

/** "total" 汇总行 */
const TOTAL_LINE_RE = /^total\s+\d+/i;

/** 软链接目标提取：最后出现 " -> " */
const SYMLINK_SPLIT_RE = /\s+->\s+(.+)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 检测文本是否包含 ls -al 长格式输出。
 * 规则：至少 2 行符合权限位格式，且匹配率 ≥ 50%。
 */
export function detectLsAl(text: string): boolean {
  if (typeof text !== 'string' || !text) return false;

  const lines = text.split(/\r?\n/).map((l) => l?.trim?.() ?? '').filter(Boolean);
  if (lines.length < 2) return false;

  let total = 0;
  let matched = 0;

  for (const line of lines) {
    if (!line || typeof line !== 'string') continue;
    if (TOTAL_LINE_RE.test(line)) continue;
    total++;
    if (LS_AL_LINE_RE.test(line)) matched++;
  }

  return total >= 2 && matched >= 2 && matched >= total * 0.5;
}

/**
 * 解析 ls -al 长格式输出文本。
 * 跳过 `total` 行；非匹配行静默跳过。
 */
export function parseLsAl(text: string): LsAlEntry[] {
  if (typeof text !== 'string' || !text) return [];

  const lines = text.split(/\r?\n/);
  const entries: LsAlEntry[] = [];

  for (const raw of lines) {
    if (raw == null || typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    if (TOTAL_LINE_RE.test(t)) continue;

    const m = t.match(LS_AL_LINE_RE);
    if (!m) continue;

    const permission = m[1];
    const links = m[2];
    const owner = m[3];
    const group = m[4];
    const size = m[5];
    const month = m[6];
    const day = m[7];
    const time = m[8];
    const nameRaw = m[9];

    if (!permission || !owner || !size || !month || !day || !time || !nameRaw) continue;

    let name: string = nameRaw;
    let linkTarget: string | undefined;
    const symMatch = nameRaw.match(SYMLINK_SPLIT_RE);
    if (symMatch) {
      name = nameRaw.slice(0, nameRaw.length - symMatch[0].length);
      linkTarget = symMatch[1];
    }

    entries.push({
      permission,
      links: parseInt(links, 10),
      owner,
      group,
      size: parseInt(size, 10),
      month,
      day,
      time,
      name,
      linkTarget,
      kind: inferKind(permission),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function inferKind(perm: string): LsAlEntry['kind'] {
  const type = perm.charAt(0);
  if (type === 'd') return 'dir';
  if (type === 'l') return 'link';
  if (perm.includes('x')) return 'exe';
  return 'file';
}
