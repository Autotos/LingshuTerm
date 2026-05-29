import { create } from 'zustand';

export type OutputStatus = 'idle' | 'running' | 'done' | 'error';

export interface OutputItem {
  /** 'heading' = section title, 'code' = command block, 'result' = command output, 'info' = status */
  kind: 'heading' | 'code' | 'result' | 'info' | 'separator';
  /** Optional label (command description, status text) */
  label?: string;
  /** Main content */
  content: string;
}

interface OutputState {
  items: OutputItem[];
  status: OutputStatus;
  isExpanded: boolean;

  /** Add a section heading */
  heading: (text: string) => void;
  /** Add a code block (command) */
  codeBlock: (label: string, command: string) => void;
  /** Add a result (command output) */
  result: (text: string) => void;
  /** Add an info line */
  info: (text: string) => void;
  /** Add a visual separator */
  separator: () => void;
  /** Clear all */
  clear: () => void;
  setStatus: (status: OutputStatus) => void;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
}

export const useOutputStore = create<OutputState>((set) => ({
  items: [],
  status: 'idle',
  isExpanded: false,

  heading: (text) =>
    set((s) => ({
      items: [...s.items, { kind: 'heading' as const, content: text }].slice(-300),
      isExpanded: true,
    })),

  codeBlock: (label, command) =>
    set((s) => ({
      items: [...s.items, { kind: 'code' as const, label, content: command }].slice(-300),
      isExpanded: true,
    })),

  result: (text) =>
    set((s) => ({
      items: [...s.items, { kind: 'result' as const, content: text }].slice(-300),
      isExpanded: true,
    })),

  info: (text) =>
    set((s) => ({
      items: [...s.items, { kind: 'info' as const, content: text }].slice(-300),
      isExpanded: true,
    })),

  separator: () =>
    set((s) => ({
      items: [...s.items, { kind: 'separator' as const, content: '' }].slice(-300),
      isExpanded: true,
    })),

  clear: () => set({ items: [], status: 'idle' }),
  setStatus: (status) => set({ status }),
  toggle: () => set((s) => ({ isExpanded: !s.isExpanded })),
  expand: () => set({ isExpanded: true }),
  collapse: () => set({ isExpanded: false }),
}));
