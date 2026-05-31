import { useRef, useEffect, forwardRef, useCallback, useState } from 'react';
import {
  ChevronUp, ChevronDown, Trash2, Loader2, Circle,
  Expand, Shrink, Square,
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
    // Global expand/collapse: null = per-item, true = all open, false = all closed
    const [allExpanded, setAllExpanded] = useState<boolean | null>(null);

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
        <HeaderBar status={status} itemCount={items.length} isExpanded={isExpanded} onToggle={handleToggle} onClear={clear} onExpandAll={() => setAllExpanded(true)} onCollapseAll={() => setAllExpanded(false)} />

        <div
          ref={ref}
          className={`transition-[max-height] duration-300 ease-in-out ${
            isExpanded ? 'border-t border-[var(--border)]' : ''
          }`}
          style={{
            maxHeight: isExpanded ? outputHeight : 0,
            height: isExpanded ? outputHeight : 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            ref={containerRef}
            className="flex-1 min-h-0"
            style={{ fontFamily: outputFont, overflowY: 'auto' }}
          >
            {items.length === 0 ? (
              <div className="px-3 py-2 text-[var(--text-3)] italic text-[12px]">
                {status === 'running' ? 'Waiting for output...' : 'No output yet'}
              </div>
            ) : (
              <div className="py-1">
                {items.map((item, i) => (
                  <OutputItemView key={i} item={item} fontFamily={outputFont} allExpanded={allExpanded} />
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
  status, itemCount, isExpanded, onToggle, onClear, onExpandAll, onCollapseAll,
}: {
  status: string; itemCount: number; isExpanded: boolean;
  onToggle: () => void; onClear: () => void;
  onExpandAll: () => void; onCollapseAll: () => void;
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
      {status === 'running' && (
        <button onClick={(e) => { e.stopPropagation(); useOutputStore.getState().onCancel?.(); }}
          className="p-0.5 rounded bg-[var(--red)] text-white hover:bg-red-600 transition-colors"
          title="停止任务">
          <Square className="w-2.5 h-2.5" />
        </button>
      )}
      {itemCount > 0 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); onExpandAll(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--elevated)] text-[var(--text-4)] hover:text-[var(--text-1)] transition-all"
            title="展开所有">
            <Expand className="w-3 h-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onCollapseAll(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--elevated)] text-[var(--text-4)] hover:text-[var(--text-1)] transition-all"
            title="折叠所有">
            <Shrink className="w-3 h-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--elevated)] text-[var(--text-4)] hover:text-[var(--text-1)] transition-all"
            title="清空">
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}
      <span className="text-[var(--text-4)] group-hover:text-[var(--text-2)]">
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
      </span>
    </div>
  );
}

// Regex for image file extensions — used by result renderer and ImageGrid
const IMG_EXT_RE = /\.(jpe?g|png|gif|bmp|webp|tiff?|svg)$/i;

// ── Thinking block parser ────────────────────────────────────────

interface TextChunk {
  type: 'thinking' | 'text';
  content: string;
}

const THINKING_RE = /<thinking>([\s\S]*?)<\/thinking>/g;

function parseThinkingBlocks(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = THINKING_RE.exec(text)) !== null) {
    // Text before the thinking block
    if (match.index > lastIdx) {
      const before = text.slice(lastIdx, match.index).trim();
      if (before) chunks.push({ type: 'text', content: before });
    }
    // The thinking content itself
    const thinkingContent = match[1].trim();
    if (thinkingContent) chunks.push({ type: 'thinking', content: thinkingContent });
    lastIdx = match.index + match[0].length;
  }

  // Remaining text after last thinking block
  if (lastIdx < text.length) {
    const after = text.slice(lastIdx).trim();
    if (after) chunks.push({ type: 'text', content: after });
  }

  return chunks.length > 0 ? chunks : [{ type: 'text', content: text }];
}

function ThinkingBlock({ content, fontFamily, stepStatus, allExpanded }: { content: string; fontFamily: string; stepStatus?: string; allExpanded: boolean | null }) {
  const s = stepStatus || 'done';
  const isRunning = s === 'running';
  const isPending = s === 'pending';
  const isError = s === 'error';
  const open = allExpanded !== null ? allExpanded : (isRunning || isPending);

  const statusIcon = isRunning ? '💭' : isPending ? '⏳' : isError ? '❌' : '✅';
  const statusText = isRunning ? '执行中...' : isPending ? '等待执行...' : isError ? '执行失败' : '已完成';

  return (
    <details className="my-1.5 mx-3 text-[11px]" open={open}>
      <summary className="flex items-center gap-1.5 cursor-pointer select-none text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors py-0.5">
        <span className="text-xs">{statusIcon}</span>
        <span className={`font-medium tracking-wide ${isRunning ? 'text-[var(--accent)]' : isError ? 'text-[var(--red)]' : ''}`}>
          {statusText}
        </span>
        {isRunning && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse ml-0.5" />}
      </summary>
      <div
        className="mt-1.5 pl-5 py-2 pr-2 border-l-2 border-[var(--border-hi)] text-[var(--text-3)] whitespace-pre-wrap break-all leading-relaxed"
        style={{ fontFamily }}
      >
        {content}
      </div>
    </details>
  );
}

// ── Output item renderer ─────────────────────────────────────────

function OutputItemView({ item, fontFamily, allExpanded }: { item: OutputItem; fontFamily: string; allExpanded: boolean | null }) {
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

    case 'result': {
      if (!item.content.trim()) return null;
      const isSuccess = item.content.startsWith('✔') || item.content.startsWith('✅');
      const isError = item.content.startsWith('✖') || item.content.startsWith('❌');
      const isWarn = item.content.startsWith('⚠') || item.content.startsWith('△');

      // Parse thinking blocks from content
      const chunks = parseThinkingBlocks(item.content);
      const plainText = chunks.filter((c) => c.type === 'text').map((c) => c.content).join('\n');

      // Attempt JSON parsing for ConvertTo-Json output
      let jsonFiles: ParsedFile[] | null = null;
      const jsonMatch = plainText.match(/^\[[\s\S]*\]$/);
      if (jsonMatch) {
        try {
          const arr = JSON.parse(jsonMatch[0]);
          if (Array.isArray(arr) && arr.length > 0 && arr[0].Name !== undefined && arr[0].FullName !== undefined) {
            jsonFiles = arr.map((f: any) => ({
              mode: '-a----',
              isDir: false,
              name: String(f.Name || ''),
              size: f.Length ? formatFileSize(Number(f.Length)) : '—',
              date: formatJsonDate(f.LastWriteTime),
              path: String(f.FullName || ''),
            }));
          }
        } catch { /* not valid JSON */ }
      }

      const files = jsonFiles || parseFileListing(plainText);
      // Extract image paths from JSON if available
      const imagePaths = jsonFiles
        ? jsonFiles.filter((f) => IMG_EXT_RE.test(f.name)).map((f) => f.path)
        : [];

      // Auto-collapse long text AND large image lists (> 15 lines or > 800 chars)
      const isLong = !files.length &&
        (plainText.split('\n').length > 15 || plainText.length > 800);

      // Image preview: use JSON paths if available, otherwise extract from plain text
      const previewPaths = jsonFiles ? imagePaths : extractImagePaths(plainText);
      const showImageGrid = previewPaths.length > 0;

      const lines = plainText.split('\n');

      return (
        <div
          className={`text-[12px] whitespace-pre-wrap break-all ${
            isSuccess ? 'text-[var(--green)]'
            : isError ? 'text-[var(--red)]'
            : isWarn ? 'text-[var(--yellow)]'
            : 'text-[var(--text-1)]'
          }`}
          style={{ fontFamily }}
        >
          {/* Render thinking blocks first */}
          {chunks.filter((c) => c.type === 'thinking').map((chunk, i) => (
            <ThinkingBlock key={`think-${i}`} content={chunk.content} fontFamily={fontFamily} stepStatus={item.stepStatus || 'done'} allExpanded={allExpanded} />
          ))}
          {/* Image preview — always visible, never collapsed */}
          {showImageGrid && <ImageGrid text={jsonFiles ? '' : plainText} paths={jsonFiles ? previewPaths : undefined} />}
          {/* Render text content: file list if parsed, otherwise plain text.
               Long text (>15 lines / >800 chars) auto-collapses (images excluded). */}
          {files.length > 0 ? (
            <div className="px-3 py-0.5">
              <FileListView files={files} fontFamily={fontFamily} />
            </div>
          ) : isLong ? (
            <details className="my-1 mx-3" open={allExpanded ?? false}>
              <summary className="text-[11px] cursor-pointer select-none py-0.5 group">
                <span className="text-[var(--text-3)] group-hover:text-[var(--text-2)] transition-colors">
                  📋 命令输出 · {lines.length} 行 — 点击展开
                </span>
              </summary>
              <div className="mt-1 max-h-[400px] overflow-y-auto">
                {chunks.filter((c) => c.type === 'text').map((chunk, i) => (
                  <div key={`text-${i}`} className="px-1 py-0.5 whitespace-pre-wrap break-all" style={{ fontFamily }}>
                    {chunk.content}
                  </div>
                ))}
              </div>
            </details>
          ) : (
            chunks.filter((c) => c.type === 'text').map((chunk, i) => (
              <div key={`text-${i}`} className="px-3 py-0.5">{chunk.content}</div>
            ))
          )}
        </div>
      );
    }

    case 'info': {
      const infoChunks = parseThinkingBlocks(item.content);
      return (
        <div>
          {infoChunks.map((chunk, i) =>
            chunk.type === 'thinking' ? (
              <ThinkingBlock key={i} content={chunk.content} fontFamily={fontFamily} stepStatus={item.stepStatus || 'done'} allExpanded={allExpanded} />
            ) : (
              <div
                key={i}
                className="px-3 py-0.5 text-[11px] text-[var(--text-3)] whitespace-pre-wrap break-all"
                style={{ fontFamily }}
              >
                {chunk.content}
              </div>
            ),
          )}
        </div>
      );
    }

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
  const [sortKey, setSortKey] = useState<'name' | 'size' | 'date'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(files.length / pageSize));

  if (!files || files.length === 0) return null;

  // Sort
  const sorted = [...files].sort((a, b) => {
    let va: string | number, vb: string | number;
    if (sortKey === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
    else if (sortKey === 'size') { va = parseSize(a.size); vb = parseSize(b.size); }
    else { va = a.date; vb = b.date; }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    // Dirs first as tiebreaker
    return a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1;
  });

  const pageItems = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  };

  const SortIcon = ({ col }: { col: typeof sortKey }) => (
    <span className="ml-0.5 text-[var(--text-4)]">
      {sortKey === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </span>
  );

  return (
    <div>
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-[12px]" style={{ fontFamily }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--raised)] text-[var(--text-2)] text-[10px] uppercase tracking-wide border-b border-[var(--border)]">
              <th className="text-left pl-3 pr-1 py-1.5 font-medium w-8"></th>
              <th className="text-left px-1 py-1.5 font-medium cursor-pointer hover:text-[var(--text-1)] select-none" onClick={() => handleSort('name')}>
                名称<SortIcon col="name" />
              </th>
              <th className="text-right px-1 py-1.5 font-medium w-20 cursor-pointer hover:text-[var(--text-1)] select-none" onClick={() => handleSort('size')}>
                大小<SortIcon col="size" />
              </th>
              <th className="text-right pr-3 pl-1 py-1.5 font-medium w-44 cursor-pointer hover:text-[var(--text-1)] select-none" onClick={() => handleSort('date')}>
                修改时间<SortIcon col="date" />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((f, i) => {
              const { Icon, color } = getFileIconComponent(f.name, f.isDir);
              return (
                <tr
                  key={`${page}-${i}`}
                  className={`cursor-pointer transition-all duration-200 ease-out group ${
                    i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--deep)]'
                  } hover:bg-[var(--elevated)] hover:shadow-[inset_2px_0_0_var(--accent)]`}
                  onClick={() => {
                    const dir = f.isDir ? f.path : f.path.replace(/[\\/][^\\/]+$/, '');
                    invoke('open_in_explorer', { path: dir || f.path }).catch(() => {});
                  }}
                  title={f.path}
                >
                  <td className="pl-3 pr-1 py-1.5 text-center">
                    <Icon className={`w-4 h-4 ${color}`} />
                  </td>
                  <td className={`px-1 py-1.5 truncate max-w-[300px] transition-colors duration-200 ${
                    f.isDir ? 'text-[var(--blue)] font-semibold group-hover:text-[var(--blue)]' : 'text-[var(--text-1)]'
                  }`}>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[var(--text-3)]" style={{ fontFamily }}>
          <span>{files.length} 项 · 第 {page + 1}/{totalPages} 页</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--veil)] disabled:opacity-30 disabled:cursor-default">
              ««
            </button>
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--veil)] disabled:opacity-30 disabled:cursor-default">
              ‹
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const start = Math.max(0, Math.min(page - 3, totalPages - 7));
              const p = start + i;
              if (p >= totalPages) return null;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-6 h-5 rounded text-[10px] ${p === page ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--veil)]'}`}>
                  {p + 1}
                </button>
              );
            })}
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--veil)] disabled:opacity-30 disabled:cursor-default">
              ›
            </button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--veil)] disabled:opacity-30 disabled:cursor-default">
              »»
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Parse size string like "2.3 KB" to bytes for sorting. */
function parseSize(s: string): number {
  if (s === '—') return -1;
  const m = s.match(/^([\d.]+)\s*(B|KB|MB|GB)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'B').toUpperCase();
  return n * (unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : unit === 'KB' ? 1e3 : 1);
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

/** Parse various JSON date formats into "yyyy-MM-dd HH:mm:ss". */
function formatJsonDate(v: any): string {
  if (!v) return '—';
  const s = String(v);
  // /Date(1749969314993)/
  const msMatch = s.match(/\/Date\((\d+)\)\//);
  if (msMatch) {
    const d = new Date(parseInt(msMatch[1], 10));
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
  }
  // ISO 8601: "2024-05-27T20:34:44"
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    return s.replace('T', ' ').slice(0, 19);
  }
  // Already formatted: "2024-05-27 20:34:44"
  if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 19);
  return s.slice(0, 19) || '—';
}

