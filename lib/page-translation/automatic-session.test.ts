import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import { createAutomaticTranslationStarter } from './automatic-session';
import type { PageTranslation, StartSessionOptions } from './page-translation';

const emptyRules = { schemaVersion: 1 as const, rules: [] };

describe('automatic translation starter', () => {
  it('starts for a matching built-in default site with a configured provider', async () => {
    const starts: StartSessionOptions[] = [];
    const start = createAutomaticTranslationStarter({
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'configured',
      }),
      getUserRules: async () => emptyRules,
      getCommunityRules: async () => ({ updatesEnabled: true }),
    });

    await start(
      pageTranslation(starts),
      documentFor('developer.mozilla.org', 'en'),
    );

    expect(starts).toEqual([
      {
        targetLanguage: 'zh-CN',
        displayMode: 'bilingual',
        translateImmediately: false,
      },
    ]);
  });

  it('does not start when automatic translation is disabled', async () => {
    const starts: StartSessionOptions[] = [];
    const start = createAutomaticTranslationStarter({
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'configured',
        autoTranslation: {
          ...DEFAULT_SETTINGS.autoTranslation,
          enabled: false,
        },
      }),
      getUserRules: async () => emptyRules,
      getCommunityRules: async () => ({ updatesEnabled: true }),
    });

    await start(
      pageTranslation(starts),
      documentFor('developer.mozilla.org', 'en'),
    );

    expect(starts).toEqual([]);
  });

  it('uses a user never rule over a matching built-in default site rule', async () => {
    const starts: StartSessionOptions[] = [];
    const start = createAutomaticTranslationStarter({
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'configured',
      }),
      getUserRules: async () => ({
        schemaVersion: 1,
        rules: [
          {
            id: 'disable-mdn',
            domain: 'developer.mozilla.org',
            translationPolicy: 'never',
          },
        ],
      }),
      getCommunityRules: async () => ({ updatesEnabled: true }),
    });

    await start(
      pageTranslation(starts),
      documentFor('developer.mozilla.org', 'en'),
    );

    expect(starts).toEqual([]);
  });

  it('does not start when the effective source language policy excludes the document language', async () => {
    const starts: StartSessionOptions[] = [];
    const start = createAutomaticTranslationStarter({
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'configured',
        autoTranslation: {
          ...DEFAULT_SETTINGS.autoTranslation,
          sourceLanguagePolicy: { mode: 'excluded', languages: ['en'] },
        },
      }),
      getUserRules: async () => emptyRules,
      getCommunityRules: async () => ({ updatesEnabled: true }),
    });

    await start(
      pageTranslation(starts),
      documentFor('developer.mozilla.org', 'en'),
    );

    expect(starts).toEqual([]);
  });
});

function pageTranslation(starts: StartSessionOptions[]): PageTranslation {
  return {
    start: async (options) => {
      starts.push(options);
      return {
        status: 'translated',
        displayMode: options.displayMode,
        translatedUnitCount: 0,
        failedUnitCount: 0,
        totalUnitCount: 0,
        pageRevision: 0,
      };
    },
    update: async () => ({
      status: 'idle',
      displayMode: 'bilingual',
      translatedUnitCount: 0,
      failedUnitCount: 0,
      totalUnitCount: 0,
      pageRevision: 0,
    }),
    stop: async () => undefined,
    subscribe: () => () => undefined,
    snapshot: () => ({
      status: 'idle',
      displayMode: 'bilingual',
      translatedUnitCount: 0,
      failedUnitCount: 0,
      totalUnitCount: 0,
      pageRevision: 0,
    }),
  };
}

function documentFor(hostname: string, lang: string) {
  return { location: { hostname }, documentElement: { lang } } as Document;
}
