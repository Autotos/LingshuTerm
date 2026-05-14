import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Play, Square, Server, Loader2, FolderOpen, Pencil, Trash2, UserPlus, Eye, EyeOff } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ServerService, type ServiceInfo, type ServiceStatus, type ServiceConfig, type ServerLogEntry } from '@/lib/serverService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const WELCOME = `Welcome to LingshuTerm Network Services

Select a service from the left panel to view its status and logs.

Supported services:
  TFTP   — Trivial File Transfer  (port 69)
  FTP    — File Transfer Protocol (port 21)
  HTTP   — Static file server     (port 8080)
  SSH    — Secure Shell / SFTP    (port 22)
  Telnet — Remote login           (port 23)
  NFS    — Network File System    (port 2049)
  VNC    — Remote desktop         (port 5900)
  Cron   — Task scheduler
  Iperf  — Network benchmark      (port 5201)`;

export function ServerManagementModal({ isOpen, onClose }: Props) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [configs, setConfigs] = useState<Record<string, ServiceConfig>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<ServerLogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Load services + configs on open
  useEffect(() => {
    if (!isOpen) return;
    ServerService.list()
      .then((list) => {
        setServices(list);
        for (const s of list) {
          ServerService.status(s.id)
            .then((st) => setStatuses((prev) => ({ ...prev, [s.id]: st })))
            .catch(() => {});
          ServerService.getConfig(s.id)
            .then((cfg) => setConfigs((prev) => ({ ...prev, [s.id]: cfg })))
            .catch(() => {});
        }
      })
      .catch((err) => setError(String(err)));
  }, [isOpen]);

  // Subscribe to server-log events
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<ServerLogEntry>('server-log', (event) => {
        setLogs((prev) => [...prev.slice(-199), event.payload]);
      });
    })();
    return () => { unlisten?.(); };
  }, [isOpen]);

  // Auto-scroll log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const refreshStatus = useCallback((serviceId: string) => {
    ServerService.status(serviceId)
      .then((st) => setStatuses((prev) => ({ ...prev, [serviceId]: st })))
      .catch(() => {});
  }, []);

  const handleStart = useCallback(async (serviceId: string) => {
    setBusy((prev) => new Set(prev).add(serviceId));
    setError('');
    try {
      const st = await ServerService.start(serviceId);
      setStatuses((prev) => ({ ...prev, [serviceId]: st }));
    } catch (err) { setError(String(err)); }
    finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(serviceId); return next; });
      refreshStatus(serviceId);
    }
  }, [refreshStatus]);

  const handleStop = useCallback(async (serviceId: string) => {
    setBusy((prev) => new Set(prev).add(serviceId));
    setError('');
    try {
      const st = await ServerService.stop(serviceId);
      setStatuses((prev) => ({ ...prev, [serviceId]: st }));
    } catch (err) { setError(String(err)); }
    finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(serviceId); return next; });
      refreshStatus(serviceId);
    }
  }, [refreshStatus]);

  const handleConfigChange = useCallback((serviceId: string, patch: Partial<ServiceConfig>) => {
    setConfigs((prev) => {
      const updated = { ...(prev[serviceId] || {}), ...patch };
      ServerService.updateConfig(serviceId, updated).catch(() => {});
      return { ...prev, [serviceId]: updated };
    });
  }, []);

  const handlePickFolder = useCallback(async (serviceId: string) => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      handleConfigChange(serviceId, { rootDir: selected });
    }
  }, [handleConfigChange]);

  if (!isOpen) return null;

  const selectedStatus = selected ? statuses[selected] : null;
  const selectedConfig = selected ? configs[selected] : null;
  const selectedInfo = services.find((s) => s.id === selected);
  const serviceLogs = logs.filter((l) => l.service === selected);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-[760px] h-[520px] bg-[var(--deep)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col animate-block-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <span className="text-[13px] font-medium text-[var(--text-1)] flex items-center gap-2">
            <Server className="w-4 h-4" />
            Servers
          </span>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-row min-h-0">
          {/* Left: service list */}
          <div className="w-[280px] border-r border-[var(--border)] overflow-y-auto flex-shrink-0">
            {services.map((svc) => {
              const st = statuses[svc.id];
              const isBusy = busy.has(svc.id);
              return (
                <div
                  key={svc.id}
                  onClick={() => setSelected(svc.id)}
                  className={`group flex items-center gap-2 px-4 py-2.5 cursor-pointer border-b border-[var(--border)]/50 transition-colors ${
                    selected === svc.id ? 'bg-[var(--veil)] text-[var(--text-1)]' : 'text-[var(--text-2)] hover:bg-[var(--veil)] hover:text-[var(--text-1)]'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${st?.running ? 'bg-[var(--green)]' : 'bg-[var(--text-4)]'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] truncate">{svc.name}</div>
                    <div className="text-[10px] text-[var(--text-4)] truncate">{svc.description} · port {st?.port ?? svc.default_port}</div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-3)]" /> :
                     st?.running ?
                      <button onClick={(e) => { e.stopPropagation(); handleStop(svc.id); }} title="Stop" className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--veil)] text-[var(--text-3)] hover:text-[var(--red)]"><Square className="w-3 h-3" /></button> :
                      <button onClick={(e) => { e.stopPropagation(); handleStart(svc.id); }} title="Start" className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--veil)] text-[var(--text-3)] hover:text-[var(--green)]"><Play className="w-3 h-3" /></button>
                    }
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right panel */}
          <div className="flex-1 flex flex-col min-w-0 bg-[var(--void)]">
            {selected && selectedInfo ? (
              selected === 'tftp' ? (
                <TftpConfigPanel
                  config={selectedConfig ?? { port: 69, args: [] }}
                  status={selectedStatus}
                  logs={serviceLogs}
                  logEndRef={logEndRef}
                  onChangeConfig={(patch) => handleConfigChange(selected, patch)}
                  onPickFolder={() => handlePickFolder(selected)}
                />
              ) : selected === 'ftp' ? (
                <FtpConfigPanel
                  config={selectedConfig ?? { port: 21, args: [] }}
                  status={selectedStatus}
                  logs={serviceLogs}
                  logEndRef={logEndRef}
                  onChangeConfig={(patch) => handleConfigChange(selected, patch)}
                />
              ) : (
                <GenericServicePanel
                  info={selectedInfo}
                  status={selectedStatus}
                />
              )
            ) : (
              <div className="flex-1 flex items-center justify-center p-4">
                <pre className="text-[11px] text-[var(--text-3)] font-mono whitespace-pre-wrap">{WELCOME}</pre>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="px-5 py-2 border-t border-[var(--border)] text-[11px] text-[var(--red)] bg-[var(--red)]/5">{error}</div>
        )}
      </div>
    </div>
  );
}

