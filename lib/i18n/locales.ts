export const SUPPORTED_UI_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'es',
  'fr',
  'de',
  'pt-BR',
] as const;

export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number];
export type UiLocalePreference = 'auto' | SupportedUiLocale;

export function resolveUiLocale(requested: string): SupportedUiLocale {
  const normalized = requested.replace('_', '-');
  const lower = normalized.toLowerCase();
  if (lower === 'zh-hant' || /^(zh-(tw|hk|mo))\b/.test(lower)) return 'zh-TW';
  if (lower === 'zh' || /^(zh-(hans|cn|sg))\b/.test(lower)) return 'zh-CN';
  if (lower === 'pt' || lower.startsWith('pt-')) return 'pt-BR';
  const base = lower.split('-')[0];
  if (
    base === 'en' ||
    base === 'ja' ||
    base === 'ko' ||
    base === 'es' ||
    base === 'fr' ||
    base === 'de'
  ) {
    return base;
  }
  return 'en';
}

export function toBrowserLocaleDirectory(locale: SupportedUiLocale): string {
  return locale.replace('-', '_');
}
