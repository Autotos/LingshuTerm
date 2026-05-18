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

// ─── Pattern matching ───────────────────────────────────────────

interface Pattern {
  regex: RegExp;
  extract: (m: RegExpMatchArray) => ControlIntent;
}

const PATTERNS: Pattern[] = [
  // "打开 Default 会话" / "open Default session" / "打开 Default"
  {
    regex: /(?:打开|open|switch\s+to)\s+(.+?)(?:\s*(?:会话|session|窗口|window))?\s*$/i,
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
      // Dynamically import to avoid circular deps
      const { useSessionStore } = await import('@/stores/sessionStore');
      const sessions = useSessionStore.getState().sessions;

      // Try exact match first, then case-insensitive, then substring
      let target: string | null = null;
      const name = intent.sessionName.toLowerCase();

      for (const [id, s] of sessions) {
        const title = (s.title || id).toLowerCase();
        if (title === name) { target = id; break; }
      }
      if (!target) {
        for (const [id, s] of sessions) {
          const title = (s.title || id).toLowerCase();
          if (title.includes(name)) { target = id; break; }
        }
      }

      if (target) {
        useSessionStore.getState().setActiveSession(target);
        return { handled: true };
      }
      return {
        handled: true,
        message: `No session matching "${intent.sessionName}" found`,
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

      // Ensure there's an active session; create one if needed
      let activeId = useSessionStore.getState().activeSessionId;
      if (!activeId) {
        activeId = useSessionStore.getState().addSession(`SSH to ${intent.host}`);
        useSessionStore.getState().setActiveSession(activeId);
      }

      // Open the terminal modal pre-filled with this host
      useUiStore.getState().openTerminalModal(activeId);
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}
