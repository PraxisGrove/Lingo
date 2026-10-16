import { describe, expect, it } from 'vitest';
import type { ProviderProfile } from '../storage/settings-model';
import {
  createProviderDraft,
  detectProviderPreset,
  getProviderPreset,
  getProviderProtocols,
  PROVIDER_PRESETS,
  validateProviderDraft,
} from './provider-presets';

describe('provider setup presets', () => {
  it('enables the documented MiniMax model catalog and keeps its supported manual/default model', () => {
    expect(getProviderPreset('minimax')).toMatchObject({
      endpoint: 'https://api.minimax.io/v1',
      model: 'MiniMax-M2.7',
      supportsModelDiscovery: true,
    });
  });
  it('creates independent drafts without changing saved configuration or presets', () => {
    const draft = createProviderDraft('deepseek', 'new-profile');
    expect(draft).toEqual({
      id: 'new-profile',
      name: 'DeepSeek',
      provider: 'openai-compatible',
      endpoint: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    });
    draft.name = 'Personal';
    expect(createProviderDraft('deepseek', 'another-profile').name).toBe(
      'DeepSeek',
    );
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toHaveLength(26);
  });

  it.each([
    ['https://api.deepseek.com/v1/', 'deepseek'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen'],
    ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen'],
    [
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'qwen',
    ],
    ['https://api.moonshot.cn/v1', 'moonshot'],
    ['https://api.groq.com/openai/v1', 'groq'],
    ['https://api.siliconflow.cn/v1', 'siliconflow'],
    ['http://127.0.0.1:11434/v1', 'ollama'],
    ['http://[::1]:11434/v1', 'ollama'],
    ['https://gateway.example/v1', 'custom'],
    ['https://api.openai.com.other.example/v1', 'custom'],
    ['http://localhost:8080/v1', 'custom'],
    ['', 'custom'],
  ] as const)('recognizes saved endpoint %s as %s', (endpoint, expected) => {
    expect(
      detectProviderPreset({
        id: 'saved',
        name: 'My translation',
        provider: 'openai-compatible',
        endpoint,
      }).id,
    ).toBe(expected);
  });

  it('recognizes old profiles using default endpoints without discarding custom fields', () => {
    const profile: ProviderProfile = {
      id: 'saved',
      name: 'Personal model',
      provider: 'openai-compatible',
      model: 'my-model',
    };
    expect(detectProviderPreset(profile).id).toBe('openai');
    expect(profile.model).toBe('my-model');
    expect(detectProviderPreset({ ...profile, provider: 'anthropic' }).id).toBe(
      'anthropic',
    );
    expect(detectProviderPreset({ ...profile, provider: 'gemini' }).id).toBe(
      'gemini',
    );
    expect(detectProviderPreset({ ...profile, provider: 'deepl' }).id).toBe(
      'deepl',
    );
  });

  it.each([
    ['gemini', 'http://127.0.0.1:3425/v1beta', 'local-gateway'],
    ['gemini', 'https://gateway.example/v1beta', 'custom'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini'],
    [
      'gemini',
      'https://generativelanguage.googleapis.com.other.example/v1beta',
      'custom',
    ],
    ['anthropic', 'http://localhost:3425/v1', 'local-gateway'],
    ['anthropic', 'https://gateway.example/v1', 'custom'],
    ['anthropic', 'https://api.anthropic.com/v1', 'anthropic'],
    ['deepl', 'https://translation-gateway.example', 'deepl'],
  ] as const)('recognizes %s endpoint %s as %s without replacing its protocol', (provider, endpoint, expected) => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'My gateway',
      provider,
      endpoint,
      model: 'my-model',
    };
    expect(detectProviderPreset(saved).id).toBe(expected);
    expect(saved.provider).toBe(provider);
    expect(saved.endpoint).toBe(endpoint);
  });

  it('offers Responses only for verified presets and custom services while keeping new Chat defaults', () => {
    for (const id of ['openai', 'deepseek'] as const) {
      expect(getProviderProtocols(getProviderPreset(id))).toEqual([
        'openai-compatible',
        'openai-responses',
      ]);
      expect(createProviderDraft(id, 'new').provider).toBe('openai-compatible');
    }
    expect(getProviderProtocols(getProviderPreset('custom'))).toEqual([
      'openai-compatible',
      'openai-responses',
      'anthropic',
      'gemini',
    ]);
    for (const preset of PROVIDER_PRESETS.filter(
      (item) =>
        !['openai', 'deepseek', 'custom', 'local-gateway'].includes(item.id),
    )) {
      expect(getProviderProtocols(preset)).not.toContain('openai-responses');
    }
    expect(getProviderProtocols(getProviderPreset('local-gateway'))).toEqual(
      getProviderProtocols(getProviderPreset('custom')),
    );
    expect(PROVIDER_PRESETS).toHaveLength(26);
    expect(
      getProviderProtocols(getProviderPreset('ollama'), 'openai-responses'),
    ).toEqual(['openai-compatible', 'openai-responses']);
  });

  it.each([
    [undefined, 'openai'],
    ['https://api.openai.com/v1', 'openai'],
    ['https://api.deepseek.com', 'deepseek'],
    ['https://api.deepseek.com/v1/', 'deepseek'],
    ['https://gateway.example/v1', 'custom'],
    ['http://127.0.0.1:11434/v1', 'ollama'],
  ] as const)('keeps Responses endpoint %s branded as %s without replacing the saved protocol', (endpoint, expected) => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'My service',
      provider: 'openai-responses',
      endpoint,
      model: 'chosen-model',
    };
    expect(detectProviderPreset(saved).id).toBe(expected);
    expect(saved.provider).toBe('openai-responses');
    expect(saved.model).toBe('chosen-model');
  });

  it('does not invent a custom gateway endpoint or model', () => {
    const draft = createProviderDraft('custom', 'custom');
    expect(validateProviderDraft(draft, 'key')).toEqual({
      endpoint: 'required',
      model: 'required',
    });
    expect(getProviderPreset('ollama').credentialRequired).toBe(false);
  });
});

