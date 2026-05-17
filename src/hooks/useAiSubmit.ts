import { useState, useCallback, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUiStore } from '@/stores/uiStore';
import { nlToTasks, resolveProvider } from '@/lib/aiService';

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
 * Hook for submitting natural language queries to the AI service.
 * Creates a TaskGroup from the AI response and switches sidebar to Tasks tab.
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

      // Abort any previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const config = useSettingsStore.getState().settings.ai;

        const provider = resolveProvider(config);
        if (!provider.baseUrl) {
          throw new Error('Please configure AI API in Settings first');
        }

        const steps = await nlToTasks(config, query, controller.signal);

        if (steps.length === 0) {
          throw new Error('AI returned no executable commands');
        }

        // Create task group in store
        useTaskStore.getState().createGroup(sessionId, query, steps);

        // Switch sidebar to Tasks tab
        useUiStore.getState().setSidebarTab('tasks');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
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
