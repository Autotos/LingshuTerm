/**
 * Harness middleware system — shared type definitions.
 *
 * Agent = Model + Harness
 *
 * These types power the 4-layer middleware pipeline:
 *   Context Injector → Permission Manager → Progress Writer → Verification Runner
 */

import type { AiTaskStep, ChatMessage } from '@/lib/aiService';

// ─── Permission guard types ──────────────────────────────────────

export type GuardAction = 'deny' | 'allow' | 'ask';

export interface GuardRule {
  /** Human-readable label for the rule (shown in settings UI) */
  label: string;
  /** Regex pattern to match against command string */
  pattern: string;
  /** Action when pattern matches */
  action: GuardAction;
  /** Reason shown in confirm dialog for 'ask' rules */
  reason?: string;
}

export interface GuardAuditEntry {
  command: string;
  action: GuardAction;
  matchedLabel: string;
  timestamp: number;
  reason?: string;
}

export interface GuardResult {
  action: GuardAction;
  matchedRule: GuardRule | null;
  auditEntry: GuardAuditEntry;
}

// ─── Context injection types ─────────────────────────────────────

export interface HarnessContext {
  /** AGENTS.md content used as system prompt prefix */
  agentsMd: string;
  /** PROGRESS.md snapshot (null = no in-progress task) */
  progressMd: string | null;
  /** Verification commands extracted from AGENTS.md */
  verifyCommands: string[];
}

// ─── Progress persistence types ──────────────────────────────────

export type ProgressStatus = '进行中' | '已完成' | '已暂停';

export interface ProgressSnapshot {
  status: ProgressStatus;
  taskDescription: string;
  completedSteps: StepRecord[];
  currentStep: string;
  pendingSteps: string[];
  verifyCommands: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StepRecord {
  command: string;
  description: string;
  exitCode: number;
}

// ─── Verification types ──────────────────────────────────────────

export type VerifyStatus = 'pass' | 'fail';

export interface VerifyResult {
  status: VerifyStatus;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  attempt: number;
}

// ─── Pipeline types ──────────────────────────────────────────────

export type PipelineFinalStatus = 'success' | 'partial' | 'denied' | 'failed';

export interface HarnessConfig {
  /** Permission guard rules (ordered: deny first, then allow, then ask) */
  guardRules: GuardRule[];
  /** Path to AGENTS.md (default: project root) */
  agentsPath: string;
  /** Path to PROGRESS.md (default: project root) */
  progressPath: string;
  /** Max verification retry attempts */
  maxVerifyRetries: number;
  /** Threshold: treat as long task if steps > this */
  longTaskStepThreshold: number;
  /** Threshold: treat as long task if total command length > this */
  longTaskLengthThreshold: number;
}

export interface PipelineResult {
  steps: AiTaskStep[];
  guardResults: GuardResult[];
  verifyResults: VerifyResult[];
  progressUpdated: boolean;
  finalStatus: PipelineFinalStatus;
  /** Human-readable summary message */
  summary: string;
}

// ─── Context Injector types ──────────────────────────────────────

export interface InjectResult {
  /** Assembled system prompt */
  systemPrompt: string;
  /** Full chat messages ready for LLM API */
  messages: ChatMessage[];
  /** Extracted verification commands from AGENTS.md */
  verifyCommands: string[];
  /** Whether a PROGRESS.md resume context was injected */
  resumeMode: boolean;
}

// ─── Progress Writer types ───────────────────────────────────────

export interface ProgressWriteInput {
  taskDescription: string;
  completedSteps: StepRecord[];
  currentStep: string;
  pendingSteps: string[];
  verifyCommands: string[];
  notes?: string;
}
