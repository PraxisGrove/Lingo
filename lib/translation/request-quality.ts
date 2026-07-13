import type { ExtensionSettings } from '../storage/settings-model';
import { resolveTranslationQuality } from './quality';

export function resolveRequestQuality(
  settings: ExtensionSettings,
  siteHostname?: string,
) {
  const siteGlossary = siteHostname
    ? (settings.siteGlossaries[siteHostname] ?? [])
    : [];
  return resolveTranslationQuality({
    ...settings.translationQuality,
    glossary: [...siteGlossary, ...settings.translationQuality.glossary],
  });
}
