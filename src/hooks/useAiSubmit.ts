import { useState, useCallback, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUiStore } from '@/stores/uiStore';
import { useOutputStore } from '@/stores/outputStore';
import { nlToTasks, resolveProvider } from '@/lib/aiService';
import type { ChatMessage } from '@/lib/aiService';
import { assemblePrompt, appendShortTerm } from '@/lib/memoryService';

interface UseAiSubmitOptions {
  sessionId: string | null;
}

interface UseAiSubmitReturn {
  submitAiQuery: (query: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Resolve the user-facing session name from a terminal connection ID.
 * Falls back to the connection ID itself if lookup fails.
 */
function resolveSessionName(connectionId: string): string {
  const sessions = useSessionStore.getState().sessions;
  for (const [, s] of sessions) {
    const term = s.terminals.find((t) => t.connectionId === connectionId);
    if (term) {
      // Sanitize: replace spaces and special chars, keep alphanumeric + _-.
      return (s.title || s.id).replace(/[^A-Za-z0-9_\-一-鿿]/g, '_').slice(0, 64);
    }
  }
  return connectionId;
}

/**
 * Hook for submitting natural language queries to the AI service.
 * Memory files are stored under the session NAME (user-friendly).
 * Task groups are stored under the connection ID (for terminal binding).
 */
export function useAiSubmit({ sessionId }: UseAiSubmitOptions): UseAiSubmitReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submitAiQuery = useCallback(
    async (query: string) => {
      if (!sessionId || isLoading) return;

      setIsLoading(true);
      setError(null);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const config = useSettingsStore.getState().settings.ai;
        const provider = resolveProvider(config);
        if (!provider.baseUrl) {
          throw new Error('Please configure AI API in Settings first');
        }

        // ── Output panel: show running status ──
        const out = useOutputStore.getState();
        out.setStatus('running');
        out.append(`> ${query}`);

        // Resolve session name for memory storage
        const memoryId = resolveSessionName(sessionId);

        // ── Assemble memory context ──
        let preMessages: ChatMessage[] | undefined;
        try {
          const assembled = await assemblePrompt(memoryId, query);
          preMessages = assembled.messages;
        } catch {
          // Memory load failed — fall through without context
        }

        const steps = await nlToTasks(config, query, controller.signal, preMessages);

        if (steps.length === 0) {
          throw new Error('AI returned no executable commands');
        }

        // ── Output panel: show results ──
        for (const s of steps) {
          useOutputStore.getState().append(`  $ ${s.command}  — ${s.description}`);
        }
        useOutputStore.getState().setStatus('done');

        // ── Update short-term memory ──
        appendShortTerm(memoryId, [
          { role: 'user', content: query, ts: Date.now() },
          {
            role: 'assistant',
            content: steps.map((s) => `${s.description}: ${s.command}`).join('\n'),
            ts: Date.now(),
          },
        ]).catch(() => { /* non-critical */ });

        // Create task group (keyed by connection ID for terminal binding)
        useTaskStore.getState().createGroup(sessionId, query, steps);
        useUiStore.getState().setSidebarTab('tasks');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : String(err);
          useOutputStore.getState().setStatus('error');
          useOutputStore.getState().append(`[Error] ${msg}`);
          setError(msg);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, isLoading],
  );

  const clearError = useCallback(() => setError(null), []);

  return { submitAiQuery, isLoading, error, clearError };
}
