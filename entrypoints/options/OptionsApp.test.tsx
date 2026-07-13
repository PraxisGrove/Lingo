// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';

const mocks = vi.hoisted(() => ({
  settings: null as unknown as typeof DEFAULT_SETTINGS,
}));
mocks.settings = { ...DEFAULT_SETTINGS, theme: 'dark' };

vi.mock('@/lib/messaging/send-message', () => ({
  sendMessage: async () => ({
    hostPermissionGranted: true,
    cache: { entryCount: 2, byteSize: 512 },
  }),
}));

vi.mock('@/lib/rules/community-rules', () => ({
  communityRuleStore: {
    get: async () => ({ updatesEnabled: true }),
    setUpdatesEnabled: async () => undefined,
  },
}));

vi.mock('@/lib/rules/user-rules', () => ({
  userRuleStore: {
    export: async () => '{"schemaVersion":1,"rules":[]}',
    import: async () => ({ schemaVersion: 1, rules: [] }),
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

import OptionsApp from './OptionsApp';

describe('OptionsApp', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exposes management sections and applies the selected theme', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);

    await act(async () => {
      root.render(<OptionsApp />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(
      document.querySelector('nav[aria-label="Settings sections"]'),
    ).not.toBeNull();
    expect(document.getElementById('privacy-title')?.textContent).toBe(
      'Privacy and device data',
    );
    expect(document.body.textContent).toContain('Export redacted diagnostics');
    expect(document.body.textContent).toContain('Floating page control');

    await act(async () => root.unmount());
  });

  it.each([
    'light',
    'system',
  ] as const)('applies the %s theme without removing settings content', async (theme) => {
    mocks.settings = { ...DEFAULT_SETTINGS, theme };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);

    await act(async () => {
      root.render(<OptionsApp />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.querySelector('main.options')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('switches the complete settings interface language immediately', async () => {
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      uiLocale: 'auto',
      setupCompleted: true,
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);

    await act(async () => {
      root.render(<OptionsApp />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const localeSelect = document.querySelector<HTMLSelectElement>(
      '#language-heading + label select',
    );
    expect(localeSelect).not.toBeNull();
    await act(async () => {
      if (localeSelect) {
        localeSelect.value = 'zh-CN';
        localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('h1')?.textContent).toBe('设置');
    expect(document.body.textContent).toContain('隐私与设备数据');
    await act(async () => root.unmount());
  });
});
