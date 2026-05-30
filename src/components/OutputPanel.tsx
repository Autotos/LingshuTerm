import { useRef, useEffect, forwardRef, useCallback, useState } from 'react';
import {
  ChevronUp, ChevronDown, Trash2, Loader2, Circle,
  Folder, File, FileCode, FileText, FileImage, FileArchive,
  FileAudio, FileVideo, Link, Box, Globe, Cpu, Bot, Database, Terminal,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useOutputStore, type OutputItem } from '@/stores/outputStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

const OUTPUT_FONT_STACK =
  "'Cascadia Code', 'Sarasa Mono SC', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Noto Sans SC', 'Microsoft YaHei', monospace";

export const OutputPanel = forwardRef<HTMLDivElement, { outputHeight: number }>(
  function OutputPanel({ outputHeight }, ref) {
    const { items, status, isExpanded, toggle, clear } = useOutputStore();
    const outputFont = useSettingsStore((s) =>
      s.settings.terminal.outputFont || OUTPUT_FONT_STACK);
    const setOutputHeight = useUiStore((s) => s.setOutputHeight);
    const containerRef = useRef<HTMLDivElement>(null);

    // Expand to 3/4 of the viewport height (minus chrome: title ~40, tab ~36, status ~24, input ~28)
    const handleToggle = useCallback(() => {
      if (!isExpanded) {
        setOutputHeight(Math.round((window.innerHeight - 130) * 0.75));
      }
      toggle();
    }, [isExpanded, toggle, setOutputHeight]);

    useEffect(() => {
      if (isExpanded && items.length > 0) {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    }, [items, isExpanded]);

    return (
      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--deep)]">
        <HeaderBar status={status} itemCount={items.length} isExpanded={isExpanded} onToggle={handleToggle} onClear={clear} />

        <div
          ref={ref}
          className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${
            isExpanded ? 'border-t border-[var(--border)]' : ''
          }`}
          style={{ maxHeight: isExpanded ? outputHeight : 0 }}
        >
          <div
            ref={containerRef}
            className="min-h-0"
            style={{ fontFamily: outputFont, overflowY: 'auto', height: '100%' }}
          >
            {items.length === 0 ? (
              <div className="px-3 py-2 text-[var(--text-3)] italic text-[12px]">
                {status === 'running' ? 'Waiting for output...' : 'No output yet'}
              </div>
            ) : (
              <div className="py-1">
                {items.map((item, i) => (
                  <OutputItemView key={i} item={item} fontFamily={outputFont} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

function HeaderBar({
  status, itemCount, isExpanded, onToggle, onClear,
}: {
  status: string; itemCount: number; isExpanded: boolean;
  onToggle: () => void; onClear: () => void;
}) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-[var(--veil)] transition-colors select-none group cursor-pointer"
    >
      {status === 'running' ? (
        <Loader2 className="w-2.5 h-2.5 animate-spin text-[var(--accent)]" />
      ) : status === 'error' ? (
        <Circle className="w-2 h-2 fill-[var(--red)] text-[var(--red)]" />
      ) : status === 'done' ? (
        <Circle className="w-2 h-2 fill-[var(--green)] text-[var(--green)]" />
      ) : itemCount > 0 ? (
        <Circle className="w-2 h-2 fill-[var(--text-4)] text-[var(--text-4)]" />
      ) : (
        <Circle className="w-2 h-2 text-[var(--text-4)] opacity-30" />
      )}
      <span className="text-[var(--text-2)] flex-1 text-left">
        Output {itemCount > 0 && <span className="text-[var(--text-4)]">· {itemCount} items</span>}
      </span>
      {itemCount > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--elevated)] text-[var(--text-4)] hover:text-[var(--text-1)] transition-all"
          title="Clear">
          <Trash2 className="w-3 h-3" />
        </button>
      )}
      <span className="text-[var(--text-4)] group-hover:text-[var(--text-2)]">
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
      </span>
    </div>
  );
}

// Regex for image file extensions — used by result renderer and ImageGrid
const IMG_EXT_RE = /\.(jpe?g|png|gif|bmp|webp|tiff?|svg)$/i;

function OutputItemView({ item, fontFamily }: { item: OutputItem; fontFamily: string }) {
  switch (item.kind) {
    case 'heading':
      return (
        <div className="px-3 py-2 text-[var(--text-1)] text-[12px] font-semibold tracking-wide" style={{ fontFamily }}>
          {item.content}
        </div>
      );

    case 'code':
      return (
        <div className="px-3 py-1">
          {item.label && (
            <div className="text-[10px] text-[var(--text-3)] mb-1" style={{ fontFamily }}>{item.label}</div>
          )}
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-1.5 text-[12px] text-[var(--text-1)] whitespace-pre-wrap break-all"
            style={{ fontFamily }}
          >
            {item.content}
          </div>
        </div>
      );

    case 'result':
      if (!item.content.trim()) return null;
      const isSuccess = item.content.startsWith('✔') || item.content.startsWith('✅');
      const isError = item.content.startsWith('✖') || item.content.startsWith('❌');
      const isWarn = item.content.startsWith('⚠') || item.content.startsWith('△');

      // Always try to parse as tabular file listing — raw text is the fallback
      const files = parseFileListing(item.content);
      const hasImages = IMG_EXT_RE.test(item.content);

      return (
        <div
          className={`px-3 py-0.5 text-[12px] whitespace-pre-wrap break-all ${
            isSuccess ? 'text-[var(--green)]'
            : isError ? 'text-[var(--red)]'
            : isWarn ? 'text-[var(--yellow)]'
            : 'text-[var(--text-1)]'
          }`}
          style={{ fontFamily }}
        >
          {files.length > 0 ? <FileListView files={files} fontFamily={fontFamily} /> : item.content}
          {hasImages && <ImageGrid text={item.content} />}
        </div>
      );

    case 'info':
      return (
        <div
          className="px-3 py-0.5 text-[11px] text-[var(--text-3)] whitespace-pre-wrap break-all"
          style={{ fontFamily }}
        >
          {item.content}
        </div>
      );

    case 'separator':
      return <div className="mx-3 my-1.5 border-t border-[var(--border)]" />;

    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// File list parser & renderer
// ═══════════════════════════════════════════════════════════════════

interface ParsedFile {
  mode: string;
  isDir: boolean;
  name: string;
  size: string;
  date: string;
  path: string;
}

// ── Icon system ───────────────────────────────────────────────────

const KNOWN_APPS: Record<string, { Icon: typeof Folder; color: string }> = {
  cursor:    { Icon: FileCode, color: 'text-purple-300' },
  vscode:    { Icon: FileCode, color: 'text-blue-400' },
  'visual studio': { Icon: FileCode, color: 'text-purple-400' },
  intellij:  { Icon: FileCode, color: 'text-orange-400' },
  chrome:    { Icon: Globe,    color: 'text-blue-400' },
  firefox:   { Icon: Globe,    color: 'text-orange-500' },
  edge:      { Icon: Globe,    color: 'text-cyan-400' },
  wechat:    { Icon: Bot,      color: 'text-green-400' },
  steam:     { Icon: Box,      color: 'text-blue-600' },
  comfyui:   { Icon: Cpu,      color: 'text-purple-300' },
  photoshop: { Icon: FileImage, color: 'text-blue-500' },
  office:    { Icon: FileText, color: 'text-red-400' },
  terminal:  { Icon: Terminal, color: 'text-gray-300' },
  powershell:{ Icon: Terminal, color: 'text-blue-300' },
  node:      { Icon: Box,      color: 'text-green-400' },
  python:    { Icon: Terminal, color: 'text-yellow-400' },
  git:       { Icon: Box,      color: 'text-orange-500' },
  docker:    { Icon: Box,      color: 'text-blue-400' },
  database:  { Icon: Database, color: 'text-orange-400' },
};

function matchKnownApp(name: string): { Icon: typeof Folder; color: string } | null {
  const lower = name.toLowerCase().replace(/\.lnk$/i, '');
  for (const [key, app] of Object.entries(KNOWN_APPS)) {
    if (lower.includes(key)) return app;
  }
  return null;
}

function getFileIconComponent(name: string, isDir: boolean): { Icon: typeof Folder; color: string } {
  if (isDir) return { Icon: Folder, color: 'text-[var(--blue)]' };
  const known = matchKnownApp(name);
  if (known) return known;
  if (/\.lnk$/i.test(name)) return { Icon: Link, color: 'text-[var(--text-3)]' };

  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (/^(exe|msi|dll|sys|bat|cmd|ps1)$/.test(ext)) return { Icon: Box, color: 'text-green-400' };
  if (/^(js|ts|jsx|tsx|py|rs|go|java|c|cpp|h|hpp|cs|rb|php|swift|kt)$/.test(ext)) return { Icon: FileCode, color: 'text-yellow-400' };
  if (/^(png|jpg|jpeg|gif|bmp|svg|ico|webp|tiff)$/.test(ext)) return { Icon: FileImage, color: 'text-purple-400' };
  if (/^(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|rtf|csv)$/.test(ext)) return { Icon: FileText, color: 'text-[var(--text-2)]' };
  if (/^(zip|rar|7z|tar|gz|xz|bz2)$/.test(ext)) return { Icon: FileArchive, color: 'text-orange-300' };
  if (/^(mp3|wav|flac|aac|ogg|wma|m4a)$/.test(ext)) return { Icon: FileAudio, color: 'text-pink-400' };
  if (/^(mp4|avi|mkv|mov|wmv|flv|webm)$/.test(ext)) return { Icon: FileVideo, color: 'text-red-400' };
  if (/^(html|htm|css|scss|less|json|xml|yaml|yml|toml)$/.test(ext)) return { Icon: Globe, color: 'text-cyan-400' };
  if (/^(sh|bash|zsh|fish)$/.test(ext)) return { Icon: Terminal, color: 'text-green-300' };

  return { Icon: File, color: 'text-[var(--text-3)]' };
}

// ── Table renderer ────────────────────────────────────────────────

function FileListView({ files, fontFamily }: { files: ParsedFile[]; fontFamily: string }) {
  if (!files || files.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded border border-[var(--border)]">
      <table className="w-full text-[12px]" style={{ fontFamily }}>
        <thead>
          <tr className="bg-[var(--raised)] text-[var(--text-2)] text-[10px] uppercase tracking-wide border-b border-[var(--border)]">
            <th className="text-left pl-3 pr-1 py-1.5 font-medium w-8"></th>
            <th className="text-left px-1 py-1.5 font-medium">名称</th>
            <th className="text-right px-1 py-1.5 font-medium w-20">大小</th>
            <th className="text-right pr-3 pl-1 py-1.5 font-medium w-44">修改时间</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => {
            const { Icon, color } = getFileIconComponent(f.name, f.isDir);
            return (
              <tr
                key={i}
                className={`cursor-pointer transition-colors ${
                  i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--deep)]'
                } hover:bg-[var(--elevated)]`}
                onClick={() => {
                  const dir = f.isDir ? f.path : f.path.replace(/[\\/][^\\/]+$/, '');
                  invoke('open_in_explorer', { path: dir || f.path }).catch(() => {});
                }}
                title={`点击打开所在文件夹: ${f.path}`}
              >
                <td className="pl-3 pr-1 py-1.5 text-center">
                  <Icon className={`w-4 h-4 ${color}`} />
                </td>
                <td className={`px-1 py-1.5 truncate max-w-[300px] ${f.isDir ? 'text-[var(--blue)] font-semibold' : 'text-[var(--text-1)]'}`}>
                  {f.name}
                </td>
                <td className="px-1 py-1.5 text-right text-[var(--text-3)] tabular-nums">
                  {f.isDir ? '—' : f.size}
                </td>
                <td className="pr-3 pl-1 py-1.5 text-right text-[var(--text-3)] tabular-nums">
                  {f.date}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Content-based column parser ───────────────────────────────────

/** Column classifier patterns. Applied to each split token; the first
 *  match wins.  'name' is the catch-all for tokens that don't match
 *  mode/date/size/placeholder. */
const COL_PATTERNS: { key: string; re: RegExp }[] = [
  { key: 'mode', re: /^[d-][-arwhs]{3,}$/ },
  { key: 'date', re: /^\d{4}-\d{2}-\d{2}$/ },
  { key: 'size', re: /^\d+$/ },
  { key: 'time', re: /^\d{1,2}:\d{2}(:\d{2})?$/ },
  { key: 'skip', re: /^[-—]+$/ },
];

function classifyCol(token: string): string {
  for (const p of COL_PATTERNS) {
    if (p.re.test(token)) return p.key;
  }
  // If token is empty or looks like a header (Chinese/English), skip it
  if (!token || /^(名称|大小|修改时间|Name|Length|Mode|LastWriteTime)$/i.test(token)) return 'skip';
  return 'name';
}

/** Parse tabular output into structured file entries.
 *  Fully content-based: each column is classified by its value pattern,
 *  not by its position.  Works with any column order (Get-ChildItem raw,
 *  Format-Table, any localized headers). */
function parseFileListing(text: string): ParsedFile[] {
  const lines = text.split('\n');
  const files: ParsedFile[] = [];

  let basePath = '';
  const pathMatch = text.match(/(?:目录|Ŀ¼|Directory):\s*(.+)/im);
  if (pathMatch) basePath = pathMatch[1].trim();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('PS ') || line.startsWith('>')) continue;

    // Split on 2+ spaces (PowerShell tabular); fall back to single space
    let cols = line.split(/\s{2,}/).filter(Boolean);
    if (cols.length < 2) cols = line.split(/\s+/).filter(Boolean);
    if (cols.length < 2) continue;

    // Classify every column
    const classified = cols.map(classifyCol);

    // Must have a name and a date to be a valid row
    if (!classified.includes('name') || !classified.includes('date')) continue;

    // Extract values by classification
    const nameParts: string[] = [];
    let mode = '';
    let date = '';
    let sizeNum = 0;

    for (let i = 0; i < cols.length; i++) {
      switch (classified[i]) {
        case 'name': nameParts.push(cols[i]); break;
        case 'mode': mode = cols[i]; break;
        case 'date': date = cols[i]; break;
        case 'size': sizeNum = parseInt(cols[i], 10) || sizeNum; break;
        case 'time':
          if (date) date += ' ' + cols[i];
          break;
      }
    }

    let name = nameParts.join(' ').trim();

    // Strip leading number (size bled from adjacent column, e.g. "2352 ComfyUI.lnk")
    const leadingNum = name.match(/^(\d+)\s+(.+)$/);
    if (leadingNum) {
      if (sizeNum === 0) sizeNum = parseInt(leadingNum[1], 10);
      name = leadingNum[2].trim();
    }

    if (!name) continue;

    const isDir = mode ? mode.startsWith('d') : (sizeNum === 0 && !/\.[a-z]{2,4}$/i.test(name));
    const size = isDir || sizeNum === 0 ? '—' : formatFileSize(sizeNum);

    files.push({
      mode: isDir ? 'd-----' : '-a----',
      isDir,
      name,
      size,
      date,
      path: basePath ? `${basePath}\\${name}` : name,
    });
  }

  return files;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Image thumbnail grid ─────────────────────────────────────────

function extractImagePaths(text: string): string[] {
  return text.split('\n')
    .map((l) => l.trim())
    .filter((l) => IMG_EXT_RE.test(l) && l.length < 500)
    .slice(0, 20);
}

function ImageGrid({ text }: { text: string }) {
  const paths = extractImagePaths(text);
  if (paths.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="text-[10px] text-[var(--text-3)] mb-1.5 px-1">
        🖼️ 图片预览 ({paths.length} 张)
      </div>
      <div className="flex flex-wrap gap-2">
        {paths.map((p, i) => (
          <Thumbnail key={i} path={p} />
        ))}
      </div>
    </div>
  );
}

function Thumbnail({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke('read_image_base64', { path })
      .then((b64: unknown) => {
        const s = b64 as string;
        if (!cancelled && s) setSrc(s);
        else if (!cancelled) setErr(true);
      })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [path]);

  if (err || !src) {
    return (
      <div className="w-[120px] h-[120px] bg-[var(--surface)] border border-[var(--border)] rounded flex items-center justify-center text-[10px] text-[var(--text-4)]">
        {err ? '加载失败' : '...'}
      </div>
    );
  }

  return (
    <div className="w-[120px] h-[120px] bg-[var(--surface)] border border-[var(--border)] rounded overflow-hidden group relative">
      <img
        src={src}
        alt={path}
        className="w-full h-full object-cover hover:scale-105 transition-transform"
        title={path}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white px-1 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
        {path.split(/[\\/]/).pop()}
      </div>
    </div>
  );
}
