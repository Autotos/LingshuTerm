import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Terminal, Wifi, Loader2, Save, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionStore } from '@/stores/sessionStore';
import * as sessionService from '@/lib/sessionService';
import * as connService from '@/lib/connectionService';
import type {
  ConnectionConfig,
  Protocol,
  PortInfo,
  LocalShellOption,
  SavedConnection,
} from '@/models/connection';
import {
  defaultSshConfig,
  defaultTelnetConfig,
  defaultSerialConfig,
  connectionLabel,
} from '@/models/connection';

type Category = 'remote' | 'local';
type RemoteProtocol = Extract<Protocol, 'ssh' | 'telnet' | 'serial'>;

/**
 * Unified "New Session" modal.
 *
 * Replaces the old ConnectionForm and the Sidebar Connections tab. Users
 * pick a category (Remote / Local); Remote has sub-tabs for SSH/Telnet/Serial
 * plus a Saved-connections quick-launch list. Local shows a shell dropdown
 * populated from `list_local_shells` (OS-aware).
 *
 * All four types dispatch through the single `createSession(config)` Tauri
 * command.
 */
export function SessionTypeModal() {
  const sessionModalOpen = useUiStore((s) => s.sessionModalOpen);
  const closeCreateSessionModal = useUiStore((s) => s.closeCreateSessionModal);
  const { savedConnections, addConnection, removeConnection, touchConnection } =
    useConnectionStore();
  const addSession = useSessionStore((s) => s.addSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const [category, setCategory] = useState<Category>('remote');
  const [protocol, setProtocol] = useState<RemoteProtocol>('ssh');
  const [name, setName] = useState('');

  // SSH fields
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUser, setSshUser] = useState('root');
  const [sshPass, setSshPass] = useState('');

  // Telnet fields
  const [telnetHost, setTelnetHost] = useState('');
  const [telnetPort, setTelnetPort] = useState('23');

  // Serial fields
  const [serialPort, setSerialPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [dataBits, setDataBits] = useState(8);
  const [stopBits, setStopBits] = useState(1);
  const [parity, setParity] = useState('none');
  const [serialPorts, setSerialPorts] = useState<PortInfo[]>([]);
  const [portsLoading, setPortsLoading] = useState(false);

  // Local fields
  const [localShells, setLocalShells] = useState<LocalShellOption[]>([]);
  const [localShellPath, setLocalShellPath] = useState('');
  const [localCwd, setLocalCwd] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const resetForm = useCallback(() => {
    setCategory('remote');
    setProtocol('ssh');
    setName('');
    setSshHost(''); setSshPort('22'); setSshUser('root'); setSshPass('');
    setTelnetHost(''); setTelnetPort('23');
    setSerialPort(''); setBaudRate(115200); setDataBits(8); setStopBits(1); setParity('none');
    setLocalCwd('');
    setError('');
  }, []);

  const close = useCallback(() => {
    closeCreateSessionModal();
    resetForm();
  }, [closeCreateSessionModal, resetForm]);

  const refreshSerialPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      const ports = await connService.listSerialPorts();
      setSerialPorts(ports);
      setSerialPort((prev) => (prev || (ports[0]?.name ?? '')));
    } catch (err) {
      console.error('Failed to list serial ports:', err);
    } finally {
      setPortsLoading(false);
    }
  }, []);

  // Load serial ports when serial tab opens
  useEffect(() => {
    if (!sessionModalOpen) return;
    if (category === 'remote' && protocol === 'serial') {
      refreshSerialPorts();
    }
  }, [sessionModalOpen, category, protocol, refreshSerialPorts]);

  // Load local shells once the modal opens (and cache)
  useEffect(() => {
    if (!sessionModalOpen) return;
    if (category !== 'local') return;
    if (localShells.length > 0) return;
    (async () => {
      try {
        const shells = await sessionService.listLocalShells();
        setLocalShells(shells);
        if (shells[0]) setLocalShellPath(shells[0].path);
      } catch (err) {
        console.error('Failed to list local shells:', err);
      }
    })();
  }, [sessionModalOpen, category, localShells.length]);

  const buildConfig = useCallback((): ConnectionConfig | null => {
    if (category === 'local') {
      if (!localShellPath) return null;
      return { protocol: 'local', shell: localShellPath, cwd: localCwd || undefined };
    }
    switch (protocol) {
      case 'ssh':
        return { protocol: 'ssh', host: sshHost, port: parseInt(sshPort, 10) || 22, username: sshUser, password: sshPass };
      case 'telnet':
        return { protocol: 'telnet', host: telnetHost, port: parseInt(telnetPort, 10) || 23 };
      case 'serial':
        return { protocol: 'serial', portName: serialPort, baudRate, dataBits, stopBits, parity };
    }
  }, [category, protocol, sshHost, sshPort, sshUser, sshPass, telnetHost, telnetPort,
      serialPort, baudRate, dataBits, stopBits, parity, localShellPath, localCwd]);

  const launchSession = useCallback(async (config: ConnectionConfig, displayName: string) => {
    const sessionId = await sessionService.createSession(config);
    const connectionType = config.protocol;
    const shellLabel = config.protocol === 'local' ? (config.shell || 'local') : config.protocol;
    const cwd = config.protocol === 'local' ? (config.cwd ?? '') : '';
    addSession({
      id: sessionId,
      status: 'connected',
      shell: shellLabel,
      cwd,
      title: displayName,
      createdAt: new Date().toISOString(),
      connectionType,
      connectionName: displayName,
    });
    setActiveSession(sessionId);
  }, [addSession, setActiveSession]);

  const handleCreate = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const config = buildConfig();
      if (!config) throw new Error('Please choose a shell first');

      // 连接时校验端口
      if (config.protocol === 'ssh' || config.protocol === 'telnet') {
        const portStr = config.protocol === 'ssh' ? sshPort : telnetPort;
        if (!portStr.trim()) {
          throw new Error('Port number is required');
        }
        if (!/^\d+$/.test(portStr)) {
          throw new Error('Port must be a number');
        }
        const portNum = parseInt(portStr, 10);
        if (portNum < 1 || portNum > 65535) {
          throw new Error('Port must be between 1 and 65535');
        }
      }

      const displayName = name || connectionLabel(config);
      await launchSession(config, displayName);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [buildConfig, name, sshPort, telnetPort, launchSession, close]);

  const handleSave = useCallback(() => {
    const config = buildConfig();
    if (!config || config.protocol === 'local') return;
    const displayName = name || connectionLabel(config);
    addConnection(displayName, config);
  }, [buildConfig, name, addConnection]);

  const handleQuickConnect = useCallback(async (saved: SavedConnection) => {
    setBusy(true);
    setError('');
    touchConnection(saved.id);
    try {
      await launchSession(saved.config, saved.name);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [launchSession, close, touchConnection]);

  const handleFillFromSaved = useCallback((saved: SavedConnection) => {
    const cfg = saved.config;
    touchConnection(saved.id);
    setCategory('remote');
    setName(saved.name);
    setError('');
    switch (cfg.protocol) {
      case 'ssh':
        setProtocol('ssh');
        setSshHost(cfg.host); setSshPort(String(cfg.port));
        setSshUser(cfg.username); setSshPass(cfg.password);
        break;
      case 'telnet':
        setProtocol('telnet');
        setTelnetHost(cfg.host); setTelnetPort(String(cfg.port));
        break;
      case 'serial':
        setProtocol('serial');
        setSerialPort(cfg.portName); setBaudRate(cfg.baudRate);
        setDataBits(cfg.dataBits); setStopBits(cfg.stopBits); setParity(cfg.parity);
        break;
      case 'local':
        // legacy saved entries shouldn't have local, but be defensive
        break;
    }
  }, []);

  const handleProtocolChange = useCallback((p: RemoteProtocol) => {
    setProtocol(p);
    setError('');
    if (p === 'ssh') {
      const d = defaultSshConfig();
      setSshHost(d.host); setSshPort('22'); setSshUser(d.username); setSshPass(d.password);
    } else if (p === 'telnet') {
      const d = defaultTelnetConfig();
      setTelnetHost(d.host); setTelnetPort('23');
    } else {
      const d = defaultSerialConfig();
      setSerialPort(d.portName); setBaudRate(d.baudRate); setDataBits(d.dataBits);
      setStopBits(d.stopBits); setParity(d.parity);
    }
  }, []);

  /** 最近 3 个远程已保存连接（按 lastUsedAt 降序，未使用过的按 createdAt 降序） */
  const remoteSavedList = useMemo(
    () =>
      savedConnections
        .filter((c) => c.config.protocol !== 'local')
        .sort((a, b) =>
          (b.lastUsedAt || b.createdAt).localeCompare(a.lastUsedAt || a.createdAt),
        )
        .slice(0, 3),
    [savedConnections],
  );

  if (!sessionModalOpen) return null;

  const canSave = category === 'remote';
  const actionLabel = category === 'local' ? 'Create' : 'Connect';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <div className="relative w-[520px] max-h-[85vh] bg-[var(--deep)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col animate-block-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <span className="text-[13px] font-medium text-[var(--text-1)] flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            New Session
          </span>
          <button
            onClick={close}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category switch */}
        <div className="flex gap-1 px-5 pt-3">
          <CategoryTab
            icon={<Wifi className="w-3.5 h-3.5" />}
            label="Remote"
            active={category === 'remote'}
            onClick={() => { setCategory('remote'); setError(''); }}
          />
          <CategoryTab
            icon={<Terminal className="w-3.5 h-3.5" />}
            label="Local"
            active={category === 'local'}
            onClick={() => { setCategory('local'); setError(''); }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {category === 'remote' ? (
            <>
              {/* Saved quick-connect */}
              {remoteSavedList.length > 0 && (
                <div className="rounded border border-[var(--border)] bg-[var(--veil)]/30">
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                    Saved
                  </div>
                  <div className="max-h-[120px] overflow-y-auto py-1">
                    {remoteSavedList.map((conn) => (
                      <div
                        key={conn.id}
                        className="group flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--veil)] hover:text-[var(--text-1)]"
                      >
                        <Wifi className="w-3 h-3 flex-shrink-0 text-[var(--text-4)]" />
                        <button
                          className="flex-1 min-w-0 text-left"
                          title={`Click to fill, double-click to connect: ${connectionLabel(conn.config)}`}
                          onClick={() => handleFillFromSaved(conn)}
                          onDoubleClick={() => handleQuickConnect(conn)}
                        >
                          <div className="truncate">{conn.name}</div>
                          <div className="truncate text-[10px] text-[var(--text-4)]">
                            {conn.config.protocol.toUpperCase()} &middot; {connectionLabel(conn.config)}
                          </div>
                        </button>
                        <button
                          onClick={() => handleQuickConnect(conn)}
                          className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10px] text-[var(--accent)] hover:bg-[var(--veil)]"
                          title="Connect"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => removeConnection(conn.id)}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--text-4)] hover:text-[var(--red)]"
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Protocol sub-tabs */}
              <div className="flex gap-1">
                {(['ssh', 'telnet', 'serial'] as RemoteProtocol[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => handleProtocolChange(p)}
                    className={`px-3 py-1.5 rounded text-[11px] uppercase tracking-wide transition-all ${
                      protocol === p
                        ? 'bg-[var(--veil)] border border-[var(--border)] text-[var(--text-1)]'
                        : 'border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <Field label="Session Name">
                <input
                  type="text"
                  className="settings-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="optional display name"
                />
              </Field>

              {protocol === 'ssh' && (
                <>
                  <Field label="Host">
                    <input type="text" className="settings-input" value={sshHost}
                      onChange={(e) => setSshHost(e.target.value)} placeholder="192.168.1.1 or hostname" />
                  </Field>
                  <div className="flex gap-3">
                    <Field label="Port" className="w-24">
                      <input type="text" inputMode="numeric" className="settings-input" value={sshPort}
                        onChange={(e) => setSshPort(e.target.value)} />
                    </Field>
                    <Field label="Username" className="flex-1">
                      <input type="text" className="settings-input" value={sshUser}
                        onChange={(e) => setSshUser(e.target.value)} placeholder="root" />
                    </Field>
                  </div>
                  <Field label="Password">
                    <input type="password" className="settings-input" value={sshPass}
                      onChange={(e) => setSshPass(e.target.value)} placeholder="password" />
                  </Field>
                </>
              )}

              {protocol === 'telnet' && (
                <>
                  <Field label="Host">
                    <input type="text" className="settings-input" value={telnetHost}
                      onChange={(e) => setTelnetHost(e.target.value)} placeholder="192.168.1.1 or hostname" />
                  </Field>
                  <Field label="Port">
                    <input type="text" inputMode="numeric" className="settings-input" value={telnetPort}
                      onChange={(e) => setTelnetPort(e.target.value)} />
                  </Field>
                </>
              )}

              {protocol === 'serial' && (
                <>
                  <Field label="Serial Port">
                    <div className="flex gap-2">
                      <select className="settings-input flex-1" value={serialPort}
                        onChange={(e) => setSerialPort(e.target.value)}>
                        {serialPorts.length === 0 && <option value="">No ports detected</option>}
                        {serialPorts.map((p) => (
                          <option key={p.name} value={p.name}>{p.name} ({p.port_type})</option>
                        ))}
                      </select>
                      <button onClick={refreshSerialPorts} disabled={portsLoading}
                        className="w-8 h-8 flex items-center justify-center rounded border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all"
                        title="Refresh ports">
                        <RefreshCw className={`w-3.5 h-3.5 ${portsLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </Field>
                  <div className="flex gap-3">
                    <Field label="Baud Rate" className="flex-1">
                      <select className="settings-input" value={baudRate}
                        onChange={(e) => setBaudRate(parseInt(e.target.value))}>
                        {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Data Bits" className="w-24">
                      <select className="settings-input" value={dataBits}
                        onChange={(e) => setDataBits(parseInt(e.target.value))}>
                        {[5, 6, 7, 8].map((b) => (<option key={b} value={b}>{b}</option>))}
                      </select>
                    </Field>
                  </div>
                  <div className="flex gap-3">
                    <Field label="Stop Bits" className="flex-1">
                      <select className="settings-input" value={stopBits}
                        onChange={(e) => setStopBits(parseInt(e.target.value))}>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                      </select>
                    </Field>
                    <Field label="Parity" className="flex-1">
                      <select className="settings-input" value={parity}
                        onChange={(e) => setParity(e.target.value)}>
                        <option value="none">None</option>
                        <option value="odd">Odd</option>
                        <option value="even">Even</option>
                      </select>
                    </Field>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <Field label="Session Name">
                <input
                  type="text"
                  className="settings-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="optional display name"
                />
              </Field>
              <Field label="Local Shell">
                <select className="settings-input" value={localShellPath}
                  onChange={(e) => setLocalShellPath(e.target.value)}>
                  {localShells.length === 0 && <option value="">Detecting…</option>}
                  {localShells.map((s) => (
                    <option key={s.path} value={s.path}>{s.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Working Directory (optional)">
                <input type="text" className="settings-input" value={localCwd}
                  onChange={(e) => setLocalCwd(e.target.value)}
                  placeholder="leave blank to use current directory" />
              </Field>
            </>
          )}

          {error && (
            <div className="text-[11px] text-[var(--red)] bg-[var(--red)]/10 border border-[var(--red)]/20 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          {canSave && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] bg-[var(--veil)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-hi)] transition-all"
              title="Save to Saved Connections"
            >
              <Save className="w-3 h-3" />
              Save
            </button>
          )}
          <button
            onClick={handleCreate}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-[11px] bg-[var(--accent)] text-[var(--void)] font-medium hover:brightness-110 transition-all disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryTab({
  icon, label, active, onClick,
}: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] transition-all ${
        active
          ? 'bg-[var(--veil)] border border-[var(--border)] text-[var(--text-1)]'
          : 'border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">{label}</span>
      {children}
    </label>
  );
}
