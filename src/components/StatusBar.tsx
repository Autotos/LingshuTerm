import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '@/stores/sessionStore';
import { connectionLabel } from '@/models/connection';

interface StatusBarProps {
  sessionId: string | null;
}

interface CpuStats {
  total: number;
  user: number;
  system: number;
  idle: number;
}

interface MemStats {
  total: string;
  used: string;
  free: string;
  buffers: string;
  cached: string;
}

interface DiskPartInfo {
  mount: string;
  dev: string;
  total: string;
  used: string;
  avail: string;
  pct: string;
}

interface DiskRootInfo {
  dev: string;
  total: string;
  used: string;
  avail: string;
  pct: string;
}

interface NetStats {
  ifaces: string;
  rx: number;
  tx: number;
}

interface UserInfo {
  name: string;
  tty: string;
  time: string;
}

interface UsersStats {
  count: number;
  list: UserInfo[];
}

interface ServerStats {
  cpu: CpuStats;
  cpu_count: number;
  load_avg: string;
  uptime: number;
  mem: MemStats;
  disk_root: DiskRootInfo;
  disk_parts: DiskPartInfo[];
  net: NetStats;
  users: UsersStats;
}

const POLL_INTERVAL_MS = 5000;

export function StatusBar({ sessionId }: StatusBarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [clock, setClock] = useState(new Date().toTimeString().slice(0, 8));
  const [stats, setStats] = useState<ServerStats | null>(null);
  const lastRxRef = useRef(0);
  const lastTxRef = useRef(0);
  const [netRxRate, setNetRxRate] = useState('0');
  const [netTxRate, setNetTxRate] = useState('0');

  // ── Clock ──
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date().toTimeString().slice(0, 8));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Active terminal ──
  const activeSession = activeSessionId ? sessions.get(activeSessionId) : undefined;
  const activeTerminal = activeSession && activeSession.activeTerminalIndex >= 0
    ? activeSession.terminals[activeSession.activeTerminalIndex]
    : undefined;
  const activeConnInfo = activeTerminal?.config
    ? connectionLabel(activeTerminal.config)
    : null;
  const isSsh = activeTerminal?.connectionId?.startsWith('ssh-');

  // ── Poll server stats for SSH terminals ──
  useEffect(() => {
    if (!activeTerminal?.connectionId || !isSsh) {
      setStats(null);
      return;
    }

    const connId = activeTerminal.connectionId;
    let cancelled = false;

    const poll = async () => {
      try {
        const json: string = await invoke('query_server_stats', { sessionId: connId });
        if (cancelled) return;

        const parsed = JSON.parse(json);
        if (parsed.err) { setStats(null); return; }

        const stats: ServerStats = {
          cpu: {
            total: parseFloat(parsed.cpu?.total) || 0,
            user: parseFloat(parsed.cpu?.user) || 0,
            system: parseFloat(parsed.cpu?.system) || 0,
            idle: parseFloat(parsed.cpu?.idle) || 0,
          },
          cpu_count: parseInt(String(parsed.cpu_count), 10) || 0,
          load_avg: parsed.load_avg || '0,0,0',
          uptime: parseInt(String(parsed.uptime), 10) || 0,
          mem: {
            total: parsed.mem?.total || '0',
            used: parsed.mem?.used || '0',
            free: parsed.mem?.free || '0',
            buffers: parsed.mem?.buffers || '0',
            cached: parsed.mem?.cached || '0',
          },
          disk_root: {
            dev: parsed.disk_root?.dev || '',
            total: parsed.disk_root?.total || '0',
            used: parsed.disk_root?.used || '0',
            avail: parsed.disk_root?.avail || '0',
            pct: parsed.disk_root?.pct || '0',
          },
          disk_parts: Array.isArray(parsed.disk_parts) ? parsed.disk_parts : [],
          net: {
            ifaces: parsed.net?.ifaces || '',
            rx: parseInt(String(parsed.net?.rx), 10) || 0,
            tx: parseInt(String(parsed.net?.tx), 10) || 0,
          },
          users: {
            count: parseInt(String(parsed.users?.count), 10) || 0,
            list: Array.isArray(parsed.users?.list) ? parsed.users.list : [],
          },
        };

        // Network rate (bytes/sec delta)
        const rx = stats.net.rx;
        const tx = stats.net.tx;
        if (lastRxRef.current > 0) {
          const rxDelta = rx - lastRxRef.current;
          const txDelta = tx - lastTxRef.current;
          setNetRxRate(formatBytesPerSec(rxDelta / (POLL_INTERVAL_MS / 1000)));
          setNetTxRate(formatBytesPerSec(txDelta / (POLL_INTERVAL_MS / 1000)));
        }
        lastRxRef.current = rx;
        lastTxRef.current = tx;

        setStats(stats);
      } catch (e) {
        console.error('[StatusBar] Failed to poll server stats:', e);
        if (!cancelled) setStats(null);
      }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeTerminal?.connectionId, isSsh]);

  // ── Render ──
  return (
    <div className="h-6 bg-[var(--deep)] border-t border-[var(--border)] px-4 flex items-center gap-3 text-[10px] text-[var(--text-4)] flex-shrink-0" style={{ overflow: 'visible' }}>
      {/* Active terminal full name */}
      {activeConnInfo && (
        <>
          <span className="text-[var(--text-2)] truncate max-w-[260px]" title={activeConnInfo}>
            {activeConnInfo}
          </span>
          <span className="w-px h-[10px] bg-[var(--border)]" />
        </>
      )}

      {/* Server stats (SSH only) */}
      {stats && (
        <>
          {/* CPU */}
          <StatItem
            label="CPU"
            value={`${stats.cpu.total}%`}
            tooltip={
              <div>
                <div>User: {stats.cpu.user}%</div>
                <div>System: {stats.cpu.system}%</div>
                <div>Idle: {stats.cpu.idle}%</div>
                {stats.cpu_count > 0 && <div>Cores: {stats.cpu_count}</div>}
                <div>Load: {stats.load_avg.replace(/,/g, ' / ')}</div>
                <div>Uptime: {formatUptime(stats.uptime)}</div>
              </div>
            }
          />
          <span className="w-px h-[10px] bg-[var(--border)]" />

          {/* MEM */}
          <StatItem
            label="MEM"
            value={`${stats.mem.used}/${stats.mem.total}M`}
            tooltip={
              <div>
                <div>Used: {stats.mem.used} MB</div>
                <div>Free: {stats.mem.free} MB</div>
                <div>Buffers: {stats.mem.buffers} MB</div>
                <div>Cache: {stats.mem.cached} MB</div>
                <div>Total: {stats.mem.total} MB</div>
              </div>
            }
          />
          <span className="w-px h-[10px] bg-[var(--border)]" />

          {/* DISK */}
          <StatItem
            label="DISK"
            value={`${stats.disk_root.used}/${stats.disk_root.total}`}
            tooltip={
              <div>
                {stats.disk_parts.length > 0 ? (
                  stats.disk_parts.map((d, i) => (
                    <div key={i}>
                      {d.mount}: {d.used}/{d.total} ({d.pct})
                      <br /><span className="opacity-60">{d.dev} | avail {d.avail}</span>
                    </div>
                  ))
                ) : (
                  <div>
                    <div>{stats.disk_root.dev}</div>
                    <div>Used: {stats.disk_root.used} / Total: {stats.disk_root.total}</div>
                    <div>Avail: {stats.disk_root.avail} ({stats.disk_root.pct})</div>
                  </div>
                )}
              </div>
            }
          />
          <span className="w-px h-[10px] bg-[var(--border)]" />

          {/* NET */}
          {stats.net.ifaces && (
            <>
              <StatItem
                label="NET"
                value={`↓${netRxRate}/s ↑${netTxRate}/s`}
                tooltip={
                  <div>
                    <div>Interfaces: {stats.net.ifaces}</div>
                    <div>Total RX: {formatBytes(stats.net.rx)}</div>
                    <div>Total TX: {formatBytes(stats.net.tx)}</div>
                    <div>Rate: ↓{netRxRate}/s ↑{netTxRate}/s</div>
                  </div>
                }
              />
              <span className="w-px h-[10px] bg-[var(--border)]" />
            </>
          )}

          {/* USERS */}
          <StatItem
            label="USERS"
            value={`${stats.users.count} user${stats.users.count !== 1 ? 's' : ''}`}
            tooltip={
              <div>
                {stats.users.list.length > 0 ? (
                  <>
                    {stats.users.list.map((u, i) => (
                      <div key={i}>
                        {u.name} <span className="opacity-60">{u.tty} {u.time}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div>No users logged in</div>
                )}
              </div>
            }
          />
          <span className="w-px h-[10px] bg-[var(--border)]" />
        </>
      )}

      {/* Terminal count */}
      {activeSession && activeSession.terminals.length > 0 && (
        <>
          <span className="text-[var(--text-3)]">
            {activeSession.terminals.length} terminal{activeSession.terminals.length !== 1 ? 's' : ''}
          </span>
          <span className="w-px h-[10px] bg-[var(--border)]" />
        </>
      )}

      <span className="tabular-nums">{clock}</span>
      <span className="ml-auto flex items-center gap-1">
        <span
          className={`w-[6px] h-[6px] rounded-full ${
            sessionId ? 'bg-[var(--green)]' : 'bg-[var(--text-4)]'
          }`}
        />
        {sessionId ? 'Ready' : 'Idle'}
      </span>
    </div>
  );
}

// ── Tooltip wrapper ──

function StatItem({ label, value, tooltip }: { label: string; value: string; tooltip: React.ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    setPos({ left: r.left + r.width / 2, top: r.top - 8 });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <span
      ref={triggerRef}
      className="stat-item"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <span className="stat-label">{label}</span>{' '}
      <span className="stat-value">{value}</span>
      {pos && (
        <span
          ref={tipRef}
          className="stat-tooltip"
          style={{ left: pos.left, top: pos.top, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

// ── Helpers ──

function formatBytesPerSec(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)}B`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)}K`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
