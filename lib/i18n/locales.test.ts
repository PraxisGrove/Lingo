import { describe, expect, it } from 'vitest';
import {
  resolveUiLocale,
  SUPPORTED_UI_LOCALES,
  toBrowserLocaleDirectory,
} from './locales';

describe('interface locale resolution', () => {
  it.each([
    ['zh', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-HK', 'zh-TW'],
    ['pt-PT', 'pt-BR'],
    ['es-MX', 'es'],
    ['de-AT', 'de'],
    ['ar', 'en'],
  ] as const)('resolves %s to %s', (requested, expected) => {
    expect(resolveUiLocale(requested)).toBe(expected);
  });

  it('publishes exactly the agreed launch locales', () => {
    expect(SUPPORTED_UI_LOCALES).toEqual([
      'en',
      'zh-CN',
      'zh-TW',
      'ja',
      'ko',
      'es',
      'fr',
      'de',
      'pt-BR',
    ]);
  });

  it.each([
    ['zh-CN', 'zh_CN'],
    ['zh-TW', 'zh_TW'],
    ['pt-BR', 'pt_BR'],
    ['de', 'de'],
  ] as const)('maps %s to the browser locale directory %s', (locale, expected) => {
    expect(toBrowserLocaleDirectory(locale)).toBe(expected);
  });
});
