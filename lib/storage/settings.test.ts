import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings } from './settings-model';

describe('resolveSettings', () => {
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
