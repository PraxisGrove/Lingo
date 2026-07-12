export type SiteTranslationPolicy = 'default' | 'always' | 'never';
export type SourceLanguagePolicyMode = 'all' | 'included' | 'excluded';

export type SourceLanguagePolicy = {
  mode: SourceLanguagePolicyMode;
  languages: string[];
};

export type AutoTranslationPreferences = {
  enabled: boolean;
  defaultAutoSitesEnabled: boolean;
  sourceLanguagePolicy: SourceLanguagePolicy;
};

export type PreferenceOverride = {
  translationPolicy?: SiteTranslationPolicy;
  sourceLanguagePolicy?: SourceLanguagePolicy;
};

export type PreferenceContext = {
  hostname: string;
  sourceLanguage?: string;
  global: AutoTranslationPreferences;
  site?: PreferenceOverride;
  page?: PreferenceOverride;
  isDefaultAutoSite?: boolean;
};

export type EffectivePreferences = {
  hostname: string;
  translationPolicy: SiteTranslationPolicy;
  source: 'page' | 'site' | 'global' | 'default-site';
  sourceLanguagePolicy: SourceLanguagePolicy;
  blockedBySourceLanguage: boolean;
  autoTranslate: boolean;
};

export const DEFAULT_AUTO_TRANSLATION_PREFERENCES: AutoTranslationPreferences =
  {
    enabled: true,
    defaultAutoSitesEnabled: true,
    sourceLanguagePolicy: { mode: 'all', languages: [] },
  };

export function resolvePreferences(
  context: PreferenceContext,
): EffectivePreferences {
  const pagePolicy = context.page?.translationPolicy;
  const sitePolicy = context.site?.translationPolicy;
  const translationPolicy =
    pagePolicy && pagePolicy !== 'default'
      ? pagePolicy
      : sitePolicy && sitePolicy !== 'default'
        ? sitePolicy
        : 'default';
  const source =
    pagePolicy && pagePolicy !== 'default'
      ? 'page'
      : sitePolicy && sitePolicy !== 'default'
        ? 'site'
        : context.isDefaultAutoSite && context.global.defaultAutoSitesEnabled
          ? 'default-site'
          : 'global';
  const sourceLanguagePolicy =
    context.page?.sourceLanguagePolicy ??
    context.site?.sourceLanguagePolicy ??
    context.global.sourceLanguagePolicy;
  const blockedBySourceLanguage = !allowsLanguage(
    sourceLanguagePolicy,
    context.sourceLanguage,
  );
  const autoTranslate =
    translationPolicy === 'never'
      ? false
      : !blockedBySourceLanguage &&
        (translationPolicy === 'always' ||
          (context.global.enabled &&
            context.global.defaultAutoSitesEnabled === true &&
            context.isDefaultAutoSite === true));

  return {
    hostname: context.hostname,
    translationPolicy,
    source,
    sourceLanguagePolicy,
    blockedBySourceLanguage,
    autoTranslate,
  };
}

function allowsLanguage(
  policy: SourceLanguagePolicy,
  sourceLanguage: string | undefined,
): boolean {
  if (!sourceLanguage || policy.mode === 'all') return true;
  const language = sourceLanguage.toLowerCase();
  const matches = policy.languages.some(
    (candidate) => candidate.toLowerCase() === language,
  );
  return policy.mode === 'included' ? matches : !matches;
}
