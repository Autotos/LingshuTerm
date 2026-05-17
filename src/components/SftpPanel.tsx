import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save } from '@tauri-apps/plugin-dialog';
import { RefreshCw, ChevronLeft, Loader2, AlertTriangle, Upload, FolderOpen, FolderSync } from 'lucide-react';
import { useSftp } from '@/hooks/useSftp';
import { useSessionStore } from '@/stores/sessionStore';
import { useSftpStore, type SftpFileEntry } from '@/stores/sftpStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { FileTreeNode } from './FileTreeNode';

interface SftpPanelProps {
  sessionId: string | null;
}

export function SftpPanel({ sessionId }: SftpPanelProps) {
  const store = useSftpStore();
  const { listDir, readFile, homeDir, deleteItem, renameItem, fileProperties, createDir, createFile } = useSftp(sessionId);
  const { toggleEditor } = useUiStore();

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [homeLoaded, setHomeLoaded] = useState(false);

  // ── Context menu state (file entry or empty-space) ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: SftpFileEntry } | null>(null);
  const [emptyCtxMenu, setEmptyCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // ── Inline rename state ──
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── Properties modal ──
  const [properties, setProperties] = useState<any>(null);

  // ── Mount debug ──
  const panelRef = useRef<HTMLDivElement>(null);

  const cwd = sessionId ? (store.cwd[sessionId] ?? '/') : '/';

  // Keep a ref to cwd so the drag-drop handler always reads the latest value.
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  useEffect(() => {
    console.log('[SFTP DnD] SftpPanel mounted, sessionId:', sessionId, 'cwd:', cwd);
    const el = panelRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      console.log('[SFTP DnD] Panel rect:', { w: rect.width, h: rect.height, x: rect.x, y: rect.y });
    }
  }, [sessionId, cwd]);
  const selectedPath = sessionId ? (store.selectedPath[sessionId] ?? null) : null;

  // ── Initial load: query home dir via SFTP ──
  const homeQueriedRef = useRef(false);
  useEffect(() => {
    if (!sessionId) return;
    if (homeQueriedRef.current) return;
    homeQueriedRef.current = true;
    (async () => {
      try {
        const home = await homeDir();
        if (home && home !== cwd) store.setCwd(sessionId, home);
        setHomeLoaded(true);
      } catch (e: any) {
        store.setCwd(sessionId, '/');
        setHomeLoaded(true);
        setError(e);
      }
    })();
  }, [sessionId]);

  // ── Load directory when cwd changes ──
  const prevCwdRef = useRef(cwd);
  useEffect(() => {
    if (!sessionId || !homeLoaded) return;
    prevCwdRef.current = cwd;
    (async () => {
      try {
        const entries = await listDir(cwd);
        store.setListing(`${sessionId}:${cwd}`, entries);
      } catch (e: any) { setError(e); }
    })();
  }, [sessionId, cwd, homeLoaded]);

  // ── Reset on session change ──
  useEffect(() => {
    homeQueriedRef.current = false;
    setHomeLoaded(false);
    prevCwdRef.current = '/';
    setExpandedPaths(new Set());
    setError(null);
    setCtxMenu(null);
    setRenamingPath(null);
    setProperties(null);
  }, [sessionId]);

  const loadDirectory = useCallback(async (path: string) => {
    if (!sessionId) return;
    setLoadingPaths((prev) => new Set(prev).add(path));
    try { await listDir(path); } catch (e: any) { setError(e); }
    finally {
      setLoadingPaths((prev) => { const n = new Set(prev); n.delete(path); return n; });
    }
  }, [sessionId, listDir]);

  const handleNavigate = useCallback((path: string) => {
    if (!sessionId) return;
    store.setCwd(sessionId, path);
    loadDirectory(path);
  }, [sessionId, store, loadDirectory]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); }
      else { next.add(path); loadDirectory(path); }
      return next;
    });
  }, [loadDirectory]);

  const handleSelect = useCallback((path: string) => {
    if (sessionId) store.setSelectedPath(sessionId, path);
  }, [sessionId, store]);

  const handleOpenFile = useCallback(async (path: string) => {
    if (!sessionId) return;
    try {
      const content = await readFile(path);
      const fileName = path.split('/').pop() || path;

      // Find the UI session ID that owns this terminal connection.
      // EditorPanel reads editor data by UI session UUID, but SftpPanel
      // receives the terminal connectionId (e.g. "ssh-1") — key mismatch!
      const sessions = useSessionStore.getState().sessions;
      let uiSessionId: string | null = null;
      for (const [id, s] of sessions) {
        if (s.terminals.some((t) => t.connectionId === sessionId)) {
          uiSessionId = id;
          break;
        }
      }
      // Fall back to connectionId if lookup fails (shouldn't happen)
      const editorSessionId = uiSessionId || sessionId;

      if (!useUiStore.getState().isEditorVisible) toggleEditor();
      useEditorStore.getState().openFile(editorSessionId, `sftp:${fileName}`, content);
    } catch (e: any) { setError(e); }
  }, [sessionId, readFile, toggleEditor]);

  const handleRefresh = useCallback(() => {
    if (!sessionId) return;
    const cacheKey = `${sessionId}:${cwd}`;
    // Use fresh state (not closure's stale `store.listings`)
    const fresh = useSftpStore.getState();
    const next = { ...fresh.listings };
    delete next[cacheKey];
    useSftpStore.setState({ listings: next });
    loadDirectory(cwd);
  }, [sessionId, cwd, loadDirectory]);

  const handleGoUp = useCallback(() => {
    if (!sessionId || cwd === '/') return;
    const parent = cwd.substring(0, cwd.lastIndexOf('/')) || '/';
    store.setCwd(sessionId, parent);
    loadDirectory(parent);
  }, [sessionId, cwd, store, loadDirectory]);

  const [syncingCwd, setSyncingCwd] = useState(false);
  const handleSyncCwd = useCallback(async () => {
    if (!sessionId) return;
    setSyncingCwd(true);
    try {
      const newCwd: string = await invoke('get_terminal_cwd', { sessionId });
      if (newCwd && newCwd !== cwd) store.setCwd(sessionId, newCwd);
    } catch (e: any) { setError(`Sync failed: ${e}`); }
    finally { setSyncingCwd(false); }
  }, [sessionId, cwd, store]);

  // ── Context menu handler ──
  const handleContextMenu = useCallback((e: React.MouseEvent, entry: SftpFileEntry) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  // ── Context menu actions ──
  const handleCtxOpen = useCallback(() => {
    if (!ctxMenu) return;
    if (ctxMenu.entry.isDir) handleNavigate(ctxMenu.entry.path);
    else handleOpenFile(ctxMenu.entry.path);
  }, [ctxMenu, handleNavigate, handleOpenFile]);

  const handleCtxDownload = useCallback(async () => {
    if (!ctxMenu || !sessionId) return;
    const entry = ctxMenu.entry;
    try {
      const filePath = await save({
        defaultPath: entry.name,
        title: `Download ${entry.name}`,
      });
      if (filePath) {
        await invoke('sftp_download_file', { sessionId, remotePath: entry.path, localPath: filePath });
      }
    } catch (e: any) { setError(`Download failed: ${e}`); }
  }, [ctxMenu, sessionId]);

  const handleCtxDelete = useCallback(async () => {
    if (!ctxMenu || !sessionId) return;
    const entry = ctxMenu.entry;
    const confirmed = window.confirm(
      `Delete "${entry.name}"${entry.isDir ? ' and all its contents' : ''}?\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await deleteItem(entry.path, entry.isDir);
      setCtxMenu(null);
      handleRefresh();
    } catch (e: any) { setError(`Delete failed: ${e}`); }
  }, [ctxMenu, sessionId, deleteItem, handleRefresh]);

  const handleCtxRename = useCallback(() => {
    if (!ctxMenu) return;
    setRenamingPath(ctxMenu.entry.path);
    setRenameValue(ctxMenu.entry.name);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleCtxProperties = useCallback(async () => {
    if (!ctxMenu || !sessionId) return;
    try {
      const props = await fileProperties(ctxMenu.entry.path);
      setProperties(props);
    } catch (e: any) { setError(`Properties failed: ${e}`); }
  }, [ctxMenu, sessionId, fileProperties]);

  // ── Empty-space context menu (right-click on blank area of file tree) ──
  const handleEmptyContextMenu = useCallback((e: React.MouseEvent) => {
    // Only fire if the click is directly on the container (not on a FileTreeNode)
    if ((e.target as HTMLElement).closest('[data-file-tree-node]')) return;
    e.preventDefault();
    e.stopPropagation();
    setEmptyCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleNewFolder = useCallback(async () => {
    if (!sessionId) return;
    const name = window.prompt('Folder name:');
    if (!name || !name.trim()) return;
    const folderPath = cwd === '/' ? `/${name.trim()}` : `${cwd}/${name.trim()}`;
    try {
      await createDir(folderPath);
      handleRefresh();
    } catch (e: any) { setError(`Create folder failed: ${e}`); }
  }, [sessionId, cwd, createDir, handleRefresh]);

  const handleNewFile = useCallback(async () => {
    if (!sessionId) return;
    const name = window.prompt('File name:');
    if (!name || !name.trim()) return;
    const filePath = cwd === '/' ? `/${name.trim()}` : `${cwd}/${name.trim()}`;
    try {
      await createFile(filePath);
      handleRefresh();
    } catch (e: any) { setError(`Create file failed: ${e}`); }
  }, [sessionId, cwd, createFile, handleRefresh]);

  // ── Build empty-space context menu items ──
  const emptyCtxMenuItems: ContextMenuItem[] = emptyCtxMenu ? [
    { label: 'New Folder', onClick: handleNewFolder },
    { label: 'New File', onClick: handleNewFile },
    { label: 'Refresh', onClick: handleRefresh },
    { label: 'Go Up', onClick: handleGoUp, disabled: cwd === '/' },
  ] : [];

  // ── Rename submit / cancel ──
  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !sessionId || !renameValue.trim()) return;
    const oldName = renamingPath.split('/').pop() || '';
    if (renameValue.trim() === oldName) { setRenamingPath(null); return; }
    try {
      await renameItem(renamingPath, renameValue.trim());
      setRenamingPath(null);
      handleRefresh();
    } catch (e: any) { setError(`Rename failed: ${e}`); }
  }, [renamingPath, sessionId, renameValue, renameItem, handleRefresh]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  // ── Build context menu items ──
  const ctxMenuItems: ContextMenuItem[] = ctxMenu ? [
    {
      label: ctxMenu.entry.isDir ? 'Open Directory' : 'Open File',
      onClick: handleCtxOpen,
    },
    {
      label: 'Download',
      onClick: handleCtxDownload,
      disabled: ctxMenu.entry.isDir,
    },
    { label: 'Rename', onClick: handleCtxRename },
    {
      label: 'Delete',
      onClick: handleCtxDelete,
      danger: true,
    },
    { label: 'Properties', onClick: handleCtxProperties },
  ] : [];

  const listings = sessionId ? (store.listings[`${sessionId}:${cwd}`] ?? []) : [];
  const isLoading = sessionId ? (store.loading[`${sessionId}:${cwd}`] ?? false) : false;

  // ── Upload progress state ──
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, name: '' });

  // ── Drag-over visual state (via Tauri native events) ──
  const [dragOver, setDragOver] = useState(false);

  // ── Tauri native drag-drop listener ──
  // Use a ref for sessionId so the handler always reads the latest value,
  // preventing stale-closure bugs and double-listener races.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let insidePanel = false;

    const setup = async () => {
      try {
        const win = getCurrentWindow();
        if (cancelled) return;
        unlisten = await win.onDragDropEvent(async (event) => {
          // Skip stale callbacks from cancelled effect runs
          if (cancelled) return;
          const { type } = event.payload;
          const sid = sessionIdRef.current;

          if (type === 'enter') {
            const el = panelRef.current;
            if (el) {
              const rect = el.getBoundingClientRect();
              const pos = event.payload.position;
              const scale = window.devicePixelRatio || 1;
              insidePanel = (pos.x / scale) >= rect.left && (pos.x / scale) <= rect.right
                         && (pos.y / scale) >= rect.top && (pos.y / scale) <= rect.bottom;
            }
            if (insidePanel) setDragOver(true);
          } else if (type === 'over') {
            const el = panelRef.current;
            if (el) {
              const rect = el.getBoundingClientRect();
              const pos = event.payload.position;
              const scale = window.devicePixelRatio || 1;
              insidePanel = (pos.x / scale) >= rect.left && (pos.x / scale) <= rect.right
                         && (pos.y / scale) >= rect.top && (pos.y / scale) <= rect.bottom;
            }
            if (insidePanel && !dragOver) setDragOver(true);
          } else if (type === 'leave') {
            insidePanel = false;
            setDragOver(false);
          } else if (type === 'drop') {
            setDragOver(false);
            insidePanel = false;

            const paths = event.payload.paths;
            if (!paths || paths.length === 0) return;

            if (!sid) {
              setError('No active SSH session to upload to');
              return;
            }

            const currentCwd = cwdRef.current || '/';
            console.log('[SFTP DnD] Upload to:', currentCwd, 'files:', paths);

            setUploading(true);
            let uploaded = 0;
            let failed = 0;
            const errors: string[] = [];

            for (let i = 0; i < paths.length; i++) {
              const localPath = paths[i];
              const fileName = localPath.replace(/\\/g, '/').split('/').pop() || localPath;
              const remotePath = currentCwd === '/' ? `/${fileName}` : `${currentCwd}/${fileName}`;
              setUploadProgress({ current: i + 1, total: paths.length, name: fileName });

              try {
                await invoke('sftp_upload_file', { sessionId: sid, localPath, remotePath });
                uploaded++;
              } catch (err: any) {
                const msg = typeof err === 'string' ? err : String(err);
                errors.push(msg.includes('Permission denied')
                  ? `${fileName}: Permission denied — cannot write to '${currentCwd}'`
                  : `${fileName}: ${msg}`);
                failed++;
              }
            }

            console.log(`[SFTP DnD] Done: ${uploaded} ok, ${failed} failed`, errors);
            setUploading(false);
            setUploadProgress({ current: 0, total: 0, name: '' });
            if (errors.length > 0) setError(`Upload: ${uploaded} ok, ${failed} failed — ${errors.join('; ')}`);
            handleRefresh();
          }
        });
        if (!cancelled) console.log('[SFTP DnD] Listener registered');
      } catch (e) {
        console.error('[SFTP DnD] Failed to register:', e);
      }
    };
    setup();

    return () => {
      cancelled = true;
      if (unlisten) { unlisten(); unlisten = undefined; }
    };
  }, [sessionId, handleRefresh]);

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-4)] text-xs p-4">
        <div className="text-center">
          <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>Select an SSH session to browse files</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="flex-1 flex flex-col min-h-0 bg-[var(--void)] relative"
    >
      {/* Drag-over overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-[var(--accent)]/10 border-2 border-dashed border-[var(--accent)] rounded flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Upload className="w-8 h-8 mx-auto mb-1 text-[var(--accent)]" />
            <span className="text-[12px] text-[var(--accent)] font-semibold">Drop to upload</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="h-7 flex items-center gap-1 px-2 border-b border-[var(--border)] bg-[var(--deep)]">
        <button onClick={handleGoUp} disabled={cwd === '/'}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] disabled:opacity-30 disabled:cursor-default" title="Go up">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] text-[var(--text-3)] truncate flex-1 select-all">{cwd}</span>
        <button onClick={handleRefresh} disabled={isLoading}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]" title="Refresh">
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={handleSyncCwd} disabled={syncingCwd}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--accent)] hover:bg-[var(--veil)]" title="Sync to terminal CWD">
          <FolderSync className={`w-3 h-3 ${syncingCwd ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-red-900/20 border-b border-red-900/30 text-[11px] text-red-400">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300 flex-shrink-0">x</button>
        </div>
      )}

      {/* File tree */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin py-1"
        onContextMenu={handleEmptyContextMenu}
      >
        {isLoading && listings.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-4)]">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading...
          </div>
        ) : listings.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-[var(--text-4)]">Empty directory</div>
        ) : (
          listings.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              sessionId={sessionId}
              depth={0}
              selectedPath={selectedPath}
              onSelect={handleSelect}
              onNavigate={handleNavigate}
              onOpenFile={handleOpenFile}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              loading={loadingPaths}
              onContextMenu={handleContextMenu}
              isRenaming={renamingPath === entry.path}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
            />
          ))
        )}
      </div>

      {/* Upload progress / drop zone hint */}
      <div className="flex-shrink-0 border-t border-[var(--border)]">
        {uploading ? (
          <div className="h-7 flex items-center gap-2 px-3 text-[11px]">
            <Loader2 className="w-3 h-3 animate-spin text-[var(--accent)]" />
            <span className="text-[var(--text-2)] truncate">
              Uploading {uploadProgress.name || 'files'} ({uploadProgress.current}/{uploadProgress.total})
            </span>
            <div className="flex-1 h-1 bg-[var(--veil)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="h-5 flex items-center justify-center text-[9px] text-[var(--text-4)]">
            <Upload className="w-2.5 h-2.5 mr-1" />
            Drop files to upload
          </div>
        )}
      </div>

      {/* File/folder context menu */}
      {ctxMenu && (
        <ContextMenu
          items={ctxMenuItems}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Empty-space context menu */}
      {emptyCtxMenu && (
        <ContextMenu
          items={emptyCtxMenuItems}
          x={emptyCtxMenu.x}
          y={emptyCtxMenu.y}
          onClose={() => setEmptyCtxMenu(null)}
        />
      )}

      {/* Properties modal */}
      {properties && (
        <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setProperties(null)}>
          <div className="bg-[var(--deep)] border border-[var(--border)] rounded-lg shadow-2xl w-72 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[12px] font-semibold text-[var(--text-1)] mb-3">File Properties</h3>
            <div className="space-y-1.5 text-[11px]">
              <PropRow label="Path" value={properties.path} />
              <PropRow label="Type" value={properties.isDir ? 'Directory' : properties.isSymlink ? 'Symlink' : 'File'} />
              <PropRow label="Size" value={properties.isDir ? '-' : formatSize(properties.size)} />
              <PropRow label="Modified" value={properties.modified} />
              <PropRow label="Permissions" value={properties.permissions} />
            </div>
            <button onClick={() => setProperties(null)}
              className="mt-3 w-full py-1 text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] rounded transition-colors">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-[var(--text-4)] w-16 flex-shrink-0">{label}</span>
      <span className="text-[var(--text-2)] truncate select-all">{value || '-'}</span>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
