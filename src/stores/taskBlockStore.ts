import { create } from 'zustand';

export interface TaskBlock {
  id: string;
  command: string;
  status: 'running' | 'done' | 'error';
  /** Line numbers in terminal buffer (approximate viewport position) */
  startLine: number;
  endLine: number;
  /** Whether this block is currently collapsed */
  collapsed: boolean;
  /** Associated xterm decoration IDs for collapsed overlay */
  decorationIds: number[];
}

interface TaskBlockState {
  blocks: TaskBlock[];
  /** Currently active task block (output being written) */
  activeBlockId: string | null;

  /** Start a new task block when a command begins */
  startBlock: (command: string, startLine: number) => string;
  /** Mark the active block as complete */
  endBlock: (endLine: number, status?: 'done' | 'error') => void;
  /** Toggle collapse state of a block */
  toggleCollapse: (id: string) => void;
  /** Register a decoration ID for a block */
  addDecoration: (blockId: string, decoId: number) => void;
  /** Clear all decorations for a block */
  clearDecorations: (blockId: string) => void;
  /** Remove all blocks */
  clearAll: () => void;
}

let _blockSeq = 0;

export const useTaskBlockStore = create<TaskBlockState>((set, get) => ({
  blocks: [],
  activeBlockId: null,

  startBlock: (command, startLine) => {
    _blockSeq++;
    const id = `task-${_blockSeq}`;
    const block: TaskBlock = {
      id,
      command,
      status: 'running',
      startLine,
      endLine: startLine,
      collapsed: false,
      decorationIds: [],
    };
    set((s) => ({
      blocks: [...s.blocks, block],
      activeBlockId: id,
    }));
    return id;
  },

  endBlock: (endLine, status = 'done') => {
    const { activeBlockId } = get();
    if (!activeBlockId) return;
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === activeBlockId ? { ...b, endLine, status } : b,
      ),
      activeBlockId: null,
    }));
  },

  toggleCollapse: (id) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === id ? { ...b, collapsed: !b.collapsed } : b,
      ),
    })),

  addDecoration: (blockId, decoId) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === blockId
          ? { ...b, decorationIds: [...b.decorationIds, decoId] }
          : b,
      ),
    })),

  clearDecorations: (blockId) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === blockId ? { ...b, decorationIds: [] } : b,
      ),
    })),

  clearAll: () => set({ blocks: [], activeBlockId: null }),
}));
