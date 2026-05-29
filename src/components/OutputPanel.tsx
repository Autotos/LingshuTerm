import { useRef, useEffect, forwardRef } from 'react';
import { ChevronUp, ChevronDown, Trash2, Loader2, Circle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useOutputStore, type OutputItem } from '@/stores/outputStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Free commercially-usable monospace fonts with CJK support.
// Sarasa Mono SC (更纱黑体) is OFL-licensed, Cascadia Code is OFL, JetBrains Mono is OFL.
const OUTPUT_FONT_STACK =
  "'Cascadia Code', 'Sarasa Mono SC', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Noto Sans SC', 'Microsoft YaHei', monospace";

export const OutputPanel = forwardRef<HTMLDivElement, { outputHeight: number }>(
  function OutputPanel({ outputHeight }, ref) {
    const { items, status, isExpanded, toggle, clear } = useOutputStore();
    const outputFont = useSettingsStore((s) =>
      s.settings.terminal.outputFont || OUTPUT_FONT_STACK);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (isExpanded && items.length > 0) {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    }, [items, isExpanded]);

    return (
      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--deep)]">
        <HeaderBar status={status} itemCount={items.length} isExpanded={isExpanded} onToggle={toggle} onClear={clear} />

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
      // Detect file listing: raw Get-ChildItem, Format-Table, or ls -l output
      // Detect structured output: a line with a date pattern (YYYY-MM-DD) preceded by
      // a Mode column or name, indicating Get-ChildItem / Format-Table / ls output
      const isFileList = /\b\d{4}-\d{2}-\d{2}\b/.test(item.content) && item.content.split('\n').length >= 3;
      // Detect if this looks like a table (reserved for future use)
      // const isTable = /\S\s{2,}\S/.test(item.content) && item.content.split('\n').length > 2;

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
          {isFileList ? <FileListView text={item.content} fontFamily={fontFamily} /> : item.content}
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

// ── File list parser & renderer ───────────────────────────────────

interface ParsedFile {
  mode: string;      // d----- or -a----
  isDir: boolean;
  name: string;
  size: string;
  date: string;
  path: string;      // full desktop path, reconstructed
}

const FILE_ICONS: Record<string, string> = {
  dir: '📁', lnk: '🔗', exe: '⚙️', dll: '🔧',
  txt: '📄', md: '📝', json: '📋', xml: '📰', yaml: '📋', toml: '📋',
  js: '💛', ts: '💙', jsx: '💛', tsx: '💙', py: '🐍', rs: '🦀', go: '🔵', java: '☕',
  html: '🌐', css: '🎨', scss: '🎨',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', ico: '🖼️',
  pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
  zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
  mp3: '🎵', mp4: '🎬', wav: '🎵', flac: '🎵',
  ps1: '⚡', sh: '💚', bash: '💚', zsh: '💚',
};

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return FILE_ICONS.dir;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
}

function FileListView({ text, fontFamily }: { text: string; fontFamily: string }) {
  const files = parseFileListing(text);

  if (files.length === 0) {
    return <>{text}</>;
  }

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
          {files.map((f, i) => (
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
              <td className="pl-3 pr-1 py-1 text-center">{getFileIcon(f.name, f.isDir)}</td>
              <td className={`px-1 py-1 truncate max-w-[300px] ${f.isDir ? 'text-[var(--blue)] font-semibold' : 'text-[var(--text-1)]'}`}>
                {f.name}
              </td>
              <td className="px-1 py-1 text-right text-[var(--text-3)] tabular-nums">
                {f.isDir ? '—' : f.size}
              </td>
              <td className="pr-3 pl-1 py-1 text-right text-[var(--text-3)] tabular-nums">
                {f.date}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Parse tabular output into structured file entries.
 *  Content-based detection — does not depend on fixed Mode format or column widths. */
function parseFileListing(text: string): ParsedFile[] {
  const lines = text.split('\n');
  const files: ParsedFile[] = [];

  let basePath = '';
  const pathMatch = text.match(/(?:目录|Ŀ¼|Directory):\s*(.+)/im);
  if (pathMatch) basePath = pathMatch[1].trim();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('PS ') || line.startsWith('>')) continue;
    if (/^(Mode|----|目录|Ŀ¼|Name|名称)/i.test(line)) continue;

    // Split into columns on 2+ spaces
    const cols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;

    // ── Find key columns by content type ──
    const dateIdx = cols.findIndex((c) => /^\d{4}-\d{2}-\d{2}$/.test(c));
    if (dateIdx < 0) continue;

    const timeIdx = dateIdx + 1;
    const hasTime = timeIdx < cols.length && /^\s?\d{1,2}:\d{2}(:\d{2})?$/.test(cols[timeIdx]);
    const date = hasTime ? `${cols[dateIdx]} ${cols[timeIdx]}` : cols[dateIdx];

    // Determine where the name is based on whether first column is a Mode
    const firstIsMode = /^[d-][-arwhs]{3,}$/.test(cols[0]);
    const sizeStart = hasTime ? timeIdx + 1 : dateIdx + 1;
    const hasSize = sizeStart < cols.length && /^\d+$/.test(cols[sizeStart]);
    const isDir = firstIsMode ? !hasSize : (!hasSize && !/\.[a-z]{2,4}$/i.test(cols[0]));

    let name: string;
    if (firstIsMode) {
      // Get-ChildItem raw: Mode, Date, Time, [Size], Name
      // Name is everything after the size (or after time if no size)
      const nameStart = hasSize ? sizeStart + 1 : sizeStart;
      name = cols.slice(nameStart).join(' ').trim();
    } else {
      // Format-Table: Name comes BEFORE date
      name = cols.slice(0, dateIdx).join(' ').trim();
    }

    if (!name) continue;

    const size = hasSize && !isDir ? formatFileSize(parseInt(cols[sizeStart], 10)) : '—';

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
