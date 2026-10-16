// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeInterfaceLanguage } from '../../lib/i18n/i18n';
import { SUPPORTED_UI_LOCALES } from '../../lib/i18n/locales';
import { resources } from '../../lib/i18n/resources';
import type { SessionSnapshot } from '../../lib/page-translation/page-translation';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';

const mocks = vi.hoisted(() => ({
  settings: null as unknown as typeof DEFAULT_SETTINGS,
  hostPermissionGranted: true,
}));
mocks.settings = { ...DEFAULT_SETTINGS };

vi.mock('@/lib/messaging/send-message', () => ({
  sendMessage: async () => ({
    hostPermissionGranted: mocks.hostPermissionGranted,
    cache: { entryCount: 0, byteSize: 0 },
  }),
}));

vi.mock('@/lib/rules/user-rules', () => ({
  userRuleStore: {
    translationPolicyFor: async () => 'default',
    setTranslationPolicy: async () => undefined,
  },
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
    watchSettings: () => () => undefined,
  };
});

import App from './App';

describe('popup App', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
  afterEach(async () => {
    vi.unstubAllGlobals();
    mocks.settings = { ...DEFAULT_SETTINGS };
    mocks.hostPermissionGranted = true;
    await changeInterfaceLanguage('en', 'en');
    document.body.innerHTML = '';
  });

  it('renders an accessible no-service recovery state in a narrow popup', async () => {
    const openOptionsPage = vi.fn();
    const openSettings = vi.fn();
    const createTab = vi.fn();
    vi.stubGlobal('browser', {
      runtime: { openOptionsPage },
      tabs: {
        create: createTab,
        query: async () => [{ id: 1, url: 'https://docs.example.com/page' }],
        sendMessage: async () => ({
          status: 'idle',
          displayMode: 'bilingual',
          translatedUnitCount: 0,
          failedUnitCount: 0,
          totalUnitCount: 0,
          pageRevision: 0,
        }),
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);

    await act(async () => {
      root.render(<App onOpenSettings={openSettings} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('.popup')?.getAttribute('aria-busy')).toBe(
      'false',
    );
    expect(document.querySelector('h1')?.textContent).toBe(
      resources.en.translation['popup.notice.noService.title'],
    );
    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Open settings"]',
      ),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(
      resources.en.translation['popup.setup.ownKey'],
    );
    expect(document.querySelector('.session-controls')).toBeNull();
    expect(document.querySelector('.translation-settings')).toBeNull();
    const setupButton = document.querySelector<HTMLButtonElement>(
      '.notice-no-service .primary-action',
    );
    expect(setupButton?.textContent).toContain(
      resources.en.translation['popup.setup.action'],
    );
    await act(async () => setupButton?.click());
    expect(openSettings).toHaveBeenCalledWith('provider');
    await act(async () =>
      document.querySelector<HTMLButtonElement>('.settings-button')?.click(),
    );
    expect(openSettings).toHaveBeenCalledTimes(2);
    expect(openOptionsPage).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('keeps every current-page control named and keyboard reachable at 320px', async () => {
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      activeProviderProfileId: 'personal',
      providerProfiles: [
        {
          id: 'personal',
          name: 'Company translator',
          provider: 'deepl',
          icon: { type: 'provider', providerId: 'moonshot' },
        },
      ],
    };
    vi.stubGlobal('browser', {
      runtime: { openOptionsPage: vi.fn() },
      tabs: {
        query: async () => [{ id: 1, url: 'https://docs.example.com/page' }],
        sendMessage: async () => ({
          status: 'idle',
          displayMode: 'bilingual',
          translatedUnitCount: 0,
          failedUnitCount: 0,
          totalUnitCount: 0,
          pageRevision: 0,
        }),
      },
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320,
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('.popup')).not.toBeNull();
    expect(document.querySelector('[tabindex="-1"]')).toBeNull();
    expect(
      document.querySelector<HTMLImageElement>('.service-picker .provider-icon')
        ?.src,
    ).toContain('/providers/moonshot.svg');
    expect(
      document.querySelector<HTMLSelectElement>('.service-picker select')
        ?.selectedOptions[0]?.textContent,
    ).toBe('Company translator');
    expect(
      document.querySelector<HTMLImageElement>('.service-picker .provider-icon')
        ?.alt,
    ).toBe('');
    for (const button of document.querySelectorAll('button')) {
      expect(
        button.getAttribute('aria-label') || button.textContent?.trim(),
      ).toBeTruthy();
    }
    for (const select of document.querySelectorAll('select')) {
      expect(select.closest('label')?.textContent?.trim()).toBeTruthy();
    }

    await act(async () => root.unmount());
  });

  it('keeps translation and recovery actions working through the redesigned controls', async () => {
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      uiLocale: 'en',
      sourceLanguage: 'en',
      activeProviderProfileId: 'personal',
      providerProfiles: [
        {
          id: 'personal',
          name: 'My AI',
          provider: 'openai-compatible',
          model: 'translation-model',
        },
      ],
    };
    const createTab = vi.fn(async () => undefined);
    const openOptionsPage = vi.fn();
    let status = 'idle';
    const sendToPage = vi.fn(async (_tabId, message) => {
      if (message.type === 'startPageTranslation') status = 'translating';
      if (message.type === 'stopPageTranslation') status = 'idle';
      return {
        status,
        displayMode: message.payload.displayMode ?? 'bilingual',
        translatedUnitCount: 0,
        failedUnitCount: 0,
        totalUnitCount: status === 'idle' ? 0 : 4,
        pageRevision: 0,
      };
    });
    vi.stubGlobal('browser', {
      runtime: {
        openOptionsPage,
        getURL: (path: string) => `chrome-extension://test${path}`,
      },
      tabs: {
        create: createTab,
        query: async () => [{ id: 1, url: 'https://docs.example.com' }],
        sendMessage: sendToPage,
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('.source-language')?.textContent).toContain(
      'English',
    );
    expect(document.querySelector('.service-model')?.textContent).toContain(
      'translation-model',
    );
    const preferences = document.querySelector('details');
    expect(preferences?.open).toBe(false);
    await act(async () => {
      if (preferences) preferences.open = true;
    });
    await act(async () =>
      document.querySelector<HTMLButtonElement>('.service-manage')?.click(),
    );
    expect(createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options.html#provider-heading',
    });
    expect(openOptionsPage).not.toHaveBeenCalled();

    const tabsBeforeTranslation = createTab.mock.calls.length;
    await act(async () =>
      document.querySelector<HTMLInputElement>('.toggle-option input')?.click(),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('.main-command')?.click(),
    );
    expect(sendToPage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: 'startPageTranslation',
        payload: expect.objectContaining({
          targetLanguage: 'zh-CN',
          contentScope: 'main-and-interface',
          displayMode: 'bilingual',
        }),
      }),
      undefined,
    );
    expect(document.querySelectorAll('.segmented-control button')).toHaveLength(
      3,
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('.text-button')?.click(),
    );
    expect(sendToPage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: 'stopPageTranslation' }),
      undefined,
    );
    expect(document.querySelector('.main-command')?.textContent).toContain(
      'Translate page',
    );
    expect(createTab).toHaveBeenCalledTimes(tabsBeforeTranslation);
    await act(async () => root.unmount());
  });

  it('persists a quick model switch and restarts the active page without changing its display or scope', async () => {
    const models = [
      { id: 'fast', name: 'Fast model' },
      { id: 'quality', name: 'Quality model' },
    ];
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      uiLocale: 'en',
      activeProviderProfileId: 'personal',
      providerProfiles: [
        {
          id: 'personal',
          name: 'My AI',
          provider: 'openai-compatible',
          model: 'fast',
          models,
          modelSelection: 'recommended',
        },
      ],
    };
    const sendToPage = vi.fn(
      async (_id: number, _message: unknown, _options?: unknown) => ({
        status: 'translated',
        displayMode: 'translation',
        translatedUnitCount: 4,
        failedUnitCount: 0,
        totalUnitCount: 4,
        pageRevision: 0,
      }),
    );
    vi.stubGlobal('browser', {
      runtime: { openOptionsPage: vi.fn() },
      tabs: {
        query: async () => [{ id: 1, url: 'https://docs.example.com/page' }],
        sendMessage: sendToPage,
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const picker = document.querySelector<HTMLSelectElement>(
      '.popup-model-picker select',
    );
    expect(picker?.value).toBe('fast');
    await act(async () => {
      if (picker) {
        picker.value = 'quality';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(mocks.settings.providerProfiles[0]).toMatchObject({
      model: 'quality',
      modelSelection: 'manual',
      models,
    });
    const restart = sendToPage.mock.calls.find(
      (call) => (call[1] as { type?: string })?.type === 'startPageTranslation',
    );
    expect(restart).toEqual([
      1,
      {
        type: 'startPageTranslation',
        payload: {
          targetLanguage: 'zh-CN',
          displayMode: 'translation',
          restart: true,
        },
      },
      undefined,
    ]);
    expect(
      document.querySelector('.segmented-control button[aria-pressed="true"]')
        ?.textContent,
    ).toBe('Translation');
    await act(async () => root.unmount());
  });

  it.each([
    'quota',
    'authentication',
    'rate-limit',
    'network',
  ])('keeps existing translations controllable after a %s failure', async (category) => {
    mocks.settings = configuredSettings();
    const openSettings = vi.fn();
    let snapshot: SessionSnapshot = failedSnapshot(category);
    const sendToPage = vi.fn(async (_id: number, message) => {
      if (message.type === 'updatePageTranslation')
        snapshot = { ...snapshot, displayMode: message.payload.displayMode };
      if (message.type === 'stopPageTranslation')
        snapshot = {
          status: 'idle',
          displayMode: 'bilingual',
          translatedUnitCount: 0,
          failedUnitCount: 0,
          totalUnitCount: 0,
          pageRevision: 0,
        };
      return snapshot;
    });
    vi.stubGlobal('browser', {
      tabs: {
        query: async () => [{ id: 1, url: 'https://docs.example.com/page' }],
        sendMessage: sendToPage,
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => root.render(<App onOpenSettings={openSettings} />));

    expect(document.querySelector('.notice')).not.toBeNull();
    expect(document.querySelectorAll('.segmented-control button')).toHaveLength(
      3,
    );
    expect(
      document.querySelectorAll('.translation-settings select'),
    ).toHaveLength(3);
    expect(document.querySelector('.command-row .primary-action')).toBeNull();
    expect(document.querySelector('.retry-action')).toBeNull();
    expect(
      document.querySelector<HTMLDetailsElement>('.page-preferences')?.open,
    ).toBe(false);
    const appearance = document.querySelector<HTMLButtonElement>(
      '.reading-appearance-shortcut',
    );
    expect(appearance?.closest('.page-preferences')).toBeNull();
    await act(async () => appearance?.click());
    expect(openSettings).toHaveBeenCalledWith('reading');
    expect(
      sendToPage.mock.calls.some(
        ([, message]) => message.type !== 'getPageTranslation',
      ),
    ).toBe(false);

    await act(async () =>
      document
        .querySelectorAll<HTMLButtonElement>('.segmented-control button')[2]
        ?.click(),
    );
    expect(snapshot.displayMode).toBe('original');
    expect(snapshot.failure?.category).toBe(category);
    expect(document.querySelector('.notice')).not.toBeNull();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('.command-row .text-button')
        ?.click(),
    );
    expect(sendToPage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: 'stopPageTranslation' }),
      undefined,
    );
    expect(document.querySelector('.notice')).toBeNull();
    expect(document.querySelector('.main-command')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it.each([
    ['model', '.popup-model-picker select', 'quality'],
    ['service', '.service-picker select', 'backup'],
    ['language', '.target-language', 'ja'],
  ])('can recover from an authentication failure by switching the %s', async (_kind, selector, value) => {
    mocks.settings = configuredSettings();
    let snapshot = failedSnapshot('authentication');
    const sendToPage = vi.fn(async (_id: number, message) => {
      if (message.type === 'startPageTranslation')
        snapshot = {
          ...snapshot,
          status: 'translating',
          failedUnitCount: 0,
          failure: undefined,
        };
      return snapshot;
    });
    vi.stubGlobal('browser', {
      tabs: {
        query: async () => [{ id: 1, url: 'https://docs.example.com/page' }],
        sendMessage: sendToPage,
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => root.render(<App />));
    const picker = document.querySelector<HTMLSelectElement>(selector);
    expect(picker?.disabled).toBe(false);
    await act(async () => {
      if (picker) {
        picker.value = value;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(sendToPage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: 'startPageTranslation',
        payload: {
          targetLanguage: _kind === 'language' ? 'ja' : 'zh-CN',
          displayMode: 'translation',
          restart: true,
        },
      }),
      undefined,
    );
    if (_kind === 'model')
      expect(mocks.settings.providerProfiles[0].model).toBe('quality');
    if (_kind === 'service')
      expect(mocks.settings.activeProviderProfileId).toBe('backup');
    expect(document.querySelector('.notice')).toBeNull();
    await act(async () => root.unmount());
  });

  it('opens reading preferences directly from the compatibility popup', async () => {
    mocks.settings = configuredSettings();
    const createTab = vi.fn();
    const sendToPage = vi.fn(async () => ({
      ...failedSnapshot('network'),
      status: 'idle',
      failure: undefined,
    }));
    vi.stubGlobal('browser', {
      runtime: { getURL: (path: string) => `chrome-extension://test${path}` },
      tabs: {
        create: createTab,
        query: async () => [{ id: 1, url: 'https://docs.example.com/page' }],
        sendMessage: sendToPage,
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => root.render(<App />));
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('.reading-appearance-shortcut')
        ?.click(),
    );
    expect(createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options.html#language-heading',
    });
    expect(sendToPage).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it.each([
    'disabled',
    'no-permission',
    'unsupported-page',
  ])('does not offer translation controls for a %s page', async (kind) => {
    mocks.settings = {
      ...configuredSettings(),
      enabled: kind !== 'disabled',
    };
    mocks.hostPermissionGranted = kind !== 'no-permission';
    vi.stubGlobal('browser', {
      tabs: {
        query: async () => [{ id: 1, url: 'https://docs.example.com/page' }],
        sendMessage: async () =>
          kind === 'unsupported-page' ? null : failedSnapshot('network'),
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => root.render(<App />));
    expect(document.querySelector(`.notice-${kind}`)).not.toBeNull();
    expect(document.querySelector('.session-controls')).toBeNull();
    expect(document.querySelector('.translation-settings')).toBeNull();
    await act(async () => root.unmount());
  });

  it.each(
    SUPPORTED_UI_LOCALES,
  )('renders the recovery surface in %s', async (locale) => {
    mocks.settings = { ...DEFAULT_SETTINGS, uiLocale: locale };
    await changeInterfaceLanguage(locale, 'en');
    vi.stubGlobal('browser', {
      runtime: { openOptionsPage: vi.fn() },
      tabs: {
        query: async () => [{ id: 1, url: 'https://docs.example.com' }],
        sendMessage: async () => ({
          status: 'idle',
          displayMode: 'bilingual',
          translatedUnitCount: 0,
          failedUnitCount: 0,
          totalUnitCount: 0,
          pageRevision: 0,
        }),
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('h1')?.textContent).toBe(
      resources[locale].translation['popup.notice.noService.title'],
    );
    expect(document.documentElement.lang).toBe(locale);
    await act(async () => root.unmount());
  });
});

function configuredSettings(): typeof DEFAULT_SETTINGS {
  return {
    ...DEFAULT_SETTINGS,
    uiLocale: 'en',
    activeProviderProfileId: 'personal',
    providerProfiles: [
      {
        id: 'personal',
        name: 'My AI',
        provider: 'openai-compatible',
        model: 'fast',
        models: [
          { id: 'fast', name: 'Fast model' },
          { id: 'quality', name: 'Quality model' },
        ],
      },
      { id: 'backup', name: 'Backup', provider: 'deepl' },
    ],
  };
}

function failedSnapshot(category: string): SessionSnapshot {
  return {
    status: 'failed',
    displayMode: 'translation',
    translatedUnitCount: 2,
    failedUnitCount: 1,
    totalUnitCount: 5,
    pageRevision: 0,
    failure: { category, message: 'The service request failed.' },
  };
}
