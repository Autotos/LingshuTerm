/**
 * Permission Manager — command guardrail engine.
 *
 * Pipeline phase 3: runs after LLM returns command list, before execution.
 *
 * Three-tier rule engine:
 *   1. alwaysDeny  (highest priority, immediate rejection)
 *   2. alwaysAllow (silent passthrough)
 *   3. alwaysAsk   (requires user confirmation via ConfirmDialog)
 *
 * Matching is done by regex on the full command string.
 * First match wins within each tier, checked in deny → allow → ask order.
 */

import type { GuardRule, GuardResult, GuardAuditEntry } from './types';

// ─── Audit log (in-memory) ───────────────────────────────────────

const auditLog: GuardAuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 500;

function recordAudit(entry: GuardAuditEntry): void {
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }
}

/** Get a copy of recent audit entries. */
export function getAuditLog(): GuardAuditEntry[] {
  return [...auditLog];
}

/** Clear audit log. */
export function clearAuditLog(): void {
  auditLog.length = 0;
}

// ─── Rule matching ───────────────────────────────────────────────

/**
 * Try to match a command against a list of rules.
 * Returns the first matching rule, or null.
 */
function matchRule(command: string, rules: GuardRule[]): GuardRule | null {
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(command)) {
        return rule;
      }
    } catch {
      // Invalid regex — skip this rule
      continue;
    }
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Check a command against the full guard rule set.
 *
 * Resolution order:
 *   1. Check deny rules  → if match, return 'deny'
 *   2. Check allow rules → if match, return 'allow'
 *   3. Check ask rules   → if match, return 'ask'
 *   4. Default: 'ask' (unknown commands require confirmation)
 *
 * @param command   The full shell command to check
 * @param rules     The complete rule set (deny + allow + ask, in priority order)
 * @returns         GuardResult with action and matched rule
 */
export function checkCommand(command: string, rules: GuardRule[]): GuardResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      action: 'deny',
      matchedRule: null,
      auditEntry: {
        command: trimmed,
        action: 'deny',
        matchedLabel: 'empty-command',
        timestamp: Date.now(),
        reason: '空命令',
      },
    };
  }

  // Separate rules by action
  const denyRules = rules.filter((r) => r.action === 'deny');
  const allowRules = rules.filter((r) => r.action === 'allow');
  const askRules = rules.filter((r) => r.action === 'ask');

  // Check deny first
  const denyMatch = matchRule(trimmed, denyRules);
  if (denyMatch) {
    const entry: GuardAuditEntry = {
      command: trimmed,
      action: 'deny',
      matchedLabel: denyMatch.label,
      timestamp: Date.now(),
      reason: denyMatch.reason,
    };
    recordAudit(entry);
    return { action: 'deny', matchedRule: denyMatch, auditEntry: entry };
  }

  // Check allow
  const allowMatch = matchRule(trimmed, allowRules);
  if (allowMatch) {
    const entry: GuardAuditEntry = {
      command: trimmed,
      action: 'allow',
      matchedLabel: allowMatch.label,
      timestamp: Date.now(),
    };
    recordAudit(entry);
    return { action: 'allow', matchedRule: allowMatch, auditEntry: entry };
  }

  // Check ask
  const askMatch = matchRule(trimmed, askRules);
  if (askMatch) {
    const entry: GuardAuditEntry = {
      command: trimmed,
      action: 'ask',
      matchedLabel: askMatch.label,
      timestamp: Date.now(),
      reason: askMatch.reason,
    };
    recordAudit(entry);
    return { action: 'ask', matchedRule: askMatch, auditEntry: entry };
  }

  // Default: unknown command → ask
  const entry: GuardAuditEntry = {
    command: trimmed,
    action: 'ask',
    matchedLabel: 'unknown',
    timestamp: Date.now(),
    reason: '未识别的命令，需要确认',
  };
  recordAudit(entry);
  return { action: 'ask', matchedRule: null, auditEntry: entry };
}

/**
 * Batch-check multiple commands. Returns results in the same order.
 */
export function checkCommands(
  commands: string[],
  rules: GuardRule[],
): GuardResult[] {
  return commands.map((cmd) => checkCommand(cmd, rules));
}

/**
 * Determine if a GuardResult blocks execution of a step.
 */
export function isBlocked(result: GuardResult): boolean {
  return result.action === 'deny';
}

/**
 * Determine if a GuardResult requires user confirmation.
 */
export function needsConfirmation(result: GuardResult): boolean {
  return result.action === 'ask';
}
