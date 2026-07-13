// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { changeInterfaceLanguage, translate } from './i18n';

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

  it('does not change the host document language from a content script', async () => {
    document.documentElement.lang = 'ar';

    await changeInterfaceLanguage('de', 'de');

    expect(document.documentElement.lang).toBe('ar');
  });
});
