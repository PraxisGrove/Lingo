// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeInterfaceLanguage } from '../../lib/i18n/i18n';
import { resources } from '../../lib/i18n/resources';
import { isExtensionMessage } from '../../lib/messaging/messages';
import {
  DEFAULT_SETTINGS,
  type ProviderProfile,
} from '../../lib/storage/settings-model';
import { ProviderIconImportError } from '../../lib/ui/import-provider-icon';

const mocks = vi.hoisted(() => ({
  settings: null as unknown as typeof DEFAULT_SETTINGS,
  sendMessage: vi.fn(),
  connected: vi.fn(),
  importIcon: vi.fn(),
  catalog: [
    { id: 'available-mini', name: 'Available Mini' },
    { id: 'available-pro', name: 'Available Pro' },
  ],
}));

vi.mock('@/lib/messaging/send-message', () => ({
  sendMessage: mocks.sendMessage,
}));
vi.mock('@/lib/ui/import-provider-icon', async () => ({
  ...(await vi.importActual<typeof import('../../lib/ui/import-provider-icon')>(
    '../../lib/ui/import-provider-icon',
  )),
  importProviderIcon: mocks.importIcon,
}));
vi.mock('@/lib/storage/settings', async () => {
  const model = await vi.importActual<
    typeof import('../../lib/storage/settings-model')
  >('../../lib/storage/settings-model');
  return {
    ...model,
    getSettings: async () => mocks.settings,
    setSettings: async (patch: object) => {
      mocks.settings = { ...mocks.settings, ...patch };
      return mocks.settings;
    },
  };
});

import ProviderSetup from './ProviderSetup';

const TEST_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+pda8AAAAASUVORK5CYII=';
let root: ReturnType<typeof createRoot> | null = null;

