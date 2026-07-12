import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_TRANSLATION_PREFERENCES,
  resolvePreferences,
} from './preference-resolver';

describe('resolvePreferences', () => {
  it('lets a current-page choice override site, global, and default-site policy', () => {
    expect(
      resolvePreferences({
        hostname: 'docs.example.com',
        sourceLanguage: 'en',
        global: {
          ...DEFAULT_AUTO_TRANSLATION_PREFERENCES,
          enabled: false,
        },
        site: { translationPolicy: 'always' },
        page: { translationPolicy: 'never' },
        isDefaultAutoSite: true,
      }),
    ).toMatchObject({
      autoTranslate: false,
      translationPolicy: 'never',
      source: 'page',
    });
  });

  it('uses an enabled default auto site when no higher policy applies', () => {
    expect(
      resolvePreferences({
        hostname: 'news.example.com',
        sourceLanguage: 'en',
        global: DEFAULT_AUTO_TRANSLATION_PREFERENCES,
        isDefaultAutoSite: true,
      }),
    ).toMatchObject({
      autoTranslate: true,
      source: 'default-site',
    });
  });

  it('does not auto-translate a default site when its global default is disabled', () => {
    expect(
      resolvePreferences({
        hostname: 'news.example.com',
        sourceLanguage: 'en',
        global: {
          ...DEFAULT_AUTO_TRANSLATION_PREFERENCES,
          defaultAutoSitesEnabled: false,
        },
        isDefaultAutoSite: true,
      }),
    ).toMatchObject({ autoTranslate: false, source: 'global' });
  });

  it('does not auto-translate a source language excluded by the effective policy', () => {
    expect(
      resolvePreferences({
        hostname: 'example.com',
        sourceLanguage: 'zh-CN',
        global: {
          ...DEFAULT_AUTO_TRANSLATION_PREFERENCES,
          sourceLanguagePolicy: {
            mode: 'excluded',
            languages: ['zh-CN'],
          },
        },
        site: { translationPolicy: 'always' },
      }),
    ).toMatchObject({
      autoTranslate: false,
      blockedBySourceLanguage: true,
    });
  });
});
