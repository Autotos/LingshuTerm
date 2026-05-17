import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────

export interface SftpFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface SftpState {
  /** Current remote working directory per session. */
  cwd: Record<string, string>;
  /** Directory listings cache, keyed by path. */
  listings: Record<string, SftpFileEntry[]>;
  /** Currently selected path in the file tree. */
  selectedPath: Record<string, string>;
  /** Whether a directory is being loaded. */
  loading: Record<string, boolean>;
  /** Error messages, keyed by session or path. */
  errors: Record<string, string>;

  setCwd: (sessionId: string, path: string) => void;
  setListing: (pathKey: string, entries: SftpFileEntry[]) => void;
  setSelectedPath: (sessionId: string, path: string) => void;
  setLoading: (key: string, loading: boolean) => void;
  setError: (key: string, msg: string | null) => void;
  clearSession: (sessionId: string) => void;
}

export const useSftpStore = create<SftpState>((set) => ({
  cwd: {},
  listings: {},
  selectedPath: {},
  loading: {},
  errors: {},

  setCwd: (sessionId, path) =>
    set((s) => ({ cwd: { ...s.cwd, [sessionId]: path } })),

  setListing: (pathKey, entries) =>
    set((s) => ({ listings: { ...s.listings, [pathKey]: entries } })),

  setSelectedPath: (sessionId, path) =>
    set((s) => ({ selectedPath: { ...s.selectedPath, [sessionId]: path } })),

  setLoading: (key, loading) =>
    set((s) => ({
      loading: loading
        ? { ...s.loading, [key]: true }
        : { ...s.loading, [key]: false },
    })),

  setError: (key, msg) =>
    set((s) => {
      if (msg === null) {
        const next = { ...s.errors };
        delete next[key];
        return { errors: next };
      }
      return { errors: { ...s.errors, [key]: msg } };
    }),

  clearSession: (sessionId) =>
    set((s) => {
      const cwd = { ...s.cwd };
      delete cwd[sessionId];
      const selectedPath = { ...s.selectedPath };
      delete selectedPath[sessionId];
      const listings: Record<string, SftpFileEntry[]> = {};
      for (const [k, v] of Object.entries(s.listings)) {
        if (!k.startsWith(sessionId)) listings[k] = v;
      }
      return { cwd, selectedPath, listings };
    }),
}));