function Harness() {
  const [settings, setSettings] = useState(mocks.settings);
  return (
    <ProviderSetup
      settings={settings}
      onSettingsChange={setSettings}
      onConnected={mocks.connected}
    />
  );
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.settings = { ...DEFAULT_SETTINGS, uiLocale: 'en', theme: 'light' };
  mocks.connected.mockReset();
  mocks.importIcon.mockReset();
  mocks.importIcon.mockResolvedValue(TEST_ICON);
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockImplementation(
    async (
      type: string,
      payload: { profile: ProviderProfile; profileId?: string },
    ) => {
      if (type === 'listProviderModels')
        return { ok: true, models: mocks.catalog };
      if (type === 'saveProviderProfile') {
        const updating = mocks.settings.providerProfiles.some(
          (saved) => saved.id === payload.profile.id,
        );
        mocks.settings = {
          ...mocks.settings,
          providerProfiles: [
            ...mocks.settings.providerProfiles.filter(
              (saved) => saved.id !== payload.profile.id,
            ),
            payload.profile,
          ],
          activeProviderProfileId: updating
            ? mocks.settings.activeProviderProfileId
            : payload.profile.id,
        };
      }
      if (type === 'deleteProviderProfile') {
        mocks.settings = {
          ...mocks.settings,
          providerProfiles: mocks.settings.providerProfiles.filter(
            (saved) => saved.id !== payload.profileId,
          ),
          activeProviderProfileId: null,
        };
      }
      return { ok: true };
    },
  );
  await changeInterfaceLanguage('en', 'en');
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ProviderSetup', () => {
  it.each([
    ['name', ''],
    ['endpoint', 'http://service.example.com'],
    ['credential', ''],
  ])('reveals and focuses the first invalid %s field before making a request', async (name, value) => {
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);
    await mount();
    await input('credential', 'fixture-key');
    await input(name, value);
    await click('Connect & get models');
    const invalid = document.querySelector<HTMLInputElement>(
      `input[name="${name}"]`,
    );
    expect(document.activeElement).toBe(invalid);
    expect(invalid?.getAttribute('aria-invalid')).toBe('true');
    expect(invalid?.getAttribute('aria-describedby')).toBe(
      `model-setup-${name}-error`,
    );
    if (name !== 'credential')
      expect(invalid?.closest('details')?.open).toBe(true);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    const focusCount = scroll.mock.calls.length;
    await input(
      name,
      name === 'endpoint' ? 'https://service.example.com' : 'corrected',
    );
    expect(scroll).toHaveBeenCalledTimes(focusCount);
  });

  it('brings a saved-service editor into focus and lets a new draft be cancelled without retaining its key', async () => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'Saved service',
      provider: 'openai-compatible',
      endpoint: 'https://api.deepseek.com',
      model: 'available-pro',
    };
    mocks.settings = {
      ...mocks.settings,
      providerProfiles: [saved],
      activeProviderProfileId: saved.id,
    };
    await mount();
    await editSavedService();
    expect(document.activeElement).toBe(
      document.querySelector('input[name="credential"]'),
    );
    await click('Cancel');
    await click(resources.en.translation['modelSetup.add']);
    expect(document.activeElement).toBe(
      document.querySelector('input[name="providerSearch"]'),
    );
    await click('Add a custom service');
    await input('name', 'Discarded draft');
    await input('endpoint', 'https://draft.example.com');
    await input('credential', 'draft-private-key');
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Show key"]')
        ?.click(),
    );
    expect(
      document.querySelector<HTMLInputElement>('input[name="credential"]')
        ?.type,
    ).toBe('text');
    await click('Cancel');
    expect(document.querySelector('.model-setup-form')).toBeNull();
    expect(document.body.innerHTML).not.toContain('draft-private-key');
    await click(resources.en.translation['modelSetup.add']);
    const key = document.querySelector<HTMLInputElement>(
      'input[name="credential"]',
    );
    expect(key?.value).toBe('');
    expect(key?.type).toBe('password');
    expect(
      document.querySelector<HTMLInputElement>('input[name="name"]')?.value,
    ).toBe('OpenAI');
    expect(mocks.settings.providerProfiles).toEqual([saved]);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('imports models only on explicit connection and tests the selected real model before saving', async () => {
    await mount();
    await input('name', 'My reading account');
    await input('name', 'My translation account');
    await input('credential', '  private-key  ');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await click('Connect & get models');
    expect(mocks.sendMessage.mock.calls.map(([type]) => type)).toEqual([
      'listProviderModels',
    ]);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'listProviderModels',
      expect.objectContaining({ credential: 'private-key' }),
    );
    expect(document.querySelector('.model-selected')?.textContent).toContain(
      'Available Mini',
    );
    expect(document.activeElement).toBe(
      document.querySelector('.model-catalog-step h3'),
    );
    expect(document.querySelector('.model-provider-step')).toBeNull();
    expect(
      document.querySelector('.model-completed-connection')?.textContent,
    ).toContain('My translation account');
    expect(
      document.querySelector<HTMLAnchorElement>(
        '.model-completed-connection .model-provider-docs',
      )?.href,
    ).toContain('https://');
    expect(
      document.querySelector('.model-catalog-option[aria-pressed="true"]')
        ?.textContent,
    ).toContain('available-mini');
    await click('Test translation & save');
    expect(mocks.sendMessage.mock.calls.map(([type]) => type)).toEqual([
      'listProviderModels',
      'testProviderConnection',
      'saveProviderProfile',
    ]);
    const saved = mocks.settings.providerProfiles[0];
    expect(saved.name).toBe('My translation account');
    expect(saved.model).toBe('available-mini');
    expect(saved.model).not.toBe('gpt-4.1-mini');
    expect(saved.modelSelection).toBe('recommended');
    expect(saved.models).toEqual(mocks.catalog);
    expect(mocks.settings.setupCompleted).toBe(true);
    expect(mocks.connected).toHaveBeenCalledOnce();
    expect(document.querySelector('.model-ready')?.textContent).toContain(
      resources.en.translation['modelSetup.readyHelp'],
    );
    expect(document.querySelector('.model-setup-form')).toBeNull();
    expect(document.body.innerHTML).not.toContain('private-key');
  });

  it('reveals the current model step without motion and keeps connection edits explicit', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);
    await mount();
    await input('credential', 'private-key');
    await click('Connect & get models');
    expect(document.activeElement).toBe(
      document.querySelector('.model-catalog-step h3'),
    );
    expect(scroll).toHaveBeenLastCalledWith({
      block: 'start',
      behavior: 'auto',
    });
    expect(document.querySelector('.model-provider-step')).toBeNull();
    await click('Connection settings');
    const key = document.querySelector<HTMLInputElement>(
      'input[name="credential"]',
    );
    expect(document.activeElement).toBe(key);
    expect(key?.value).toBe('private-key');
    expect(key?.type).toBe('password');
    expect(document.querySelector('.model-provider-step')).not.toBeNull();
    await input('credential', 'updated-key');
    expect(document.querySelector('.model-catalog-step')).toBeNull();
    expect(mocks.sendMessage.mock.calls.map(([type]) => type)).toEqual([
      'listProviderModels',
    ]);
  });

  it('finishes model discovery in a hidden embedded editor without taking focus from the reading panel', async () => {
    let finishImport: (result: unknown) => void = () => undefined;
    mocks.sendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        finishImport = resolve;
      }),
    );
    await mount();
    await input('credential', 'fixture-key');
    await click('Connect & get models');
    const editor = document.getElementById('root');
    editor?.setAttribute('hidden', '');
    const readingAction = document.createElement('button');
    readingAction.textContent = 'Translate this page';
    document.body.append(readingAction);
    readingAction.focus();
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);
    await act(async () => finishImport({ ok: true, models: mocks.catalog }));
    expect(document.activeElement).toBe(readingAction);
    expect(scroll).not.toHaveBeenCalled();
    expect(editor?.querySelector('.model-selected code')?.textContent).toBe(
      'available-mini',
    );
  });

  it('exposes a direct custom service path and saves its visible name and chosen icon', async () => {
    await mount();
    await click('Add a custom service');
    const name = document.querySelector<HTMLInputElement>('input[name="name"]');
    expect(name?.closest('details')).toBeNull();
    await input('name', 'My gateway');
    await input('endpoint', 'https://gateway.example.com/v1');
    await input('credential', 'gateway-key');
    await select('iconSource', 'moonshot');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await click('Connect & get models');
    expect(
      document.querySelector<HTMLImageElement>(
        '.model-completed-connection .provider-icon',
      )?.src,
    ).toContain('/providers/moonshot.svg');
    await click('Test translation & save');
    expect(mocks.settings.providerProfiles[0]).toMatchObject({
      name: 'My gateway',
      model: 'available-mini',
      icon: { type: 'provider', providerId: 'moonshot' },
    });
    expect(
      document.querySelector('.model-saved-description strong')?.textContent,
    ).toBe('My gateway');
    expect(
      document.querySelector<HTMLImageElement>(
        '.model-saved-service .provider-icon',
      )?.src,
    ).toContain('/providers/moonshot.svg');
  });

  it('saves and restores appearance locally without testing or overwriting an unsaved connection draft', async () => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'Saved service',
      provider: 'openai-compatible',
      endpoint: 'https://api.deepseek.com',
      model: 'available-pro',
      models: mocks.catalog,
      modelSelection: 'manual',
      icon: { type: 'provider', providerId: 'groq' },
    };
    const backup: ProviderProfile = {
      id: 'backup',
      name: 'Backup service',
      provider: 'deepl',
    };
    mocks.settings = {
      ...mocks.settings,
      providerProfiles: [saved, backup],
      activeProviderProfileId: saved.id,
      fallbackProviderProfileIds: [backup.id],
      setupCompleted: true,
    };
    await mount();
    await editSavedService();
    await openConnectionSettings();
    await input('endpoint', 'https://unsaved.example.com/v1');
    await input('name', 'Team gateway');
    await select('iconSource', 'moonshot');
    await click('Save name and icon');
    expect(mocks.settings.providerProfiles[0]).toEqual({
      ...saved,
      name: 'Team gateway',
      icon: { type: 'provider', providerId: 'moonshot' },
    });
    expect(mocks.settings.providerProfiles[1]).toEqual(backup);
    expect(mocks.settings.activeProviderProfileId).toBe(saved.id);
    expect(mocks.settings.fallbackProviderProfileIds).toEqual([backup.id]);
    expect(
      document.querySelector<HTMLInputElement>('input[name="endpoint"]')?.value,
    ).toBe('https://unsaved.example.com/v1');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.connected).not.toHaveBeenCalled();
    await click('Restore automatic icon');
    await click('Save name and icon');
    expect(mocks.settings.providerProfiles[0]).not.toHaveProperty('icon');
    expect(
      document.querySelector<HTMLImageElement>(
        '.model-saved-service .provider-icon',
      )?.src,
    ).toContain('/providers/deepseek.svg');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the previous icon after a failed image import and saves a valid upload without changing models', async () => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'Saved service',
      provider: 'openai-compatible',
      endpoint: 'https://api.deepseek.com',
      model: 'available-pro',
      models: mocks.catalog,
      modelSelection: 'manual',
      icon: { type: 'provider', providerId: 'groq' },
    };
    mocks.settings = {
      ...mocks.settings,
      providerProfiles: [saved],
      activeProviderProfileId: saved.id,
      setupCompleted: true,
    };
    mocks.importIcon.mockRejectedValueOnce(
      new ProviderIconImportError('invalidImage'),
    );
    await mount();
    await editSavedService();
    await openConnectionSettings();
    await uploadFile();
    expect(
      document.querySelector('.model-icon-settings [role="status"]')
        ?.textContent,
    ).toContain('image');
    expect(
      document.querySelector<HTMLImageElement>(
        '.model-icon-settings .provider-icon',
      )?.src,
    ).toContain('/providers/groq.svg');
    expect(document.querySelector('.model-catalog-step')).not.toBeNull();
    expect(mocks.settings.providerProfiles[0]).toEqual(saved);
    await uploadFile();
    expect(
      document.querySelector<HTMLImageElement>(
        '.model-icon-settings .provider-icon',
      )?.src,
    ).toBe(TEST_ICON);
    expect(
      document.querySelector<HTMLInputElement>('#model-custom-icon-file')
        ?.value,
    ).toBe('');
    await click('Save name and icon');
    expect(mocks.settings.providerProfiles[0]).toEqual({
      ...saved,
      icon: { type: 'image', dataUrl: TEST_ICON },
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.connected).not.toHaveBeenCalled();
  });

  it('switches a local gateway to the protocol its chosen model supports', async () => {
    await mount();
    await click('More providers');
    await click('Local gateway');
    expect(
      (document.querySelector('input[name="endpoint"]') as HTMLInputElement)
        .value,
    ).toBe('http://127.0.0.1:3425/v1');
    mocks.sendMessage.mockResolvedValueOnce({
      ok: true,
      models: [
        {
          id: 'codex/gpt-sol',
          name: 'GPT Sol',
          protocols: ['openai-responses'],
        },
        {
          id: 'vm/claude-haiku',
          name: 'Claude Haiku',
          protocols: ['anthropic'],
        },
        { id: 'plain-model', name: 'Plain model' },
      ],
    });
    await click('Connect & get models');
    await click('Claude Haiku');
    expect(document.body.textContent).toContain(
      'Switched to Anthropic Messages',
    );
    await click('Plain model');
    await click('GPT Sol');
    expect(document.body.textContent).toContain('Switched to OpenAI Responses');
    await click('Test translation & save');
    expect(mocks.settings.providerProfiles[0]).toMatchObject({
      name: 'Local gateway',
      provider: 'openai-responses',
      model: 'codex/gpt-sol',
    });
  });

  it('preserves a manually selected model when a refreshed catalog omits it', async () => {
    await mount();
    await input('credential', 'key');
    await click('Connect & get models');
    await click('Available Pro');
    mocks.sendMessage.mockResolvedValueOnce({
      ok: true,
      models: [mocks.catalog[0]],
    });
    await click('Refresh list');
    expect(
      (document.querySelector('input[name="model"]') as HTMLInputElement).value,
    ).toBe('available-pro');
    expect(document.querySelector('.model-selected')?.textContent).toContain(
      'available-pro',
    );
    await click('Test translation & save');
    expect(mocks.settings.providerProfiles[0].model).toBe('available-pro');
    expect(mocks.settings.providerProfiles[0].modelSelection).toBe('manual');
    expect(mocks.settings.providerProfiles[0].models).toEqual([
      mocks.catalog[0],
    ]);
  });

  it('allows a manual model ID when listing fails without treating listing as a translation test', async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      ok: false,
      category: 'unsupported',
      message: 'This endpoint does not list models.',
    });
    await mount();
    await input('credential', 'key');
    await click('Connect & get models');
    expect(document.querySelector('.model-catalog-step')).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector('.model-discovery-error h4'),
    );
    expect(document.querySelector('input[name="endpoint"]')).not.toBeNull();
    expect(document.querySelector('.model-completed-connection')).toBeNull();
    await click('Enter model ID manually');
    expect(document.activeElement).toBe(
      document.querySelector('.model-catalog-step h3'),
    );
    expect(document.querySelector('.model-discovery-error')).toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      'testProviderConnection',
      expect.anything(),
    );
    await input('model', 'my-deployment');
    await click('Test translation & save');
    expect(mocks.settings.providerProfiles[0].model).toBe('my-deployment');
    expect(mocks.settings.providerProfiles[0].modelSelection).toBe('manual');
  });

  it('keeps failure controls localized and automatically selects an actual model after a corrected retry', async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      ok: false,
      category: 'authentication',
      message: 'UNLOCALIZED_SERVER_AUTH',
      status: 401,
      requestUrl:
        'http://user:password@127.0.0.1:3425/v1beta/models?key=never-show#secret',
    });
    mocks.sendMessage.mockResolvedValueOnce({
      ok: true,
      models: [{ id: 'group/auto-gpt-5-6-luna', name: 'Gateway model' }],
      resolvedEndpoint: 'http://127.0.0.1:3425/v1beta',
    });
    mocks.settings = { ...mocks.settings, uiLocale: 'zh-CN' };
    await changeInterfaceLanguage('zh-CN', 'en');
    await mount();
    await click('添加自定义服务');
    await input('endpoint', 'http://127.0.0.1:3425');
    await select('protocol', 'gemini');
    await input('credential', 'wrong-key');
    await click('连接并获取模型');
    const error = document.querySelector('.model-discovery-error');
    expect(error?.textContent).toContain('API 密钥认证失败');
    expect(error?.textContent).toContain('HTTP 401');
    expect(error?.textContent).toContain(
      'GET http://127.0.0.1:3425/v1beta/models',
    );
    expect(document.body.textContent).not.toContain('UNLOCALIZED_SERVER_AUTH');
    expect(error?.textContent).not.toContain('password');
    expect(error?.textContent).not.toContain('never-show');
    expect(document.querySelector('.model-catalog-step')).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('input[name="credential"]')
        ?.value,
    ).toBe('wrong-key');
    expect(
      document
        .querySelector<HTMLInputElement>('input[name="endpoint"]')
        ?.closest('details'),
    ).toBeNull();
    await input('credential', 'correct-key');
    await click('连接并获取模型');
    expect(document.querySelector('.model-selected code')?.textContent).toBe(
      'group/auto-gpt-5-6-luna',
    );
    expect(
      document.querySelector('.model-policy button[aria-pressed="true"]')
        ?.textContent,
    ).toBe('自动推荐');
    await click('测试翻译并保存');
    expect(mocks.settings.providerProfiles[0]).toMatchObject({
      provider: 'gemini',
      endpoint: 'http://127.0.0.1:3425/v1beta',
      model: 'group/auto-gpt-5-6-luna',
      modelSelection: 'recommended',
    });
  });

  it.each([
    undefined,
    null,
    { ok: true },
  ])('offers extension reload for an unavailable background response: %s', async (response) => {
    const reload = vi.fn();
    vi.stubGlobal('browser', { runtime: { reload } });
    mocks.sendMessage.mockResolvedValueOnce(response);
    await mount();
    await input('credential', 'key');
    await click('Connect & get models');
    expect(
      document.querySelector('.model-discovery-error')?.textContent,
    ).toContain("Lingo's background did not respond");
    expect(document.querySelector('.model-catalog-step')).toBeNull();
    expect(document.querySelector('input[name="credential"]')).not.toBeNull();
    await click('Reload Lingo');
    expect(reload).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      'testProviderConnection',
      expect.anything(),
    );
  });

  it.each([
    'OpenAI',
    'DeepSeek',
  ])('switches %s from Chat to Responses without losing service details or reusing a prior catalog', async (vendor) => {
    await mount();
    if (vendor === 'DeepSeek') await click('DeepSeek');
    const protocol = document.querySelector<HTMLSelectElement>(
      'select[name="protocol"]',
    );
    expect(
      [...(protocol?.options ?? [])].map((option) => option.textContent),
    ).toEqual(['OpenAI Chat Completions', 'OpenAI Responses']);
    expect(protocol?.value).toBe('openai-compatible');
    await input('name', 'My reading account');
    await input('credential', 'private-key');
    await select('iconSource', 'moonshot');
    const endpoint = document.querySelector<HTMLInputElement>(
      'input[name="endpoint"]',
    )?.value;
    await click('Connect & get models');
    await click('Connection settings');
    await select('protocol', 'openai-responses');
    expect(
      document.querySelector<HTMLInputElement>('input[name="name"]')?.value,
    ).toBe('My reading account');
    expect(
      document.querySelector<HTMLInputElement>('input[name="endpoint"]')?.value,
    ).toBe(endpoint);
    expect(
      document.querySelector<HTMLInputElement>('input[name="credential"]')
        ?.value,
    ).toBe('private-key');
    expect(
      document.querySelector<HTMLSelectElement>('select[name="iconSource"]')
        ?.value,
    ).toBe('moonshot');
    expect(document.querySelector('.model-catalog-step')).toBeNull();
    expect(mocks.sendMessage.mock.calls).toHaveLength(1);
    await click('Connect & get models');
    const request = mocks.sendMessage.mock.calls[1][1];
    expect(request.profile).toMatchObject({
      provider: 'openai-responses',
      name: 'My reading account',
      endpoint,
      icon: { type: 'provider', providerId: 'moonshot' },
      modelSelection: 'recommended',
    });
    expect(request.profile).not.toHaveProperty('model');
    expect(request.profile).not.toHaveProperty('models');
    expect(
      isExtensionMessage({ type: 'listProviderModels', payload: request }),
    ).toBe(true);
    await click('Test translation & save');
    expect(mocks.settings.providerProfiles[0]).toMatchObject({
      provider: 'openai-responses',
      model: 'available-mini',
      models: mocks.catalog,
    });
  });

  it('reopens a saved Responses service with its vendor identity, chosen model and protocol intact', async () => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'Saved service',
      provider: 'openai-responses',
      endpoint: 'https://api.deepseek.com',
      model: 'available-pro',
      models: mocks.catalog,
      modelSelection: 'manual',
    };
    mocks.settings = {
      ...mocks.settings,
      providerProfiles: [saved],
      activeProviderProfileId: saved.id,
    };
    await mount();
    expect(
      document.querySelector<HTMLImageElement>(
        '.model-saved-service .provider-icon',
      )?.dataset.provider,
    ).toBe('deepseek');
    await editSavedService();
    expect(
      document.querySelector<HTMLSelectElement>('select[name="protocol"]')
        ?.value,
    ).toBe('openai-responses');
    expect(document.querySelector('.model-selected code')?.textContent).toBe(
      'available-pro',
    );
    expect(
      document.querySelector('.model-policy button[aria-pressed="true"]')
        ?.textContent,
    ).toBe(resources.en.translation['modelPolicy.manual']);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await click('Test translation & save');
    expect(mocks.settings.providerProfiles[0]).toEqual(saved);
  });

  it('exposes all four standard protocols for custom services without assuming Responses support for other new presets', async () => {
    await mount();
    await click('Add a custom service');
    const protocol = document.querySelector<HTMLSelectElement>(
      'select[name="protocol"]',
    );
    expect(
      [...(protocol?.options ?? [])].map((option) => option.value),
    ).toEqual(['openai-compatible', 'openai-responses', 'anthropic', 'gemini']);
    await click('SiliconFlow');
    expect(document.querySelector('select[name="protocol"]')).toBeNull();
  });

  it('switches a custom protocol without dropping connection appearance or retaining another protocol model', async () => {
    await mount();
    await click('Add a custom service');
    await input('name', 'My gateway');
    await input('endpoint', 'http://127.0.0.1:3425');
    await input('credential', 'gateway-key');
    await select('iconSource', 'moonshot');
    await click('Connect & get models');
    await click('Connection settings');
    await select('protocol', 'gemini');
    expect(
      document.querySelector<HTMLInputElement>('input[name="name"]')?.value,
    ).toBe('My gateway');
    expect(
      document.querySelector<HTMLInputElement>('input[name="endpoint"]')?.value,
    ).toBe('http://127.0.0.1:3425');
    expect(
      document.querySelector<HTMLInputElement>('input[name="credential"]')
        ?.value,
    ).toBe('gateway-key');
    expect(
      document.querySelector<HTMLSelectElement>('select[name="iconSource"]')
        ?.value,
    ).toBe('moonshot');
    expect(document.querySelector('.model-catalog-step')).toBeNull();
    expect(mocks.sendMessage.mock.calls).toHaveLength(1);
    await click('Connect & get models');
    const request = mocks.sendMessage.mock.calls[1][1];
    expect(request.profile).toMatchObject({
      provider: 'gemini',
      name: 'My gateway',
      endpoint: 'http://127.0.0.1:3425',
      icon: { type: 'provider', providerId: 'moonshot' },
      modelSelection: 'recommended',
    });
    expect(request.profile).not.toHaveProperty('model');
    expect(request.profile).not.toHaveProperty('models');
    expect(
      isExtensionMessage({ type: 'listProviderModels', payload: request }),
    ).toBe(true);
  });

  it('reopens a saved native gateway as a named local gateway without an official provider signup link', async () => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'Saved service',
      provider: 'gemini',
      endpoint: 'http://127.0.0.1:3425/v1beta',
      model: 'group/auto-gpt-5-6-luna',
      modelSelection: 'manual',
    };
    mocks.settings = {
      ...mocks.settings,
      providerProfiles: [saved],
      activeProviderProfileId: saved.id,
    };
    await mount();
    await editSavedService();
    expect(
      document.querySelector<HTMLSelectElement>('select[name="protocol"]')
        ?.value,
    ).toBe('gemini');
    expect(
      document
        .querySelector<HTMLInputElement>('input[name="name"]')
        ?.closest('details'),
    ).toBeNull();
    expect(document.querySelector('.model-key-heading a')).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('input[name="endpoint"]')?.value,
    ).toBe(saved.endpoint);
  });

  it('discovers native Anthropic models before requiring a concrete model for translation', async () => {
    await mount();
    await click('Anthropic');
    await input('credential', 'anthropic-key');
    await click('Connect & get models');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'listProviderModels',
      expect.objectContaining({
        profile: expect.objectContaining({ provider: 'anthropic' }),
      }),
    );
    await click('Test translation & save');
    expect(mocks.settings.providerProfiles[0]).toMatchObject({
      provider: 'anthropic',
      model: 'available-mini',
    });
  });

  it('keeps saved keys private and reuses them when refreshing and editing a saved service', async () => {
    const saved: ProviderProfile = {
      id: 'saved',
      name: 'Saved service',
      provider: 'openai-compatible',
      endpoint: 'https://api.deepseek.com',
      model: 'available-pro',
      models: mocks.catalog,
      modelSelection: 'manual',
    };
    mocks.settings = {
      ...mocks.settings,
      providerProfiles: [saved],
      activeProviderProfileId: saved.id,
      setupCompleted: true,
    };
    await mount();
    const edit = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Saved service"]',
    );
    await act(async () => edit?.click());
    const key = document.querySelector<HTMLInputElement>(
      'input[name="credential"]',
    );
    expect(key?.value).toBe('');
    expect(key?.type).toBe('password');
    expect(key?.placeholder).toBe('Leave blank to keep the saved key');
    await click('Refresh list');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'listProviderModels',
      expect.objectContaining({
        credential: '',
        profile: expect.objectContaining({ id: 'saved' }),
      }),
    );
    await click('Test translation & save');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'saveProviderProfile',
      expect.objectContaining({
        credential: '',
        profile: expect.objectContaining({
          id: 'saved',
          model: 'available-pro',
        }),
      }),
    );
    expect(mocks.settings.providerProfiles).toHaveLength(1);
  });

  it('imports the documented MiniMax catalog instead of forcing manual configuration', async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      ok: true,
      models: [
        { id: 'MiniMax-M3', name: 'MiniMax-M3' },
        { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7' },
      ],
    });
    await mount();
    await click('China');
    await click('MiniMax');
    expect(document.querySelector('.model-connect-button')).not.toBeNull();
    expect(document.querySelector('.model-catalog-step')).toBeNull();
    await input('credential', 'fixture-key');
    await click('Connect & get models');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'listProviderModels',
      expect.objectContaining({
        profile: expect.objectContaining({
          endpoint: 'https://api.minimax.io/v1',
        }),
      }),
    );
    expect(document.querySelector('.model-selected')?.textContent).toContain(
      'MiniMax-M2.7',
    );
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      'testProviderConnection',
      expect.anything(),
    );
  });

  it('offers a manual model step for providers without a model-list API', async () => {
    await mount();
    await click('China');
    await click('Doubao');
    expect(document.querySelector('.model-catalog-step')).not.toBeNull();
    expect(document.querySelector('.model-connect-button')).toBeNull();
    expect(
      document.querySelector('.model-discovery-warning')?.textContent,
    ).toContain('deployment ID');
    await input('credential', 'key');
    // Changing credentials invalidates any import, but a provider with no list API still needs a manual path.
    expect(document.querySelector('input[name="model"]')).not.toBeNull();
    await input('model', 'ep-my-deployment');
    await click('Test translation & save');
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      'listProviderModels',
      expect.anything(),
    );
    expect(mocks.settings.providerProfiles[0].model).toBe('ep-my-deployment');
  });

  it('localizes a rejected translation test without saving an unverified service', async () => {
    await mount();
    await input('credential', 'key');
    await click('Connect & get models');
    mocks.sendMessage.mockResolvedValueOnce({
      ok: false,
      category: 'invalid-response',
      message: 'Internal provider contract failure',
    });
    await click('Test translation & save');
    const error = document.querySelector('.model-setup-inline-error');
    expect(error?.textContent).toBe(
      resources.en.translation['modelSetup.testErrors.invalidResponse'],
    );
    expect(error?.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(error);
    expect(error?.previousElementSibling?.className).toBe('model-setup-footer');
    await click('Connection settings');
    expect(
      document.querySelector<HTMLInputElement>('input[name="credential"]')
        ?.value,
    ).toBe('key');
    expect(document.querySelector('.model-selected code')?.textContent).toBe(
      'available-mini',
    );
    expect(document.body.textContent).not.toContain(
      'Internal provider contract failure',
    );
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      'saveProviderProfile',
      expect.anything(),
    );
    expect(mocks.settings.providerProfiles).toEqual([]);
    expect(mocks.connected).not.toHaveBeenCalled();
  });

  it('distinguishes testing from saving and focuses a save failure without losing the configured model', async () => {
    await mount();
    await input('credential', 'fixture-key');
    await click('Connect & get models');
    let finishTest: (result: unknown) => void = () => undefined;
    let failSave: (reason: unknown) => void = () => undefined;
    mocks.sendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        finishTest = resolve;
      }),
    );
    mocks.sendMessage.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failSave = reject;
      }),
    );
    await click('Test translation & save');
    expect(
      document.querySelector('button[type="submit"]')?.textContent,
    ).toContain(resources.en.translation['modelSetup.testing']);
    await act(async () => finishTest({ ok: true }));
    expect(
      document.querySelector('button[type="submit"]')?.textContent,
    ).toContain(resources.en.translation['modelSetup.saving']);
    await act(async () => failSave(new Error('Storage write failed')));
    const error = document.querySelector('.model-setup-inline-error');
    expect(error?.textContent).toBe(
      resources.en.translation['modelSetup.saveFailed'],
    );
    expect(document.activeElement).toBe(error);
    expect(document.querySelector('.model-selected code')?.textContent).toBe(
      'available-mini',
    );
    expect(mocks.settings.providerProfiles).toEqual([]);
    expect(mocks.connected).not.toHaveBeenCalled();
  });

  it('strips undefined model fields before refreshing an empty catalog', async () => {
    mocks.sendMessage.mockResolvedValueOnce({ ok: true, models: [] });
    await mount();
    await input('credential', 'key');
    await click('Connect & get models');
    await click(resources.en.translation['modelPolicy.manual']);
    await click('Refresh list');
    const requests = mocks.sendMessage.mock.calls.filter(
      ([type]) => type === 'listProviderModels',
    );
    expect(requests).toHaveLength(2);
    expect(requests[1][1].profile).not.toHaveProperty('model');
    expect(Object.values(requests[1][1].profile)).not.toContain(undefined);
    expect(
      isExtensionMessage({
        type: 'listProviderModels',
        payload: requests[1][1],
      }),
    ).toBe(true);
  });

  it('keeps the DeepL API plan visible and tests the selected plan endpoint', async () => {
    await mount();
    await click('Translation');
    await click('DeepL');
    const plan = document.querySelector<HTMLSelectElement>(
      'select[name="deeplPlan"]',
    );
    expect(plan).not.toBeNull();
    await act(async () => {
      if (plan) {
        plan.value = 'https://api.deepl.com';
        plan.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await input('credential', 'deepl-key');
    await click('Test translation & save');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'testProviderConnection',
      expect.objectContaining({
        profile: expect.objectContaining({
          provider: 'deepl',
          endpoint: 'https://api.deepl.com',
        }),
      }),
    );
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      'listProviderModels',
      expect.anything(),
    );
  });

  it('prevents provider editing during an import and avoids saving a stale test after unmount', async () => {
    let finishImport: (result: unknown) => void = () => undefined;
    mocks.sendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        finishImport = resolve;
      }),
    );
    await mount();
    await input('credential', 'key');
    await click('Connect & get models');
    expect(
      document.querySelector<HTMLFieldSetElement>(
        '.model-setup-form > fieldset',
      )?.disabled,
    ).toBe(true);
    await act(async () => finishImport({ ok: true, models: mocks.catalog }));
    let finishTest: (result: unknown) => void = () => undefined;
    mocks.sendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        finishTest = resolve;
      }),
    );
    await click('Test translation & save');
    await act(async () => root?.unmount());
    root = null;
    await act(async () => finishTest({ ok: true }));
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      'saveProviderProfile',
      expect.anything(),
    );
    expect(mocks.connected).not.toHaveBeenCalled();
  });
});

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => root?.render(<Harness />));
}
async function click(text: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent?.trim().includes(text));
  expect(button, text).toBeDefined();
  await act(async () => button?.click());
}
async function input(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(
    `input[name="${name}"]`,
  );
  expect(field, name).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(field, value);
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function select(name: string, value: string) {
  const field = document.querySelector<HTMLSelectElement>(
    `select[name="${name}"]`,
  );
  expect(field, name).not.toBeNull();
  await act(async () => {
    if (field) {
      field.value = value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}
async function editSavedService() {
  const edit = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Edit Saved service"]',
  );
  await act(async () => edit?.click());
}
async function openConnectionSettings() {
  const details = document.querySelector<HTMLDetailsElement>(
    '.model-connection-settings',
  );
  await act(async () => {
    if (details) {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    }
  });
}
async function uploadFile() {
  const field = document.querySelector<HTMLInputElement>(
    '#model-custom-icon-file',
  );
  expect(field).not.toBeNull();
  const file = new File(['local raster fixture'], 'icon.png', {
    type: 'image/png',
  });
  Object.defineProperty(field, 'files', { configurable: true, value: [file] });
  await act(async () =>
    field?.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