// ─── TFTP Config Panel ────────────────────────────────────────────

function TftpConfigPanel({
  config, status, logs, logEndRef, onChangeConfig, onPickFolder,
}: {
  config: ServiceConfig;
  status: ServiceStatus | null;
  logs: ServerLogEntry[];
  logEndRef: React.RefObject<HTMLDivElement | null>;
  onChangeConfig: (patch: Partial<ServiceConfig>) => void;
  onPickFolder: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--border)] text-[11px] text-[var(--text-3)] uppercase tracking-wide">
        TFTP server settings
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Root directory */}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">Root directory</span>
          <div className="flex gap-1">
            <input
              type="text" className="settings-input flex-1" readOnly
              value={config.rootDir ?? ''}
              placeholder="Select a folder..."
            />
            <button onClick={onPickFolder} title="Browse"
              className="w-8 h-8 flex items-center justify-center rounded border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all">
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>
        </label>

        {/* Checkboxes */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
            checked={config.showDownloadMsg ?? false}
            onChange={(e) => onChangeConfig({ showDownloadMsg: e.target.checked })} />
          <span className="text-[11px] text-[var(--text-2)]">Show message after successful download</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
            checked={config.showUploadMsg ?? false}
            onChange={(e) => onChangeConfig({ showUploadMsg: e.target.checked })} />
          <span className="text-[11px] text-[var(--text-2)]">Show message after successful upload</span>
        </label>

        {/* Listening port */}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">Listening port</span>
          <div className="flex items-center gap-0">
            <button onClick={() => onChangeConfig({ port: Math.max(1, (config.port ?? 69) - 1) })}
              className="w-7 h-8 flex items-center justify-center rounded-l border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]">−</button>
            <input type="number" className="settings-input w-20 text-center rounded-none border-l-0 border-r-0"
              value={config.port ?? 69}
              onChange={(e) => onChangeConfig({ port: Math.max(1, parseInt(e.target.value, 10) || 69) })} />
            <button onClick={() => onChangeConfig({ port: Math.min(65535, (config.port ?? 69) + 1) })}
              className="w-7 h-8 flex items-center justify-center rounded-r border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]">+</button>
          </div>
        </label>

        {/* Auto-stop */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
              checked={config.autoStopEnabled ?? false}
              onChange={(e) => onChangeConfig({ autoStopEnabled: e.target.checked })} />
            <span className="text-[11px] text-[var(--text-2)]">Stop server after</span>
          </label>
          <input type="number" className="settings-input w-20"
            value={config.autoStopSecs ?? 0} min={0}
            disabled={!config.autoStopEnabled}
            onChange={(e) => onChangeConfig({ autoStopSecs: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
          <span className="text-[11px] text-[var(--text-3)]">seconds</span>
        </div>

        {/* Server output */}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">Server output</span>
          <div className="h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--deep)] p-2 text-[11px] font-mono text-[var(--text-2)]">
            {logs.length === 0 && (
              <span className="text-[var(--text-4)]">
                {status?.running ? 'Waiting for output...' : 'Server is stopped. Click Start to begin.'}
              </span>
            )}
            {logs.map((l, i) => (
              <div key={i} className={l.message.includes('stopped') ? 'text-[var(--yellow)]' : ''}>
                [{l.timestamp}] {l.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </label>
      </div>
    </div>
  );
}

// ─── FTP Config Panel ──────────────────────────────────────────────

function FtpConfigPanel({
  config, status, logs, logEndRef, onChangeConfig,
}: {
  config: ServiceConfig;
  status: ServiceStatus | null;
  logs: ServerLogEntry[];
  logEndRef: React.RefObject<HTMLDivElement | null>;
  onChangeConfig: (patch: Partial<ServiceConfig>) => void;
}) {
  const users = config.ftpUsers ?? [];
  const [editingUser, setEditingUser] = useState<{ index: number; login: string; password: string; rootDir: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPw, setShowPw] = useState<Record<number, boolean>>({});

  const handleSaveUser = () => {
    if (!editingUser) return;
    const updated = [...users];
    const entry = { login: editingUser.login, password: editingUser.password, rootDir: editingUser.rootDir || undefined };
    if (editingUser.index < 0) updated.push(entry);
    else updated[editingUser.index] = entry;
    onChangeConfig({ ftpUsers: updated });
    setEditingUser(null);
    setShowAddForm(false);
  };

  const handleDeleteUser = (idx: number) => {
    onChangeConfig({ ftpUsers: users.filter((_, i) => i !== idx) });
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--border)] text-[11px] text-[var(--text-3)] uppercase tracking-wide">
        FTP server settings
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* User management */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Users</span>
            <button
              onClick={() => { setEditingUser({ index: -1, login: '', password: '', rootDir: '' }); setShowAddForm(true); }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]"
            >
              <UserPlus className="w-3 h-3" /> Add User
            </button>
          </div>

          {users.length === 0 && !showAddForm ? (
            <div className="text-[11px] text-[var(--text-4)] py-2">No users configured.</div>
          ) : (
            <div className="rounded border border-[var(--border)] overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-[var(--deep)]">
                  <tr className="text-[var(--text-3)]">
                    <th className="px-2 py-1.5 text-left font-normal">Login</th>
                    <th className="px-2 py-1.5 text-left font-normal">Password</th>
                    <th className="px-2 py-1.5 text-left font-normal">Root Directory</th>
                    <th className="px-2 py-1.5 text-right font-normal w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={i} className="border-t border-[var(--border)]/50 text-[var(--text-2)]">
                      <td className="px-2 py-1.5">{u.login}</td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex items-center gap-1">
                          {showPw[i] ? u.password : '******'}
                          <button onClick={() => setShowPw((p) => ({ ...p, [i]: !p[i] }))} className="text-[var(--text-4)] hover:text-[var(--text-1)]">
                            {showPw[i] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-[var(--text-4)] truncate max-w-[120px]">{u.rootDir || '—'}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={() => { setEditingUser({ index: i, login: u.login, password: u.password, rootDir: u.rootDir ?? '' }); setShowAddForm(true); }}
                          className="w-5 h-5 inline-flex items-center justify-center rounded text-[var(--text-4)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]" title="Edit">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => handleDeleteUser(i)}
                          className="w-5 h-5 inline-flex items-center justify-center rounded text-[var(--text-4)] hover:text-[var(--red)] hover:bg-[var(--veil)]" title="Delete">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add/Edit user form */}
          {showAddForm && editingUser && (
            <div className="mt-2 p-3 rounded border border-[var(--border)] bg-[var(--deep)] space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">
                {editingUser.index < 0 ? 'Add User' : 'Edit User'}
              </div>
              <div className="flex gap-2">
                <input type="text" className="settings-input flex-1" placeholder="Login"
                  value={editingUser.login}
                  onChange={(e) => setEditingUser({ ...editingUser, login: e.target.value })} />
                <input type="password" className="settings-input flex-1" placeholder="Password"
                  value={editingUser.password}
                  onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} />
              </div>
              <div className="flex gap-1">
                <input type="text" className="settings-input flex-1" placeholder="Root directory"
                  value={editingUser.rootDir}
                  onChange={(e) => setEditingUser({ ...editingUser, rootDir: e.target.value })} />
                <button onClick={async () => {
                  try {
                    const selected = await open({ directory: true, multiple: false });
                    if (selected && typeof selected === 'string') setEditingUser((prev) => prev ? { ...prev, rootDir: selected } : prev);
                  } catch (err) { console.warn('Folder dialog failed:', err); }
                }} title="Browse"
                  className="w-8 h-8 flex items-center justify-center rounded border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]">
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setEditingUser(null); setShowAddForm(false); }}
                  className="px-3 py-1 rounded text-[10px] bg-[var(--veil)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)]">Cancel</button>
                <button onClick={handleSaveUser}
                  className="px-3 py-1 rounded text-[10px] bg-[var(--accent)] text-[var(--void)] font-medium hover:brightness-110">Save</button>
              </div>
            </div>
          )}
        </div>

        {/* Global settings */}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">Port</span>
          <div className="flex items-center gap-0">
            <button onClick={() => onChangeConfig({ port: Math.max(1, (config.port ?? 21) - 1) })}
              className="w-7 h-8 flex items-center justify-center rounded-l border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]">−</button>
            <input type="number" className="settings-input w-20 text-center rounded-none border-l-0 border-r-0"
              value={config.port ?? 21}
              onChange={(e) => onChangeConfig({ port: Math.max(1, parseInt(e.target.value, 10) || 21) })} />
            <button onClick={() => onChangeConfig({ port: Math.min(65535, (config.port ?? 21) + 1) })}
              className="w-7 h-8 flex items-center justify-center rounded-r border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]">+</button>
          </div>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
            checked={config.allowAnonymous ?? false}
            onChange={(e) => onChangeConfig({ allowAnonymous: e.target.checked })} />
          <span className="text-[11px] text-[var(--text-2)]">Allow anonymous connections</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
            checked={config.useUtf8 ?? false}
            onChange={(e) => onChangeConfig({ useUtf8: e.target.checked })} />
          <span className="text-[11px] text-[var(--text-2)]">Use UTF-8 charset</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
            checked={config.promptBeforeConnect ?? false}
            onChange={(e) => onChangeConfig({ promptBeforeConnect: e.target.checked })} />
          <span className="text-[11px] text-[var(--text-2)]">Prompt me before accepting any incoming connection</span>
        </label>

        {/* Auto-stop */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
              checked={config.autoStopEnabled ?? false}
              onChange={(e) => onChangeConfig({ autoStopEnabled: e.target.checked })} />
            <span className="text-[11px] text-[var(--text-2)]">Stop server after</span>
          </label>
          <input type="number" className="settings-input w-20"
            value={config.autoStopSecs ?? 0} min={0}
            disabled={!config.autoStopEnabled}
            onChange={(e) => onChangeConfig({ autoStopSecs: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
          <span className="text-[11px] text-[var(--text-3)]">seconds</span>
        </div>

        {/* Server output */}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">Server output</span>
          <div className="h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--deep)] p-2 text-[11px] font-mono text-[var(--text-2)]">
            {logs.length === 0 && (
              <span className="text-[var(--text-4)]">
                {status?.running ? 'Waiting for output...' : 'Server is stopped. Click Start to begin.'}
              </span>
            )}
            {logs.map((l, i) => (
              <div key={i} className={l.message.includes('stopped') ? 'text-[var(--yellow)]' : ''}>
                [{l.timestamp}] {l.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </label>
      </div>
    </div>
  );
}

// ─── Generic Service Panel ─────────────────────────────────────────

function GenericServicePanel({ info, status }: { info: ServiceInfo; status: ServiceStatus | null }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--border)] text-[11px] text-[var(--text-3)] uppercase tracking-wide">
        {info.name}
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-[12px] text-[var(--text-2)] font-mono space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-3)]">Status:</span>
          <span className={status?.running ? 'text-[var(--green)]' : 'text-[var(--text-4)]'}>
            {status?.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-3)]">Port:</span>
          <span>{status?.port ?? info.default_port}</span>
        </div>
        {status?.pid && <div className="flex items-center gap-2"><span className="text-[var(--text-3)]">PID:</span><span>{status.pid}</span></div>}
        {status?.uptime_secs != null && <div className="flex items-center gap-2"><span className="text-[var(--text-3)]">Uptime:</span><span>{status.uptime_secs}s</span></div>}
        <p className="text-[11px] text-[var(--text-4)] mt-2">{info.description}. Configuration panel coming soon.</p>
      </div>
    </div>
  );
}
