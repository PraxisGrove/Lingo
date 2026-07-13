// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeInterfaceLanguage } from '../../lib/i18n/i18n';
import { SUPPORTED_UI_LOCALES } from '../../lib/i18n/locales';
import { resources } from '../../lib/i18n/resources';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';

const mocks = vi.hoisted(() => ({
  settings: null as unknown as typeof DEFAULT_SETTINGS,
}));
mocks.settings = { ...DEFAULT_SETTINGS };

vi.mock('@/lib/messaging/send-message', () => ({
  sendMessage: async () => ({
    hostPermissionGranted: true,
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
    setSettings: async (patch: object) => ({ ...mocks.settings, ...patch }),
    watchSettings: () => () => undefined,
  };
});

import App from './App';

describe('popup App', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    mocks.settings = { ...DEFAULT_SETTINGS };
    await changeInterfaceLanguage('en', 'en');
    document.body.innerHTML = '';
  });

  it('renders an accessible no-service recovery state in a narrow popup', async () => {
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
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('.popup')?.getAttribute('aria-busy')).toBe(
      'false',
    );
    expect(document.querySelector('h1')?.textContent).toBe(
      'Connect a translation service',
    );
    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Open settings"]',
      ),
    ).not.toBeNull();
    expect(document.body.textContent).toContain('Open settings');

    await act(async () => root.unmount());
  });

  it('keeps every current-page control named and keyboard reachable at 320px', async () => {
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      activeProviderProfileId: 'personal',
      providerProfiles: [
        { id: 'personal', name: 'Personal DeepL', provider: 'deepl' },
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
