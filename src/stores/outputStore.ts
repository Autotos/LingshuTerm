import { create } from 'zustand';

export type OutputStatus = 'idle' | 'running' | 'done' | 'error';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface OutputItem {
  kind: 'heading' | 'code' | 'result' | 'info' | 'separator';
  label?: string;
  content: string;
  /** Per-step status for thinking/execution items */
  stepStatus?: StepStatus;
}

interface OutputState {
  items: OutputItem[];
  status: OutputStatus;
  isExpanded: boolean;
  onCancel: (() => void) | null;

  heading: (text: string) => void;
  codeBlock: (label: string, command: string) => void;
  result: (text: string) => void;
  info: (text: string) => void;
  separator: () => void;
  clear: () => void;
  setStatus: (status: OutputStatus) => void;
  setOnCancel: (fn: (() => void) | null) => void;
  setItemStatus: (index: number, stepStatus: StepStatus) => void;
  setLastItemStatus: (stepStatus: StepStatus) => void;
  addItem: (item: OutputItem) => number;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
}

export const useOutputStore = create<OutputState>((set) => ({
  items: [],
  status: 'idle',
  isExpanded: false,
  onCancel: null,

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
  setOnCancel: (fn) => set({ onCancel: fn }),
  setItemStatus: (index, stepStatus) => set((s) => {
    if (index < 0 || index >= s.items.length) return s;
    const items = [...s.items];
    items[index] = { ...items[index], stepStatus };
    return { items };
  }),
  setLastItemStatus: (stepStatus) => set((s) => {
    const items = [...s.items];
    if (items.length > 0) {
      items[items.length - 1] = { ...items[items.length - 1], stepStatus };
    }
    return { items };
  }),
  addItem: (item) => {
    let idx = 0;
    set((s) => {
      const items = [...s.items, item].slice(-300);
      idx = items.length - 1;
      return { items, isExpanded: true };
    });
    return idx;
  },
  toggle: () => set((s) => ({ isExpanded: !s.isExpanded })),
  expand: () => set({ isExpanded: true }),
  collapse: () => set({ isExpanded: false }),
}));
