/**
 * UI control command parser.
 *
 * Detects natural-language intents that should control the app itself
 * rather than being sent to the terminal or AI service.
 *
 * Supported patterns:
 *   "打开 <name> 会话" / "open <name> session"     → OPEN_SESSION
 *   "新建终端" / "new terminal"                      → NEW_TERMINAL
 *   "连接到 <host>" / "connect to <host>"            → SSH_CONNECT
 */

// ─── Intent types ───────────────────────────────────────────────

export type ControlIntent =
  | { type: 'OPEN_SESSION'; sessionName: string }
  | { type: 'NEW_TERMINAL' }
  | { type: 'SSH_CONNECT'; host: string };

// ─── Pending confirmation (for OPEN_SESSION not-found flow) ─────

export interface PendingConfirmation {
  /** What to do if confirmed */
  action: () => Promise<void>;
  /** Session name the user was looking for */
  sessionName: string;
  /** Human-readable prompt shown in output / control message area */
  message: string;
}

let _pending: PendingConfirmation | null = null;

export function getPendingConfirmation(): PendingConfirmation | null {
  return _pending;
}

export function clearPendingConfirmation(): void {
  _pending = null;
}

/** Check if user input is a response to a pending confirmation (是/否/yes/no). */
export function parseConfirmationResponse(input: string): boolean | null {
  const t = input.trim().toLowerCase();
  if (/^(是|yes|y|ok|确认|好|可以)$/i.test(t)) return true;
  if (/^(否|no|n|取消|cancel|不)$/i.test(t)) return false;
  return null;
}

// ─── Pattern matching ───────────────────────────────────────────

interface Pattern {
  regex: RegExp;
  extract: (m: RegExpMatchArray) => ControlIntent;
}

const PATTERNS: Pattern[] = [
  // "打开 Default 会话" / "open Default session" / "打开 Default"
  {
    regex: /(?:打开|open|switch\s+to)\s*(.+?)(?:\s*(?:会话|session|窗口|window))?\s*$/i,
    extract: (m) => ({ type: 'OPEN_SESSION', sessionName: m[1].replace(/['"]/g, '').trim() }),
  },
  // "新建终端" / "new terminal" / "创建终端"
  {
    regex: /^(?:新建终端|new\s+terminal|创建终端|create\s+terminal|add\s+terminal|新建会话|new\s+session)$/i,
    extract: () => ({ type: 'NEW_TERMINAL' }),
  },
  // "连接到 192.168.1.1" / "connect to 192.168.1.1" / "SSH 192.168.1.1" / "连接 192.168.1.1"
  {
    regex: /(?:连接到|connect\s+to|ssh\s+to|ssh\s+|连接\s+)(\S+)/i,
    extract: (m) => ({ type: 'SSH_CONNECT', host: m[1].trim() }),
  },
];

/**
 * Try to parse a user input string as a UI control command.
 * Returns `null` if no control intent is detected.
 */
export function parseControlCommand(input: string): ControlIntent | null {
  const trimmed = input.trim();
  for (const pat of PATTERNS) {
    const m = trimmed.match(pat.regex);
    if (m) {
      return pat.extract(m);
    }
  }
  return null;
}

// ─── Action dispatcher ──────────────────────────────────────────

/**
 * Execute a parsed control intent.  Returns `true` if the command
 * was handled, `false` if it should fall through to the normal flow.
 */
export async function executeControlIntent(
  intent: ControlIntent,
): Promise<{ handled: boolean; message?: string }> {
  switch (intent.type) {
    case 'OPEN_SESSION': {
      const { useSessionStore } = await import('@/stores/sessionStore');
      const { loadSessions } = await import('@/lib/persistenceService');
      const sessions = useSessionStore.getState().sessions;
      const name = intent.sessionName;
      const nameLower = name.toLowerCase();

      // 1. Check in-memory sessions
      let target: string | null = null;
      for (const [id, s] of sessions) {
        const title = (s.title || id).toLowerCase();
        if (title === nameLower) { target = id; break; }
      }
      if (!target) {
        for (const [id, s] of sessions) {
          const title = (s.title || id).toLowerCase();
          if (title.includes(nameLower)) { target = id; break; }
        }
      }

      if (target) {
        useSessionStore.getState().setActiveSession(target);
        return { handled: true };
      }

      // 2. Check persisted sessions (session.json)
      try {
        const data = await loadSessions();
        const list: Array<{ id: string; name: string; terminals: Array<{ id: string; name: string; type: string; config?: any }> }> =
          (data as any)?.sessions ?? [];

        // Try exact match, then substring
        let entry = list.find((s) => s.name.toLowerCase() === nameLower);
        if (!entry) {
          entry = list.find((s) => s.name.toLowerCase().includes(nameLower));
        }

        if (entry) {
          // Restore persisted session into the store
          const store = useSessionStore.getState();
          const newId = store.addSession(entry.name);
          store.setActiveSession(newId);

          // Reconnect persisted terminals
          let restored = 0;
          for (const term of entry.terminals) {
            if (term.config) {
              try {
                await store.addTerminal(newId, term.config, term.name || term.id);
                restored++;
              } catch (e) {
                console.error(`Failed to restore terminal ${term.name}:`, e);
              }
            }
          }

          return {
            handled: true,
            message: restored > 0
              ? `已恢复会话 "${entry.name}"，共 ${restored} 个终端`
              : `已恢复会话 "${entry.name}"（无终端配置）`,
          };
        }
      } catch (e) {
        console.error('Failed to load persisted sessions:', e);
      }

      // 3. Not found anywhere — set pending confirmation
      _pending = {
        sessionName: name,
        message: `未发现已存储的会话 "${name}"，是否创建新会话？(是/否)`,
        action: async () => {
          const store = useSessionStore.getState();
          const newId = store.addSession(name);
          store.setActiveSession(newId);
        },
      };

      return {
        handled: true,
        message: _pending.message,
      };
    }

    case 'NEW_TERMINAL': {
      const { useUiStore } = await import('@/stores/uiStore');
      useUiStore.getState().openCreateSessionModal();
      return { handled: true };
    }

    case 'SSH_CONNECT': {
      const { useUiStore } = await import('@/stores/uiStore');
      const { useSessionStore } = await import('@/stores/sessionStore');

      let activeId = useSessionStore.getState().activeSessionId;
      if (!activeId) {
        activeId = useSessionStore.getState().addSession(`SSH to ${intent.host}`);
        useSessionStore.getState().setActiveSession(activeId);
      }

      useUiStore.getState().openTerminalModal(activeId);
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}
