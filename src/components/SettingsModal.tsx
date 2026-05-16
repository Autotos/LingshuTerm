import { useState, useCallback } from 'react';
import { X, Zap, Terminal, Loader2, CheckCircle2, XCircle, ScrollText } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { AI_PRESETS, testConnection } from '@/lib/aiService';
import type { AiConfig } from '@/lib/aiService';

type SettingsTab = 'ai' | 'terminal' | 'logging';

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useUiStore();
  const { settings, updateAiSettings, updateSettings } = useSettingsStore();
  const [tab, setTab] = useState<SettingsTab>('ai');

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setSettingsOpen(false)}
      />
      {/* Modal */}
      <div className="relative w-[560px] max-h-[80vh] bg-[var(--deep)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col animate-block-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <span className="text-[13px] font-medium text-[var(--text-1)]">Settings</span>
          <button
            onClick={() => setSettingsOpen(false)}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          <TabBtn icon={<Zap className="w-3.5 h-3.5" />} label="AI" active={tab === 'ai'} onClick={() => setTab('ai')} />
          <TabBtn icon={<Terminal className="w-3.5 h-3.5" />} label="Terminal" active={tab === 'terminal'} onClick={() => setTab('terminal')} />
          <TabBtn icon={<ScrollText className="w-3.5 h-3.5" />} label="Logging" active={tab === 'logging'} onClick={() => setTab('logging')} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {tab === 'ai' ? (
            <AiSettings config={settings.ai} onUpdate={updateAiSettings} />
          ) : tab === 'terminal' ? (
            <TerminalSettings
              terminal={settings.terminal}
              shell={settings.shell}
              onUpdateTerminal={(patch) => updateSettings({ terminal: { ...settings.terminal, ...patch } })}
              onUpdateShell={(patch) => updateSettings({ shell: { ...settings.shell, ...patch } })}
            />
          ) : (
            <LoggingSettings
              logging={settings.logging}
              onUpdate={(patch) => updateSettings({ logging: { ...settings.logging, ...patch } })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] transition-all ${
        active
          ? 'bg-[var(--veil)] border border-[var(--border)] text-[var(--text-1)]'
          : 'border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--veil)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---- AI Settings Panel ----

function AiSettings({ config, onUpdate }: { config: AiConfig; onUpdate: (patch: Partial<AiConfig>) => void }) {
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState('');

  const handlePreset = useCallback(
    (key: string) => {
      const preset = AI_PRESETS[key];
      if (preset) {
        onUpdate({ baseUrl: preset.baseUrl, model: preset.defaultModel });
      }
    },
    [onUpdate],
  );

  const handleTest = useCallback(async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      await testConnection(config);
      setTestStatus('ok');
    } catch (err) {
      setTestStatus('fail');
      setTestError(err instanceof Error ? err.message : String(err));
    }
  }, [config]);

  return (
    <>
      {/* Preset selector */}
      <Field label="Provider Preset">
        <select
          className="settings-input"
          onChange={(e) => handlePreset(e.target.value)}
          defaultValue=""
        >
          <option value="" disabled>Select a preset...</option>
          {Object.entries(AI_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
      </Field>

      <Field label="API Base URL">
        <input
          type="text"
          className="settings-input"
          value={config.baseUrl}
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </Field>

      <Field label="API Key">
        <input
          type="password"
          className="settings-input"
          value={config.apiKey}
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
          placeholder="sk-... (local models can leave empty)"
        />
      </Field>

      <Field label="Model">
        <input
          type="text"
          className="settings-input"
          value={config.model}
          onChange={(e) => onUpdate({ model: e.target.value })}
          placeholder="gpt-4o-mini"
        />
      </Field>

      <div className="flex gap-3">
        <Field label="Temperature" className="flex-1">
          <input
            type="number"
            className="settings-input"
            value={config.temperature}
            onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) || 0 })}
            min={0}
            max={2}
            step={0.1}
          />
        </Field>
        <Field label="Max Tokens" className="flex-1">
          <input
            type="number"
            className="settings-input"
            value={config.maxTokens}
            onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value) || 1024 })}
            min={128}
            max={32768}
            step={256}
          />
        </Field>
      </div>

      {/* Test connection */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleTest}
          disabled={testStatus === 'testing'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] bg-[var(--veil)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-hi)] transition-all disabled:opacity-50"
        >
          {testStatus === 'testing' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : testStatus === 'ok' ? (
            <CheckCircle2 className="w-3 h-3 text-[var(--green)]" />
          ) : testStatus === 'fail' ? (
            <XCircle className="w-3 h-3 text-[var(--red)]" />
          ) : (
            <Zap className="w-3 h-3" />
          )}
          Test Connection
        </button>
        {testStatus === 'ok' && <span className="text-[10px] text-[var(--green)]">Connected</span>}
        {testStatus === 'fail' && <span className="text-[10px] text-[var(--red)] truncate max-w-[300px]">{testError}</span>}
      </div>
    </>
  );
}

