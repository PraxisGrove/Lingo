import { describe, expect, it } from 'vitest';
import { SUPPORTED_UI_LOCALES } from './locales';
import { resources } from './resources';

describe('interface language resources', () => {
  it('contains the same non-empty messages and interpolation variables in every locale', () => {
    const english = resources.en.translation;
    const englishKeys = Object.keys(english)
      .filter((key) => !key.startsWith('test.'))
      .sort();

    expect(Object.keys(resources)).toEqual(SUPPORTED_UI_LOCALES);
    for (const locale of SUPPORTED_UI_LOCALES) {
      const messages = resources[locale].translation;
      expect(
        Object.keys(messages)
          .filter((key) => !key.startsWith('test.'))
          .sort(),
        locale,
      ).toEqual(englishKeys);
      for (const key of englishKeys) {
        expect(
          messages[key as keyof typeof messages].trim(),
          `${locale}:${key}`,
        ).not.toBe('');
        expect(
          interpolations(messages[key as keyof typeof messages]),
          `${locale}:${key}`,
        ).toEqual(interpolations(english[key as keyof typeof english]));
      }
    }
  });
});

function interpolations(message: string): string[] {
  return [...message.matchAll(/{{\s*([^},\s]+).*?}}/g)]
    .map((match) => match[1])
    .sort();
}
