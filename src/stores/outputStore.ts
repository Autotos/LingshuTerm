import { create } from 'zustand';

export type OutputStatus = 'idle' | 'running' | 'done' | 'error';

interface OutputState {
  /** Accumulated output lines */
  lines: string[];
  /** Current status indicator */
  status: OutputStatus;
  /** Whether the panel is expanded */
  isExpanded: boolean;

  /** Append one or more output lines */
  append: (...lines: string[]) => void;
  /** Clear all output */
  clear: () => void;
  /** Set running status */
  setStatus: (status: OutputStatus) => void;
  /** Toggle expand/collapse */
  toggle: () => void;
  /** Programmatically expand */
  expand: () => void;
  /** Programmatically collapse */
  collapse: () => void;
}

export const useOutputStore = create<OutputState>((set) => ({
  lines: [],
  status: 'idle',
  isExpanded: false,

  append: (...lines) =>
    set((s) => {
      // Limit to 500 lines to prevent memory issues
      const next = [...s.lines, ...lines].slice(-500);
      return { lines: next, isExpanded: true };
    }),

  clear: () => set({ lines: [], status: 'idle' }),

  setStatus: (status) => set({ status }),

  toggle: () => set((s) => ({ isExpanded: !s.isExpanded })),

  expand: () => set({ isExpanded: true }),

  collapse: () => set({ isExpanded: false }),
}));