// ---- Terminal Settings Panel ----

function TerminalSettings({
  terminal,
  shell,
  onUpdateTerminal,
  onUpdateShell,
}: {
  terminal: { fontSize: number; fontFamily: string; scrollback: number; autoFit: boolean; defaultColumns: number; defaultRows: number };
  shell: { path: string; args: string[] };
  onUpdateTerminal: (patch: Partial<{ fontSize: number; fontFamily: string; scrollback: number; autoFit: boolean; defaultColumns: number; defaultRows: number }>) => void;
  onUpdateShell: (patch: Partial<{ path: string; args: string[] }>) => void;
}) {
  return (
    <>
      <Field label="Shell Path">
        <input
          type="text"
          className="settings-input"
          value={shell.path}
          onChange={(e) => onUpdateShell({ path: e.target.value })}
          placeholder="auto-detect (leave empty)"
        />
      </Field>

      <Field label="Font Family">
        <input
          type="text"
          className="settings-input"
          value={terminal.fontFamily}
          onChange={(e) => onUpdateTerminal({ fontFamily: e.target.value })}
        />
      </Field>

      <div className="flex gap-3">
        <Field label="Font Size" className="flex-1">
          <input
            type="number"
            className="settings-input"
            value={terminal.fontSize}
            onChange={(e) => onUpdateTerminal({ fontSize: parseInt(e.target.value) || 13 })}
            min={8}
            max={32}
          />
        </Field>
        <Field label="Scrollback Lines" className="flex-1">
          <input
            type="number"
            className="settings-input"
            value={terminal.scrollback}
            onChange={(e) => onUpdateTerminal({ scrollback: parseInt(e.target.value) || 5000 })}
            min={1000}
            max={100000}
            step={1000}
          />
        </Field>
      </div>

      {/* ── Auto-fit & default dimensions ── */}
      <div className="border-t border-[var(--border)] pt-4 mt-2">
        <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-3">Window Sizing</h4>

        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={terminal.autoFit}
            onChange={(e) => onUpdateTerminal({ autoFit: e.target.checked })}
            className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--void)] accent-[var(--accent)]"
          />
          <span className="text-[12px] text-[var(--text-2)]">Auto-fit to window</span>
        </label>

        {!terminal.autoFit && (
          <div className="flex gap-3">
            <Field label="Columns" className="flex-1">
              <input
                type="number"
                className="settings-input"
                value={terminal.defaultColumns}
                onChange={(e) => onUpdateTerminal({ defaultColumns: Math.max(20, Math.min(500, parseInt(e.target.value) || 80)) })}
                min={20}
                max={500}
              />
            </Field>
            <Field label="Rows" className="flex-1">
              <input
                type="number"
                className="settings-input"
                value={terminal.defaultRows}
                onChange={(e) => onUpdateTerminal({ defaultRows: Math.max(5, Math.min(200, parseInt(e.target.value) || 24)) })}
                min={5}
                max={200}
              />
            </Field>
          </div>
        )}

        {!terminal.autoFit && (
          <p className="text-[10px] text-[var(--text-4)] mt-2">
            Fixed dimensions; terminal will not resize with the window.
          </p>
        )}
      </div>
    </>
  );
}

// ---- Logging Settings ----

function LoggingSettings({
  logging,
  onUpdate,
}: {
  logging: { enabled: boolean; logPath: string; maxSizeMb: number };
  onUpdate: (patch: Partial<{ enabled: boolean; logPath: string; maxSizeMb: number }>) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={logging.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
          className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--void)] accent-[var(--accent)]"
        />
        <span className="text-[12px] text-[var(--text-2)]">Enable Logging</span>
      </label>

      <Field label="Log Path">
        <input
          type="text"
          className="settings-input"
          value={logging.logPath}
          onChange={(e) => onUpdate({ logPath: e.target.value })}
          placeholder="default: {workspace}/logs"
        />
      </Field>

      <Field label="Max Size (MB)">
        <input
          type="number"
          className="settings-input"
          value={logging.maxSizeMb}
          onChange={(e) => onUpdate({ maxSizeMb: Math.max(1, parseInt(e.target.value, 10) || 10) })}
          min={1}
        />
      </Field>

      <p className="text-[10px] text-[var(--text-4)]">
        Log files are written to {'{logPath}/{sessionName}/{terminalName}.log'}. Files
        exceeding the max size are automatically rotated with a timestamp suffix.
      </p>
    </>
  );
}

// ---- Shared Field wrapper ----

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-1 block">{label}</span>
      {children}
    </label>
  );
}
