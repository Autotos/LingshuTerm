import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AiConfig, AiProviderConfig } from '@/lib/aiService';
import { defaultAiConfig, AI_PRESETS } from '@/lib/aiService';
import type { HarnessConfig } from '@/lib/harness/types';
import { DEFAULT_HARNESS_CONFIG } from '@/lib/harness/defaults';

interface AppSettings {
  shell: { path: string; args: string[] };
  terminal: {
    fontSize: number;
    fontFamily: string;
    /** Output panel font (defaults to CJK-aware monospace stack) */
    outputFont: string;
    scrollback: number;
    autoFit: boolean;
    defaultColumns: number;
    defaultRows: number;
  };
  ai: AiConfig;
  harness: HarnessConfig;
  /** Active SOUL.md profile key (e.g. 'default', 'concise', 'friendly') */
  soulProfile: string;
  logging: {
    enabled: boolean;
    logPath: string;
    maxSizeMb: number;
  };
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateAiSettings: (patch: Partial<AiConfig>) => void;
  updateHarnessSettings: (patch: Partial<HarnessConfig>) => void;
  setSoulProfile: (profile: string) => void;
  updateProvider: (providerId: string, patch: Partial<AiProviderConfig>) => void;
  addProvider: (presetKey?: string) => void;
  removeProvider: (providerId: string) => void;
  loadFromDisk: () => Promise<void>;
  saveToDisk: () => void;
}

const defaultSettings: AppSettings = {
  shell: { path: '', args: [] },
  terminal: {
    fontSize: 13,
    fontFamily: 'Berkeley Mono, JetBrains Mono, SF Mono, Monaco, Menlo, Consolas, monospace',
    outputFont: '',
    scrollback: 10000,
    autoFit: true,
    defaultColumns: 80,
    defaultRows: 24,
  },
  ai: defaultAiConfig,
  harness: DEFAULT_HARNESS_CONFIG,
  soulProfile: 'default',
  logging: {
    enabled: true,
    logPath: '',
    maxSizeMb: 10,
  },
};

// ─── Debounced save ──────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_MS = 500;

function scheduleSave(settings: AppSettings) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    invoke('save_settings', { content: JSON.stringify(settings, null, 2) }).catch(
      (e) => console.error('[settings] save failed:', e),
    );
  }, SAVE_MS);
}

// ─── Provider ID generator ───────────────────────────────────────
let _pid = 0;
function newProviderId(): string {
  _pid++;
  return `provider-${Date.now()}-${_pid}`;
}

// ─── Migration: old single-provider { baseUrl, model, ... } → AiConfig ────
function migrateAiConfig(ai: any): AiConfig {
  if (ai && ai.providers && typeof ai.currentProviderId === 'string') {
    return ai as AiConfig;
  }
  if (ai && typeof ai.baseUrl === 'string') {
    const def = defaultAiConfig.providers[0];
    const p: AiProviderConfig = {
      id: newProviderId(),
      name: 'Default',
      baseUrl: ai.baseUrl || def.baseUrl,
      apiKey: ai.apiKey || '',
      model: ai.model || def.model,
      maxTokens: ai.maxTokens ?? def.maxTokens,
      temperature: ai.temperature ?? def.temperature,
    };
    return { currentProviderId: p.id, providers: [p] };
  }
  return defaultAiConfig;
}

export const useSettingsStore = create<SettingsState>()((set, get) => {
  // Try localStorage for instant startup, disk load comes later via loadFromDisk()
  let init = defaultSettings;
  try {
    const raw = localStorage.getItem('lingshu-settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.settings) {
        init = {
          ...defaultSettings,
          ...parsed.state.settings,
          terminal: { ...defaultSettings.terminal, ...(parsed.state.settings.terminal || {}) },
          ai: migrateAiConfig(parsed.state.settings.ai),
          logging: { ...defaultSettings.logging, ...(parsed.state.settings.logging || {}) },
        };
      }
    }
  } catch { /* ignore */ }

  return {
    settings: init,
    loaded: false,

    updateSettings: (patch) => {
      const next = { ...get().settings, ...patch };
      scheduleSave(next);
      set({ settings: next });
    },

    updateAiSettings: (patch) => {
      const next = { ...get().settings, ai: { ...get().settings.ai, ...patch } };
      scheduleSave(next);
      set({ settings: next });
    },

    updateHarnessSettings: (patch) => {
      const next = { ...get().settings, harness: { ...get().settings.harness, ...patch } };
      scheduleSave(next);
      set({ settings: next });
    },

    setSoulProfile: (profile) => {
      const next = { ...get().settings, soulProfile: profile };
      scheduleSave(next);
      set({ settings: next });
    },

    updateProvider: (providerId, patch) => {
      const next = {
        ...get().settings,
        ai: {
          ...get().settings.ai,
          providers: get().settings.ai.providers.map((p) =>
            p.id === providerId ? { ...p, ...patch } : p,
          ),
        },
      };
      scheduleSave(next);
      set({ settings: next });
    },

    addProvider: (presetKey) => {
      const id = newProviderId();
      let name = 'New Provider';
      let baseUrl = 'http://localhost:8080/v1';
      let model = 'default';
      if (presetKey) {
        const preset = AI_PRESETS[presetKey];
        if (preset) { name = preset.label; baseUrl = preset.baseUrl; model = preset.defaultModel; }
      }
      const provider: AiProviderConfig = { id, name, baseUrl, apiKey: '', model, maxTokens: 2048, temperature: 0.3 };
      const next = {
        ...get().settings,
        ai: {
          ...get().settings.ai,
          providers: [...get().settings.ai.providers, provider],
        },
      };
      scheduleSave(next);
      set({ settings: next });
    },

    removeProvider: (providerId) => {
      const providers = get().settings.ai.providers.filter((p) => p.id !== providerId);
      if (providers.length === 0) return;
      const currentProviderId =
        get().settings.ai.currentProviderId === providerId
          ? providers[0].id
          : get().settings.ai.currentProviderId;
      const next = {
        ...get().settings,
        ai: { ...get().settings.ai, currentProviderId, providers },
      };
      scheduleSave(next);
      set({ settings: next });
    },

    loadFromDisk: async () => {
      try {
        const raw: string | null = await invoke('load_settings');
        if (raw) {
          const disk = JSON.parse(raw);
          set({
            settings: {
              ...defaultSettings,
              ...disk,
              terminal: { ...defaultSettings.terminal, ...((disk as any).terminal || {}) },
              ai: migrateAiConfig((disk as any).ai),
              logging: { ...defaultSettings.logging, ...((disk as any).logging || {}) },
            },
            loaded: true,
          });
        } else {
          set({ loaded: true });
          // Save defaults on first run
          invoke('save_settings', { content: JSON.stringify(get().settings, null, 2) }).catch(() => {});
        }
      } catch (e) {
        console.error('[settings] loadFromDisk failed:', e);
        set({ loaded: true });
      }
    },

    saveToDisk: () => {
      invoke('save_settings', { content: JSON.stringify(get().settings, null, 2) }).catch(
        (e) => console.error('[settings] saveToDisk failed:', e),
      );
    },
  };
});
