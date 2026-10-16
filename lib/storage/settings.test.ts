import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  initialSettingsForInstall,
  resolveSettings,
  targetLanguageForBrowser,
} from './settings-model';

describe('resolveSettings', () => {
  it('migrates schema 12 without losing protocols, models, icons or reading preferences', () => {
    const previous = {
      ...DEFAULT_SETTINGS,
      schemaVersion: 12,
      uiLocale: 'zh-CN',
      targetLanguage: 'ja',
      setupCompleted: true,
      translationCacheEnabled: false,
      floatingButtonEnabled: true,
      activeProviderProfileId: 'local',
      providerProfiles: [
        {
          id: 'local',
          name: 'Magpie',
          provider: 'openai-responses',
          endpoint: 'http://127.0.0.1:3425/v1',
          model: 'group/reading',
          models: [{ id: 'group/reading', name: 'Reading' }],
          modelSelection: 'manual',
          icon: { type: 'provider', providerId: 'deepseek' },
        },
      ],
    };
    expect(
      resolveSettings({ ...previous, translationAppearance: undefined }),
    ).toEqual({
      ...previous,
      schemaVersion: 13,
    });
  });

  it('returns defaults for empty values', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid settings', () => {
    expect(
      resolveSettings({ schemaVersion: 2, enabled: false, theme: 'dark' }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
      theme: 'dark',
    });
  });

  it('migrates settings saved before schema versioning', () => {
    expect(resolveSettings({ enabled: false, theme: 'light' })).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
      theme: 'light',
    });
  });

  it('keeps the floating button opt-in and defaults it off', () => {
    expect(resolveSettings({ floatingButtonEnabled: true })).toMatchObject({
      floatingButtonEnabled: true,
    });
    expect(resolveSettings({})).toMatchObject({
      floatingButtonEnabled: false,
    });
  });

  it('keeps valid language and provider profile settings', () => {
    expect(
      resolveSettings({
        schemaVersion: 2,
        enabled: true,
        theme: 'system',
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        activeProviderProfileId: 'work',
        setupCompleted: true,
        providerProfiles: [
          {
            id: 'work',
            name: 'Work Azure',
            provider: 'azure-translator',
            endpoint: 'https://api.cognitive.microsofttranslator.com',
            region: 'eastus',
          },
        ],
      }),
    ).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      activeProviderProfileId: 'work',
      setupCompleted: true,
      providerProfiles: [{ id: 'work', provider: 'azure-translator' }],
    });
  });

  it('migrates existing settings to automatic interface language without changing the translation target', () => {
    expect(
      resolveSettings({ schemaVersion: 7, targetLanguage: 'ja' }),
    ).toMatchObject({ uiLocale: 'auto', targetLanguage: 'ja' });
  });

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ])('migrates schema %s without changing the translation target', (schemaVersion) => {
    expect(
      resolveSettings({ schemaVersion, targetLanguage: 'ja' }),
    ).toMatchObject({
      schemaVersion: 13,
      targetLanguage: 'ja',
      uiLocale: 'auto',
    });
  });

  it('keeps supported interface language preferences and rejects unknown ones', () => {
    expect(resolveSettings({ uiLocale: 'pt-BR' })).toMatchObject({
      uiLocale: 'pt-BR',
    });
    expect(resolveSettings({ uiLocale: 'it' })).toMatchObject({
      uiLocale: 'auto',
    });
  });

  it('migrates schema 9 profiles without changing the concrete selected model', () => {
    const profile = {
      id: 'saved',
      name: 'Personal',
      provider: 'openai-compatible',
      model: 'personal-model',
    };
    expect(
      resolveSettings({
        schemaVersion: 9,
        providerProfiles: [profile],
        activeProviderProfileId: profile.id,
        fallbackProviderProfileIds: [],
      }),
    ).toMatchObject({
      schemaVersion: 13,
      providerProfiles: [profile],
      activeProviderProfileId: profile.id,
    });
  });

  it('keeps native providers, model selections and sanitized catalog snapshots', () => {
    expect(
      resolveSettings({
        providerProfiles: [
          {
            id: 'native',
            name: 'Claude',
            provider: 'anthropic',
            model: 'claude-chosen',
            modelSelection: 'manual',
            models: [
              { id: 'claude-chosen', name: 'Claude chosen' },
              { id: 'claude-chosen', name: 'Duplicate' },
              { id: '', name: 'Invalid' },
              { id: 'claude-alt', name: 'Alt\u0000 name' },
            ],
          },
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            modelSelection: 'invented',
            models: 'invalid',
          },
        ],
      }),
    ).toMatchObject({
      providerProfiles: [
        {
          id: 'native',
          provider: 'anthropic',
          model: 'claude-chosen',
          modelSelection: 'manual',
          models: [
            { id: 'claude-chosen', name: 'Claude chosen' },
            { id: 'claude-alt', name: 'Alt name' },
          ],
        },
        { id: 'gemini', provider: 'gemini' },
      ],
    });
    const invalid = resolveSettings({
      providerProfiles: [
        {
          id: 'x',
          name: 'X',
          provider: 'gemini',
          modelSelection: 'invented',
          models: 'invalid',
        },
      ],
    }).providerProfiles[0];
    expect(invalid).not.toHaveProperty('modelSelection');
    expect(invalid).not.toHaveProperty('models');
  });

  it('migrates schema 10 profiles without changing models or automatic icon selection', () => {
    const profile = {
      id: 'saved',
      name: 'Reading',
      provider: 'gemini',
      model: 'gemini-chosen',
      models: [{ id: 'gemini-chosen', name: 'Chosen model' }],
      modelSelection: 'manual',
    };
    const migrated = resolveSettings({
      schemaVersion: 10,
      providerProfiles: [profile],
      activeProviderProfileId: profile.id,
    });
    expect(migrated.schemaVersion).toBe(13);
    expect(migrated.providerProfiles).toEqual([profile]);
    expect(migrated.providerProfiles[0]).not.toHaveProperty('icon');
  });

  it('migrates schema 11 without changing the existing Chat Completions protocol', () => {
    const profile = {
      id: 'deepseek',
      name: 'DeepSeek',
      provider: 'openai-compatible',
      endpoint: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
      modelSelection: 'manual',
      icon: { type: 'provider', providerId: 'deepseek' },
    };
    const migrated = resolveSettings({
      schemaVersion: 11,
      providerProfiles: [profile],
      activeProviderProfileId: profile.id,
      uiLocale: 'zh-CN',
      setupCompleted: true,
    });
    expect(migrated).toMatchObject({
      schemaVersion: 13,
      uiLocale: 'zh-CN',
      setupCompleted: true,
      activeProviderProfileId: profile.id,
      providerProfiles: [profile],
    });
  });

  it('preserves a Responses profile, full model IDs, its catalog and service appearance', () => {
    const profile = {
      id: 'gateway',
      name: 'Local gateway',
      provider: 'openai-responses',
      endpoint: 'http://127.0.0.1:3425/v1',
      model: 'group/auto-gpt-5-6-luna',
      models: [
        { id: 'group/auto-gpt-5-6-luna', name: 'Luna' },
        { id: 'codex/gpt-5.4', name: 'GPT 5.4' },
      ],
      modelSelection: 'manual',
      icon: { type: 'provider', providerId: 'openai' },
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      providerProfiles: [profile],
      activeProviderProfileId: profile.id,
    };
    expect(resolveSettings(settings)).toEqual(settings);
  });

  it('keeps custom raster/provider icons and restores automatic icons when preferences are removed', () => {
    const profile = {
      id: 'saved',
      name: 'Custom',
      provider: 'openai-compatible',
      model: 'chosen',
    };
    const image = {
      type: 'image',
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=',
    };
    expect(
      resolveSettings({ providerProfiles: [{ ...profile, icon: image }] })
        .providerProfiles[0].icon,
    ).toEqual(image);
    expect(
      resolveSettings({
        providerProfiles: [
          { ...profile, icon: { type: 'provider', providerId: 'qwen' } },
        ],
      }).providerProfiles[0].icon,
    ).toEqual({ type: 'provider', providerId: 'qwen' });
    expect(
      resolveSettings({ providerProfiles: [{ ...profile, icon: undefined }] })
        .providerProfiles[0],
    ).toEqual(profile);
  });

  it('drops unsafe stored icons while keeping the profile and its selected model', () => {
    const profile = {
      id: 'saved',
      name: 'Custom',
      provider: 'openai-compatible',
      model: 'chosen',
    };
    for (const icon of [
      { type: 'image', dataUrl: 'https://example.com/icon.png' },
      { type: 'image', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      { type: 'provider', providerId: 'unknown' },
    ]) {
      expect(
        resolveSettings({
          providerProfiles: [{ ...profile, icon }],
          activeProviderProfileId: profile.id,
        }),
      ).toMatchObject({
        providerProfiles: [profile],
        activeProviderProfileId: profile.id,
      });
      expect(
        resolveSettings({ providerProfiles: [{ ...profile, icon }] })
          .providerProfiles[0],
      ).not.toHaveProperty('icon');
    }
  });

  it.each([
    ['es-MX', 'es'],
    ['zh_Hant', 'zh-TW'],
    ['invalid locale', 'en'],
  ])('initializes a new translation target from %s as %s', (locale, target) => {
    expect(targetLanguageForBrowser(locale)).toBe(target);
  });

  it('initializes targets only for new installations', () => {
    expect(initialSettingsForInstall('install', 'pt-PT')).toEqual({
      targetLanguage: 'pt-BR',
    });
    expect(initialSettingsForInstall('update', 'pt-PT')).toBeUndefined();
  });

  it('keeps an ordered fallback chain without the active provider', () => {
    expect(
      resolveSettings({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'primary',
        fallbackProviderProfileIds: ['primary', 'fallback', 'missing'],
        providerProfiles: [
          { id: 'primary', name: 'Primary', provider: 'deepl' },
          { id: 'fallback', name: 'Fallback', provider: 'google-cloud' },
        ],
      }),
    ).toMatchObject({ fallbackProviderProfileIds: ['fallback'] });
  });

  it('migrates valid automatic translation preferences and drops invalid language policies', () => {
    expect(
      resolveSettings({
        autoTranslation: {
          enabled: false,
          defaultAutoSitesEnabled: false,
          sourceLanguagePolicy: {
            mode: 'excluded',
            languages: ['en', 'zh-CN'],
          },
        },
      }),
    ).toMatchObject({
      autoTranslation: {
        enabled: false,
        defaultAutoSitesEnabled: false,
        sourceLanguagePolicy: { mode: 'excluded', languages: ['en', 'zh-CN'] },
      },
    });
    expect(
      resolveSettings({
        autoTranslation: {
          sourceLanguagePolicy: {
            mode: 'unknown',
            languages: ['not a language'],
          },
        },
      }),
    ).toMatchObject({
      autoTranslation: DEFAULT_SETTINGS.autoTranslation,
    });
  });

  it('normalizes saved translation quality settings', () => {
    expect(
      resolveSettings({
        schemaVersion: 4,
        translationQuality: {
          template: 'concise',
          instruction: '  For product managers. ',
          glossary: [
            { source: 'Lingo', target: '灵译' },
            { source: '', target: 'ignored' },
          ],
        },
      }),
    ).toMatchObject({
      translationQuality: {
        template: 'concise',
        instruction: 'For product managers.',
        glossary: [{ source: 'Lingo', target: '灵译' }],
      },
    });
  });

  it('normalizes site-scoped glossaries by hostname', () => {
    expect(
      resolveSettings({
        siteGlossaries: {
          'Docs.Example.com': [{ source: 'API', target: '接口' }],
          'not a hostname': [{ source: 'Ignored', target: '忽略' }],
        },
      }),
    ).toMatchObject({
      siteGlossaries: {
        'docs.example.com': [{ source: 'API', target: '接口' }],
      },
    });
  });

  it('drops invalid profiles and an unknown active profile', () => {
    expect(
      resolveSettings({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'missing',
        providerProfiles: [{ id: '', name: '', provider: 'unknown' }],
      }),
    ).toMatchObject({ providerProfiles: [], activeProviderProfileId: null });
  });

  it('falls back safely for an unknown future schema', () => {
    expect(
      resolveSettings({
        schemaVersion: 99,
        enabled: false,
        theme: 'dark',
      } as never),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back when values are invalid', () => {
    expect(resolveSettings({ enabled: 'yes', theme: 'blue' } as never)).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});

describe('provider tuning settings', () => {
  it('clamps tuning values and drops invalid entries', () => {
    const settings = resolveSettings({
      schemaVersion: 13,
      providerProfiles: [
        {
          id: 'p',
          name: 'P',
          provider: 'deepl',
          tuning: {
            concurrency: 99,
            requestsPerMinute: 0,
            timeoutSeconds: 'slow',
            unknown: 3,
          },
        },
        { id: 'q', name: 'Q', provider: 'deepl', tuning: { concurrency: 'x' } },
      ],
    });
    expect(settings.providerProfiles[0].tuning).toEqual({
      concurrency: 16,
      requestsPerMinute: 1,
    });
    expect(settings.providerProfiles[1]).not.toHaveProperty('tuning');
  });
});
