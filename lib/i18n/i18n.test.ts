// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changeInterfaceLanguage,
  getBrowserInterfaceLocale,
  translate,
} from './i18n';

describe('interface translation', () => {
  beforeEach(async () => {
    await changeInterfaceLanguage('auto', 'en-US');
  });

  it('uses the resolved browser language in automatic mode', async () => {
    await changeInterfaceLanguage('auto', 'zh-HK');

    expect(translate('language.auto', { language: '繁體中文' })).toBe(
      '跟隨瀏覽器（目前：繁體中文）',
    );
  });

  it('lets a manual preference override the browser language', async () => {
    await changeInterfaceLanguage('de', 'zh-CN');

    expect(translate('language.auto', { language: 'Deutsch' })).toBe(
      'Browsersprache verwenden (aktuell: Deutsch)',
    );
  });

  it('falls back to English for a missing localized message', async () => {
    await changeInterfaceLanguage('fr', 'fr');

    expect(translate('test.englishFallback')).toBe('English fallback');
  });

  it('formats singular and plural interface messages', async () => {
    await changeInterfaceLanguage('en', 'en');

    expect(translate('popup.action.retryFailed', { count: 1 })).toBe(
      'Retry 1 failed paragraph',
    );
    expect(translate('popup.action.retryFailed', { count: 2 })).toBe(
      'Retry 2 failed paragraphs',
    );
  });

  it('does not change the host document language from a content script', async () => {
    document.documentElement.lang = 'ar';

    await changeInterfaceLanguage('de', 'de');

    expect(document.documentElement.lang).toBe('ar');
  });

  it('reports the browser locale independently from a manual selection', async () => {
    vi.stubGlobal('browser', {
      i18n: { getUILanguage: () => 'zh-Hant-HK' },
    });
    await changeInterfaceLanguage('de', 'de');

    expect(getBrowserInterfaceLocale()).toBe('zh-TW');
    vi.unstubAllGlobals();
  });
});
