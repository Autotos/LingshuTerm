import { useState, useEffect, useCallback } from 'react';
import { X, Terminal, Wifi, Loader2, Play, RefreshCw } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import * as sessionService from '@/lib/sessionService';
import * as connService from '@/lib/connectionService';
import type {
  ConnectionConfig,
  Protocol,
  PortInfo,
  LocalShellOption,
} from '@/models/connection';
import {
  defaultSshConfig,
  defaultTelnetConfig,
  defaultSerialConfig,
  connectionShortLabel,
} from '@/models/connection';

type Category = 'remote' | 'local';
type RemoteProtocol = Extract<Protocol, 'ssh' | 'telnet' | 'serial'>;

/**
 * "New Terminal" connection config modal.
 *
 * Opened from the Tab bar's + button or the sidebar session's + button.
 * Contains Remote (SSH/Telnet/Serial) and Local connection configuration.
 * When submitted, adds a terminal to the targeted session.
 */
export function TerminalConnectModal() {
  const terminalModalOpen = useUiStore((s) => s.terminalModalOpen);
  const terminalModalSessionId = useUiStore((s) => s.terminalModalSessionId);
  const closeTerminalModal = useUiStore((s) => s.closeTerminalModal);
  const addTerminal = useSessionStore((s) => s.addTerminal);

  const [category, setCategory] = useState<Category>('remote');
  const [protocol, setProtocol] = useState<RemoteProtocol>('ssh');

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
    setSshHost(''); setSshPort('22'); setSshUser('root'); setSshPass('');
    setTelnetHost(''); setTelnetPort('23');
    setSerialPort(''); setBaudRate(115200); setDataBits(8); setStopBits(1); setParity('none');
    setLocalCwd('');
    setError('');
  }, []);

  const close = useCallback(() => {
    closeTerminalModal();
    resetForm();
  }, [closeTerminalModal, resetForm]);

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

  useEffect(() => {
    if (!terminalModalOpen) return;
    if (category === 'remote' && protocol === 'serial') {
      refreshSerialPorts();
    }
  }, [terminalModalOpen, category, protocol, refreshSerialPorts]);

  useEffect(() => {
    if (!terminalModalOpen) return;
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
  }, [terminalModalOpen, category, localShells.length]);

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

  const handleConnect = useCallback(async () => {
    if (!terminalModalSessionId) return;
    setBusy(true);
    setError('');
    try {
      const config = buildConfig();
      if (!config) throw new Error('Please choose a shell first');

      if (config.protocol === 'ssh' || config.protocol === 'telnet') {
        const portStr = config.protocol === 'ssh' ? sshPort : telnetPort;
        if (!portStr.trim()) throw new Error('Port number is required');
        if (!/^\d+$/.test(portStr)) throw new Error('Port must be a number');
        const portNum = parseInt(portStr, 10);
        if (portNum < 1 || portNum > 65535) throw new Error('Port must be between 1 and 65535');
      }

      const label = connectionShortLabel(config);
      await addTerminal(terminalModalSessionId, config, label);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [terminalModalSessionId, buildConfig, sshPort, telnetPort, addTerminal, close]);

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

  if (!terminalModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <div className="relative w-[520px] max-h-[85vh] bg-[var(--deep)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col animate-block-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <span className="text-[13px] font-medium text-[var(--text-1)] flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            New Terminal
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
          <button
            onClick={handleConnect}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-[11px] bg-[var(--accent)] text-[var(--void)] font-medium hover:brightness-110 transition-all disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Connect
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
