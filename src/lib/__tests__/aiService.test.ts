import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nlToTasks, testConnection, AI_PRESETS, defaultAiConfig, resolveProvider } from '@/lib/aiService';
import type { AiConfig, AiProviderConfig } from '@/lib/aiService';

function makeConfig(overrides: Partial<AiProviderConfig> = {}): AiConfig {
  const provider: AiProviderConfig = {
    id: 'test-provider',
    name: 'Test',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    maxTokens: 1024,
    temperature: 0.3,
    ...overrides,
  };
  return { currentProviderId: provider.id, providers: [provider] };
}

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('AI_PRESETS', () => {
  it('should contain known providers', () => {
    expect(AI_PRESETS).toHaveProperty('dashscope');
    expect(AI_PRESETS).toHaveProperty('openai');
    expect(AI_PRESETS).toHaveProperty('ollama');
  });

  it('should have valid baseUrl and model for each preset', () => {
    for (const [, preset] of Object.entries(AI_PRESETS)) {
      expect(preset.baseUrl).toBeTruthy();
      expect(preset.defaultModel).toBeTruthy();
      expect(preset.label).toBeTruthy();
    }
  });
});

describe('defaultAiConfig', () => {
  it('should have sensible defaults', () => {
    const p = resolveProvider(defaultAiConfig);
    expect(p.baseUrl).toContain('dashscope');
    expect(p.model).toBe('qwen-turbo');
    expect(p.maxTokens).toBeGreaterThan(0);
    expect(p.temperature).toBeGreaterThanOrEqual(0);
    expect(p.temperature).toBeLessThanOrEqual(2);
  });
});

describe('nlToTasks', () => {
  const config = makeConfig();

  it('should parse a valid JSON array response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '[{"description":"列出文件","command":"ls -la"}]',
              },
            },
          ],
        }),
    });

    const tasks = await nlToTasks(config, '列出文件');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe('列出文件');
    expect(tasks[0].command).toBe('ls -la');
  });

  it('should handle markdown-wrapped JSON responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '```json\n[{"description":"查看目录","command":"ls"}]\n```',
              },
            },
          ],
        }),
    });

    const tasks = await nlToTasks(config, '查看目录');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].command).toBe('ls');
  });

  it('should filter out steps with empty commands', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '[{"description":"no command","command":""},{"description":"valid","command":"echo ok"}]',
              },
            },
          ],
        }),
    });

    const tasks = await nlToTasks(config, 'test');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].command).toBe('echo ok');
  });

  it('should throw on non-JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'Sorry, I cannot help with that.' } }],
        }),
    });

    await expect(nlToTasks(config, 'test')).rejects.toThrow('not a valid JSON array');
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(nlToTasks(config, 'test')).rejects.toThrow('AI API error 401');
  });

  it('should throw on empty response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
    });

    await expect(nlToTasks(config, 'test')).rejects.toThrow('empty response');
  });

  it('should include Authorization header when apiKey is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '[]' } }],
        }),
    });

    await nlToTasks(config, 'test');
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['Authorization']).toBe('Bearer test-key');
  });

  it('should not include Authorization header when apiKey is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '[]' } }],
        }),
    });

    await nlToTasks(makeConfig({ apiKey: '' }), 'test');
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['Authorization']).toBeUndefined();
  });
});

describe('testConnection', () => {
  const config = makeConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'model' });

  it('should return response content on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
        }),
    });

    const result = await testConnection(config);
    expect(result).toBe('ok');
  });

  it('should call the correct URL with trailing slash stripped', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
        }),
    });

    await testConnection(makeConfig({ baseUrl: 'https://api.example.com/v1/' }));
    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
  });
});
