// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeInterfaceLanguage } from '../../lib/i18n/i18n';
import { SUPPORTED_UI_LOCALES } from '../../lib/i18n/locales';
import { resources } from '../../lib/i18n/resources';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';

const mocks = vi.hoisted(() => ({
  settings: null as unknown as typeof DEFAULT_SETTINGS,
  sendMessage: vi.fn(),
}));
mocks.settings = { ...DEFAULT_SETTINGS, theme: 'dark' };

vi.mock('@/lib/messaging/send-message', () => ({
  sendMessage: mocks.sendMessage,
}));

vi.mock('@/lib/rules/rule-subscription', () => ({
  ruleSubscriptionItem: { getValue: async () => null },
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
    setSettings: async (patch: object) => {
      mocks.settings = { ...mocks.settings, ...patch };
      return mocks.settings;
    },
    watchSettings: () => () => undefined,
  };
});

vi.mock('@/lib/vocabulary/vocabulary-store', async () => {
  const model = await vi.importActual<
    typeof import('../../lib/vocabulary/vocabulary-model')
  >('../../lib/vocabulary/vocabulary-model');
  let vocabulary = model.DEFAULT_VOCABULARY;
  return {
    getVocabulary: async () => vocabulary,
    updateVocabulary: async (
      update: (current: typeof vocabulary) => Partial<typeof vocabulary>,
    ) => {
      vocabulary = model.resolveVocabulary({
        ...vocabulary,
        ...update(vocabulary),
      });
      return vocabulary;
    },
    watchVocabulary: () => () => undefined,
  };
});

vi.mock('@/lib/subtitles/subtitle-store', async () => {
  const model = await vi.importActual<
    typeof import('../../lib/subtitles/subtitle-model')
  >('../../lib/subtitles/subtitle-model');
  let preferences = model.DEFAULT_SUBTITLES;
  return {
    getSubtitlePreferences: async () => preferences,
    updateSubtitlePreferences: async (
      update: (current: typeof preferences) => Partial<typeof preferences>,
    ) => {
      preferences = model.resolveSubtitles({
        ...preferences,
        ...update(preferences),
      });
      return preferences;
    },
    watchSubtitlePreferences: () => () => undefined,
  };
});

// Provider connection and model-selection interactions are covered separately
// in ProviderSetup.test.tsx. This suite exercises the surrounding settings shell.
vi.mock('./ProviderSetup', async () => {
  const { useInterfaceTranslation } = await import('../../lib/i18n/i18n');
  return {
    default: function ProviderSetupMock() {
      const { t } = useInterfaceTranslation();
      return <h2 id="provider-heading">{t('modelSetup.title')}</h2>;
    },
  };
});

import OptionsApp from './OptionsApp';