// ── Image thumbnail grid ─────────────────────────────────────────

function extractImagePaths(text: string): string[] {
  const lines = text.split('\n');

  // Strategy 1: Simple path list — each line is a full path
  const simple = lines
    .map((l) => l.trim())
    .filter((l) => IMG_EXT_RE.test(l) && l.length >= 3 && l.length < 500);
  if (simple.length > 0) return simple;

  // Strategy 2: Format-Table — reconstruct paths from Name + DirectoryName
  const paths: string[] = [];
  let dirIdx = -1;
  for (const raw of lines) {
    const cols = raw.trim().split(/\s{2,}/);
    if (cols.length < 2) continue;
    if (dirIdx < 0) dirIdx = cols.findIndex((c) => /^[A-Z]:\\/i.test(c) || /^\//.test(c));
    if (dirIdx < 0) continue;
    const dir = (cols[dirIdx] || '').trim();
    for (let i = 0; i < dirIdx; i++) {
      if (IMG_EXT_RE.test(cols[i])) {
        paths.push(`${dir}\\${cols[i].trim()}`.replace(/\\\\/g, '\\'));
        break;
      }
    }
  }
  return paths;
}

function ImageGrid({ text, paths: prePaths }: { text: string; paths?: string[] }) {
  const allPaths = prePaths && prePaths.length > 0 ? prePaths : extractImagePaths(text);
  if (allPaths.length === 0) return null;
  const displayPaths = allPaths.slice(0, 20);
  const truncated = allPaths.length > 20;

  return (
    <div className="mt-2 px-3">
      <span className="text-[10px] text-[var(--text-3)]">
        🖼️ 图片预览 · {allPaths.length} 张
        {truncated && <span className="text-[var(--text-4)] ml-1">(展示前 20 张)</span>}
      </span>
      <CardDeck paths={displayPaths} />
    </div>
  );
}

// ── Card deck layout ─────────────────────────────────────────────

function CardDeck({ paths }: { paths: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelW, setPanelW] = useState(0);
  const display = paths.slice(0, 20);

  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (el.clientWidth > 0) setPanelW(el.clientWidth); });
    ro.observe(el);
    if (el.clientWidth > 0) setPanelW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Responsive: fit all cards in one row, shrink as needed
  const gap = 4;
  const padding = 24; // px-3 = 12px each side
  const available = Math.max(panelW - padding - (display.length - 1) * gap, 200);
  const cardW = Math.max(40, Math.floor(available / display.length));
  const aspectH = Math.round(cardW * 1.15); // slightly taller than wide

  return (
    <div
      ref={containerRef}
      className="px-3 flex flex-nowrap overflow-x-auto"
      style={{ gap }}
    >
      {display.map((p) => (
        <div key={p} className="flex-shrink-0" style={{ width: cardW, height: aspectH }}>
          <Thumbnail path={p} />
        </div>
      ))}
    </div>
  );
}

function Thumbnail({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const name = path.split(/[\\/]/).pop() || path;

  useEffect(() => {
    let cancelled = false;
    invoke('read_image_base64', { path })
      .then((b64: unknown) => {
        if (!cancelled && b64) setSrc(b64 as string);
        else if (!cancelled) setErr(true);
      })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [path]);

  const openDir = () => {
    const d = path.replace(/[\\/][^\\/]+$/, '');
    invoke('open_in_explorer', { path: d }).catch(() => {});
  };

  if (err || !src) {
    return (
      <div onClick={openDir} title={path}
        className="w-full h-full bg-[var(--surface)] border border-[var(--border)] rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ease-out hover:scale-110 hover:z-10 hover:shadow-lg hover:border-[var(--accent)]">
        <span className="text-[14px]">🖼️</span>
      </div>
    );
  }

  return (
    <div onClick={openDir} title={name}
      className="w-full h-full rounded-lg overflow-hidden cursor-pointer transition-all duration-300 ease-out hover:scale-110 hover:z-10 hover:shadow-[0_8px_25px_rgba(0,0,0,0.5)] border border-[var(--border)]">
      <img src={src} alt={name} className="w-full h-full object-cover" />
    </div>
  );
}