describe('provider setup validation', () => {
  it('requires a key for new cloud profiles and keeps an existing key on edits', () => {
    const profile = createProviderDraft('openai', 'saved');
    expect(validateProviderDraft(profile, '  ')).toEqual({
      credential: 'required',
    });
    expect(validateProviderDraft(profile, '', true)).toEqual({});
    expect(validateProviderDraft(profile, 'new-key')).toEqual({});
  });

  it('allows local models without an API key and rechecks a changed remote endpoint', () => {
    const profile = createProviderDraft('ollama', 'local');
    expect(validateProviderDraft(profile, '')).toEqual({});
    expect(
      validateProviderDraft(
        { ...profile, endpoint: 'https://ollama.example/v1' },
        '',
      ),
    ).toEqual({ credential: 'required' });
  });

  it.each([
    ['invalid-url', 'invalidEndpoint'],
    ['https://user:password@api.example/v1', 'invalidEndpoint'],
    ['https://api.example/v1?key=secret', 'invalidEndpoint'],
    ['https://api.example/v1#chat', 'invalidEndpoint'],
    ['http://api.example/v1', 'secureEndpoint'],
    ['http://localhost.other.example/v1', 'secureEndpoint'],
    ['ftp://localhost/v1', 'secureEndpoint'],
    ['https://api.example/v1/chat/completions', 'baseEndpoint'],
    ['https://api.example/v1/models', 'baseEndpoint'],
    ['https://api.example/v1/messages', 'baseEndpoint'],
    [
      'https://api.example/v1beta/models/gemini:generateContent',
      'baseEndpoint',
    ],
    ['https://api.example/v2/translate', 'baseEndpoint'],
    ['https://api.example/language/translate/v2', 'baseEndpoint'],
  ] as const)('explains unusable endpoint %s before a request', (endpoint, error) => {
    expect(
      validateProviderDraft(
        { ...createProviderDraft('openai', 'new'), endpoint },
        'key',
      ).endpoint,
    ).toBe(error);
  });

  it('reports missing names/models and allows Azure global resources without a region', () => {
    expect(
      validateProviderDraft(
        { ...createProviderDraft('openai', 'new'), name: ' ', model: ' ' },
        'key',
      ),
    ).toEqual({ name: 'required', model: 'required' });
    const azure = createProviderDraft('azure-translator', 'new');
    expect(validateProviderDraft(azure, 'key')).toEqual({});
    expect(
      validateProviderDraft({ ...azure, region: 'eastus' }, 'key'),
    ).toEqual({});
    expect(
      validateProviderDraft({ ...azure, region: 'East US' }, 'key'),
    ).toEqual({ region: 'invalidRegion' });
  });
});

describe('AI presets', () => {
  it('requires a chosen native model instead of silently using an unrelated default', () => {
    for (const provider of ['anthropic', 'gemini'] as const) {
      expect(
        validateProviderDraft(createProviderDraft(provider, 'native'), 'key'),
      ).toEqual({ model: 'required' });
    }
  });
});

describe('gateway presets', () => {
  it('starts Azure OpenAI drafts with api-key auth and requires the resource name', () => {
    const draft = createProviderDraft('azure-openai', 'az');
    expect(draft).toMatchObject({
      provider: 'openai-compatible',
      credentialHeader: 'api-key',
    });
    expect(validateProviderDraft({ ...draft, model: 'gpt' }, 'key')).toEqual({
      endpoint: 'invalidEndpoint',
    });
    expect(
      validateProviderDraft(
        {
          ...draft,
          endpoint: 'https://team.openai.azure.com/openai/v1',
          model: 'gpt',
        },
        'key',
      ),
    ).toEqual({});
  });

  it('recognizes saved Azure, LM Studio, and new hosted presets', () => {
    const detect = (endpoint: string) =>
      detectProviderPreset({
        id: 'x',
        name: 'x',
        provider: 'openai-compatible',
        endpoint,
      }).id;
    expect(detect('https://team.openai.azure.com/openai/v1')).toBe(
      'azure-openai',
    );
    expect(detect('http://localhost:1234/v1')).toBe('lmstudio');
    expect(detect('https://api.x.ai/v1')).toBe('xai');
    expect(detect('https://qianfan.baidubce.com/v2')).toBe('qianfan');
  });

  it('allows a non-secret api-version query only for AI protocols', () => {
    const azure = {
      id: 'a',
      name: 'Azure',
      provider: 'openai-compatible' as const,
      endpoint:
        'https://team.openai.azure.com/openai/deployments/gpt?api-version=2024-10-21',
      model: 'gpt',
    };
    expect(validateProviderDraft(azure, 'key')).toEqual({});
    expect(
      validateProviderDraft(
        { ...azure, endpoint: 'https://gw.example/v1?token=abc' },
        'key',
      ),
    ).toEqual({ endpoint: 'invalidEndpoint' });
  });
});
