import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '@/stores/sessionStore';
import { connectionLabel } from '@/models/connection';

interface StatusBarProps {
  sessionId: string | null;
}

interface ServerStats {
  cpu: number;
  mem_u: string;
  mem_t: string;
  disk_u: string;
  disk_t: string;
  users: string;
  rx: number;
  tx: number;
}

const POLL_INTERVAL_MS = 5000;

export function StatusBar({ sessionId }: StatusBarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [clock, setClock] = useState(new Date().toTimeString().slice(0, 8));
  const [stats, setStats] = useState<ServerStats | null>(null);
  const lastRxRef = useRef(0);
  const lastTxRef = useRef(0);
  const [netRx, setNetRx] = useState('0');
  const [netTx, setNetTx] = useState('0');

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
        const parsed: any = JSON.parse(json);
        if (parsed.err) { setStats(null); return; }

        const cpu = parseFloat(parsed.cpu) || 0;
        const memU = parsed.mem_u || '0';
        const memT = parsed.mem_t || '0';
        const diskU = parsed.disk_u || '0';
        const diskT = parsed.disk_t || '0';
        const users = parsed.users || '0';
        const rx = parseInt(String(parsed.rx), 10) || 0;
        const tx = parseInt(String(parsed.tx), 10) || 0;

        // Network rate (bytes/sec delta)
        if (lastRxRef.current > 0) {
          const rxDelta = rx - lastRxRef.current;
          const txDelta = tx - lastTxRef.current;
          setNetRx(formatBytes(rxDelta / (POLL_INTERVAL_MS / 1000)));
          setNetTx(formatBytes(txDelta / (POLL_INTERVAL_MS / 1000)));
        }
        lastRxRef.current = rx;
        lastTxRef.current = tx;

        setStats({ cpu, mem_u: memU, mem_t: memT, disk_u: diskU, disk_t: diskT, users, rx, tx });
      } catch {
        if (!cancelled) setStats(null);
      }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeTerminal?.connectionId, isSsh]);

  // ── Render ──
  return (
    <div className="h-6 bg-[var(--deep)] border-t border-[var(--border)] px-4 flex items-center gap-3 text-[10px] text-[var(--text-4)] flex-shrink-0 overflow-hidden">
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
          <span className="text-[var(--text-3)]" title="CPU usage">CPU {stats.cpu}%</span>
          <span className="w-px h-[10px] bg-[var(--border)]" />
          <span className="text-[var(--text-3)]" title="Memory used / total">
            MEM {stats.mem_u}/{stats.mem_t}M
          </span>
          <span className="w-px h-[10px] bg-[var(--border)]" />
          <span className="text-[var(--text-3)]" title="Disk used / total">
            DISK {stats.disk_u}/{stats.disk_t}
          </span>
          <span className="w-px h-[10px] bg-[var(--border)]" />
          {netRx !== '0' && (
            <>
              <span className="text-[var(--text-3)]" title="Network download / upload rate">
                ↓{netRx}/s ↑{netTx}/s
              </span>
              <span className="w-px h-[10px] bg-[var(--border)]" />
            </>
          )}
          <span className="text-[var(--text-3)]" title="Online users">
            {stats.users} user{stats.users !== '1' ? 's' : ''}
          </span>
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

function formatBytes(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec}B`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)}K`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M`;
}
