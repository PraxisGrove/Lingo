import i18next, { type TOptions } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import type { UiLocalePreference } from './locales';
import { resolveUiLocale } from './locales';
import { type MessageKey, resources } from './resources';

export const interfaceI18n = i18next.createInstance();

void interfaceI18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  keySeparator: false,
  lng: 'en',
  resources,
  returnNull: false,
});

export async function changeInterfaceLanguage(
  preference: UiLocalePreference,
  browserLocale = getBrowserLocale(),
): Promise<void> {
  const locale =
    preference === 'auto' ? resolveUiLocale(browserLocale) : preference;
  await interfaceI18n.changeLanguage(locale);
}

function getBrowserLocale(): string {
  return typeof browser !== 'undefined' && browser.i18n?.getUILanguage
    ? browser.i18n.getUILanguage()
    : 'en';
}

export function translate(key: MessageKey, options?: TOptions): string {
  return interfaceI18n.t(key, options);
}

export function useInterfaceTranslation() {
  const { i18n } = useTranslation(undefined, { i18n: interfaceI18n });
  return {
    locale: resolveUiLocale(i18n.resolvedLanguage ?? i18n.language),
    t: translate,
  };
}