let root: ReturnType<typeof createRoot> | null = null;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('OptionsApp', () => {
  beforeEach(async () => {
    window.history.replaceState(null, '', window.location.href.split('#')[0]);
    // Happy DOM schedules hashchange after replaceState; drain reset events
    // before the next OptionsApp installs its navigation listener.
    await new Promise((resolve) => setTimeout(resolve, 0));
    mocks.settings = { ...DEFAULT_SETTINGS, theme: 'dark', uiLocale: 'en' };
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue({
      hostPermissionGranted: true,
      cache: { entryCount: 2, byteSize: 512 },
    });
    await changeInterfaceLanguage('en', 'en');
  });

  afterEach(async () => {
    if (root) {
      const mountedRoot = root;
      await act(async () => mountedRoot.unmount());
      root = null;
    }
    window.history.replaceState(null, '', window.location.href.split('#')[0]);
    await changeInterfaceLanguage('en', 'en');
    document.body.innerHTML = '';
  });

  it.each([
    'dark',
    'light',
    'system',
  ] as const)('applies the %s theme without removing settings content', async (theme) => {
    mocks.settings = { ...mocks.settings, theme };
    await mountOptions();

    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.querySelector('main.options')).not.toBeNull();
    expect(
      document.querySelector('nav[aria-label="Settings sections"]'),
    ).not.toBeNull();
    expect(document.getElementById('privacy-title')?.textContent).toBe(
      'Privacy and device data',
    );
    expect(document.body.textContent).toContain('Export redacted diagnostics');
    expect(document.body.textContent).toContain('Floating page control');
  });

  it.each(
    SUPPORTED_UI_LOCALES,
  )('renders the settings surface in %s', async (locale) => {
    mocks.settings = {
      ...mocks.settings,
      uiLocale: locale,
      setupCompleted: true,
    };
    await changeInterfaceLanguage(locale, 'en');
    await mountOptions();

    expect(document.querySelector('h1')?.textContent).toBe(
      resources[locale].translation['options.title.settings'],
    );
    expect(document.documentElement.lang).toBe(locale);
    expect(
      document.querySelector('a[href="#provider-heading"]')?.textContent,
    ).toBe(resources[locale].translation['navigation.services']);
    expect(document.getElementById('provider-heading')?.textContent).toBe(
      resources[locale].translation['modelSetup.title'],
    );
  });

  it('switches the complete interface language from reading preferences', async () => {
    mocks.settings = {
      ...mocks.settings,
      uiLocale: 'auto',
      setupCompleted: true,
    };
    await mountOptions();
    await navigateTo('#language-heading');

    const localeSelect = document.querySelector<HTMLSelectElement>(
      '[aria-labelledby="language-heading"] .row select',
    );
    expect(localeSelect).not.toBeNull();
    await act(async () => {
      if (localeSelect) {
        localeSelect.value = 'zh-CN';
        localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(document.querySelector('h1')?.textContent).toBe('设置');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(
      document.querySelector('a[href="#language-heading"]')?.textContent,
    ).toBe('阅读偏好');
    expect(
      document.querySelector('a[href="#provider-heading"]')?.textContent,
    ).toBe('翻译服务');
    expect(document.querySelector('.advanced-nav button')?.textContent).toBe(
      '高级设置',
    );
    expect(document.querySelector('.autosave-note')?.textContent).toBe(
      resources['zh-CN'].translation['navigation.preferencesSaved'],
    );
    expect(document.body.textContent).toContain('隐私与本机数据');
    expect(document.getElementById('provider-heading')?.textContent).toBe(
      resources['zh-CN'].translation['modelSetup.title'],
    );
    expect(mocks.settings.uiLocale).toBe('zh-CN');
  });

  it('keeps only common tasks in the main navigation and separates Advanced', async () => {
    mocks.settings = { ...mocks.settings, setupCompleted: true };
    await mountOptions();

    const nav = document.querySelector('nav[aria-label="Settings sections"]');
    expect(
      [...(nav?.querySelectorAll(':scope > a') ?? [])].map(
        (link) => link.textContent,
      ),
    ).toEqual(['Translation services', 'Reading preferences']);
    expect(nav?.querySelector('.advanced-nav button')?.textContent).toBe(
      'Advanced',
    );
    expect(nav?.querySelectorAll('a')).toHaveLength(2);
    for (const href of [
      '#quality-heading',
      '#site-rules-heading',
      '#privacy-heading',
      '#automation-heading',
      '#general-heading',
    ]) {
      expect(nav?.querySelector(`a[href="${href}"]`), href).toBeNull();
    }
    for (const disclosure of document.querySelectorAll<HTMLDetailsElement>(
      '.advanced-disclosure',
    )) {
      expect(disclosure.hidden).toBe(true);
      expect(disclosure.open).toBe(false);
    }
  });

  it('reveals compatibility tools only through nested Advanced disclosures', async () => {
    mocks.settings = { ...mocks.settings, setupCompleted: true };
    await mountOptions();
    await navigateTo('#advanced-heading');

    const disclosures = [
      ...document.querySelectorAll<HTMLDetailsElement>('.advanced-disclosure'),
    ];
    expect(
      disclosures.map((item) => item.querySelector('summary')?.textContent),
    ).toEqual([
      'Website compatibility',
      'Translation style and terminology',
      'Privacy and device data',
    ]);
    for (const disclosure of disclosures) {
      expect(disclosure.hidden).toBe(false);
      expect(disclosure.open).toBe(false);
    }
    expect(document.getElementById('advanced-heading')?.textContent).toBe(
      'Advanced',
    );
    expect(sectionLabelled('language-heading').hidden).toBe(true);
    expect(sectionLabelled('provider-heading').hidden).toBe(true);

    const compatibility = disclosures[0];
    await click(compatibility.querySelector('summary'));
    expect(compatibility.open).toBe(true);
    expect(compatibility.textContent).toContain(
      resources.en.translation['navigation.rulesHelp'],
    );

    const community = disclosureWithSummary('Community adaptations');
    const editor = disclosureWithSummary('Edit adaptation JSON');
    expect(community.open).toBe(false);
    expect(editor.open).toBe(false);
    const ruleInput = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="User site rules JSON"]',
    );
    expect(ruleInput?.closest('details')).toBe(editor);
    expect(
      community.querySelector('input[type="url"]')?.closest('details'),
    ).toBe(community);
    expect(
      community.querySelector('input:not([type])')?.closest('details'),
    ).toBe(community);

    await click(editor.querySelector('summary'));
    expect(editor.open).toBe(true);
    expect(ruleInput?.value).toBe('{"schemaVersion":1,"rules":[]}');
    expect(community.open).toBe(false);

    await click(community.querySelector('summary'));
    expect(community.open).toBe(true);
    expect(community.textContent).toContain('Community rules URL');
    expect(community.textContent).toContain('Ed25519 public key (base64)');
    expect(disclosures[1].open).toBe(false);
    expect(disclosures[2].open).toBe(false);
  });

  it('starts first-time readers with languages and then leads to services', async () => {
    await mountOptions();

    expect(sectionLabelled('language-heading').hidden).toBe(false);
    expect(sectionLabelled('automation-heading').hidden).toBe(true);
    expect(sectionLabelled('text-tools-heading').hidden).toBe(true);
    expect(sectionLabelled('provider-heading').hidden).toBe(true);
    expect(document.querySelector('.welcome-panel')).not.toBeNull();
    expect(
      document
        .querySelector('a[href="#language-heading"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');

    const next = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Next: connect a service'),
    );
    await click(next);

    expect(window.location.hash).toBe('#provider-heading');
    expect(sectionLabelled('provider-heading').hidden).toBe(false);
    expect(sectionLabelled('language-heading').hidden).toBe(true);
    expect(document.querySelector('.welcome-panel')).toBeNull();
    expect(
      document
        .querySelector('a[href="#provider-heading"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');

    await navigateTo('#language-heading');
    expect(sectionLabelled('language-heading').hidden).toBe(false);
    expect(sectionLabelled('provider-heading').hidden).toBe(true);
    await click(document.querySelector('.skip-button'));
    expect(sectionLabelled('automation-heading').hidden).toBe(false);
    expect(sectionLabelled('text-tools-heading').hidden).toBe(false);
  });

  it('respects a direct service setup link during onboarding', async () => {
    window.history.replaceState(null, '', '#provider-heading');
    await mountOptions();

    expect(sectionLabelled('provider-heading').hidden).toBe(false);
    expect(sectionLabelled('language-heading').hidden).toBe(true);
    expect(document.querySelector('.welcome-panel')).toBeNull();
  });

  it('opens services first for returning users', async () => {
    mocks.settings = { ...mocks.settings, setupCompleted: true };
    expect(window.location.hash).toBe('');
    await mountOptions();

    expect(sectionLabelled('provider-heading').hidden).toBe(false);
    expect(sectionLabelled('language-heading').hidden).toBe(true);
    expect(document.querySelector('.setup-progress')).toBeNull();
    expect(
      document
        .querySelector('a[href="#provider-heading"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
  });
});

async function mountOptions() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  const mountedRoot = root;
  await act(async () => mountedRoot.render(<OptionsApp />));
}

function sectionLabelled(id: string): HTMLElement {
  const section = document.querySelector<HTMLElement>(
    `section[aria-labelledby="${id}"]`,
  );
  expect(section, `section: ${id}`).not.toBeNull();
  return section as HTMLElement;
}

function disclosureWithSummary(text: string): HTMLDetailsElement {
  const disclosure = [
    ...document.querySelectorAll<HTMLDetailsElement>('details'),
  ].find((item) => item.querySelector('summary')?.textContent === text);
  expect(disclosure, `disclosure: ${text}`).toBeDefined();
  return disclosure as HTMLDetailsElement;
}

async function navigateTo(href: string) {
  await click(
    document.querySelector(
      href === '#advanced-heading'
        ? '.advanced-nav button'
        : `.section-nav a[href="${href}"]`,
    ),
  );
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
}
