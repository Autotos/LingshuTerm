import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiConfig } from '@/lib/aiService';
import { defaultAiConfig } from '@/lib/aiService';

interface AppSettings {
  shell: { path: string; args: string[] };
  terminal: {
    fontSize: number;
    fontFamily: string;
    scrollback: number;
  };
  ai: AiConfig;
  logging: {
    enabled: boolean;
    logPath: string;
    maxSizeMb: number;
  };
}

interface SettingsState {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateAiSettings: (patch: Partial<AiConfig>) => void;
}

const defaultSettings: AppSettings = {
  shell: { path: '', args: [] },
  terminal: {
    fontSize: 13,
    fontFamily: 'Berkeley Mono, JetBrains Mono, SF Mono, Monaco, Menlo, Consolas, monospace',
    scrollback: 10000,
  },
  ai: defaultAiConfig,
  logging: {
    enabled: true,
    logPath: '',
    maxSizeMb: 10,
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      updateSettings: (patch) =>
        set((state) => ({
          settings: { ...state.settings, ...patch },
        })),
      updateAiSettings: (patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            ai: { ...state.settings.ai, ...patch },
          },
        })),
    }),
    {
      name: 'lingshu-settings',
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => {
        const p = persisted as { settings?: Partial<AppSettings> } | undefined;
        return {
          ...current,
          settings: {
            ...current.settings,
            ...p?.settings,
            ai: { ...current.settings.ai, ...p?.settings?.ai },
            terminal: { ...current.settings.terminal, ...p?.settings?.terminal },
            shell: { ...current.settings.shell, ...p?.settings?.shell },
          },
        };
      },
    },
  ),
);
