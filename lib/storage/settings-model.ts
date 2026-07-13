import type {
  AutoTranslationPreferences,
  SourceLanguagePolicy,
} from '@/lib/preferences/preference-resolver';
import {
  DEFAULT_TRANSLATION_QUALITY,
  resolveTranslationQuality,
  type TranslationQualitySettings,
} from '../translation/quality';

export type ExtensionTheme = 'system' | 'light' | 'dark';

export const CURRENT_SETTINGS_SCHEMA_VERSION = 5 as const;

export type ProviderKind =
  | 'openai-compatible'
  | 'deepl'
  | 'google-cloud'
  | 'azure-translator';

export type ProviderProfile = {
  id: string;
  name: string;
  provider: ProviderKind;
  endpoint?: string;
  model?: string;
  region?: string;
  nativeGlossaryId?: string;
};

export type ExtensionSettings = {
  schemaVersion: typeof CURRENT_SETTINGS_SCHEMA_VERSION;
  enabled: boolean;
  theme: ExtensionTheme;
  sourceLanguage: string;
  targetLanguage: string;
  providerProfiles: ProviderProfile[];
  activeProviderProfileId: string | null;
  fallbackProviderProfileIds: string[];
  translationCacheEnabled: boolean;
  translationQuality: TranslationQualitySettings;
  autoTranslation: AutoTranslationPreferences;
  setupCompleted: boolean;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
  enabled: true,
  theme: 'system',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  providerProfiles: [],
  activeProviderProfileId: null,
  fallbackProviderProfileIds: [],
  translationCacheEnabled: true,
  translationQuality: DEFAULT_TRANSLATION_QUALITY,
  autoTranslation: {
    enabled: true,
    defaultAutoSitesEnabled: true,
    sourceLanguagePolicy: { mode: 'all', languages: [] },
  },
  setupCompleted: false,
};

const THEMES: ExtensionTheme[] = ['system', 'light', 'dark'];

export function resolveSettings(value?: unknown): ExtensionSettings {
  if (value == null || typeof value !== 'object') {
    return DEFAULT_SETTINGS;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== undefined &&
    candidate.schemaVersion !== 1 &&
    candidate.schemaVersion !== 2 &&
    candidate.schemaVersion !== 3 &&
    candidate.schemaVersion !== 4 &&
    candidate.schemaVersion !== CURRENT_SETTINGS_SCHEMA_VERSION
  ) {
    return DEFAULT_SETTINGS;
  }

  const providerProfiles = Array.isArray(candidate.providerProfiles)
    ? candidate.providerProfiles.flatMap(resolveProviderProfile)
    : [];
  const requestedActiveId =
    typeof candidate.activeProviderProfileId === 'string'
      ? candidate.activeProviderProfileId
      : null;

  return {
    schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : DEFAULT_SETTINGS.enabled,
    theme:
      typeof candidate.theme === 'string' &&
      THEMES.includes(candidate.theme as ExtensionTheme)
        ? (candidate.theme as ExtensionTheme)
        : DEFAULT_SETTINGS.theme,
    sourceLanguage: validLanguage(candidate.sourceLanguage, 'auto'),
    targetLanguage: validLanguage(candidate.targetLanguage, 'zh-CN'),
    providerProfiles,
    activeProviderProfileId: providerProfiles.some(
      (profile) => profile.id === requestedActiveId,
    )
      ? requestedActiveId
      : null,
    fallbackProviderProfileIds: Array.isArray(
      candidate.fallbackProviderProfileIds,
    )
      ? candidate.fallbackProviderProfileIds.filter(
          (id): id is string =>
            typeof id === 'string' &&
            id !== requestedActiveId &&
            providerProfiles.some((profile) => profile.id === id),
        )
      : [],
    translationCacheEnabled:
      typeof candidate.translationCacheEnabled === 'boolean'
        ? candidate.translationCacheEnabled
        : DEFAULT_SETTINGS.translationCacheEnabled,
    translationQuality: resolveQualitySettings(candidate.translationQuality),
    autoTranslation: resolveAutoTranslation(candidate.autoTranslation),
    setupCompleted: candidate.setupCompleted === true,
  };
}

function resolveQualitySettings(value: unknown): TranslationQualitySettings {
  const { version: _version, ...quality } = resolveTranslationQuality(value);
  return quality;
}

function resolveAutoTranslation(value: unknown): AutoTranslationPreferences {
  if (value == null || typeof value !== 'object') {
    return DEFAULT_SETTINGS.autoTranslation;
  }
  const candidate = value as Record<string, unknown>;
  return {
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : DEFAULT_SETTINGS.autoTranslation.enabled,
    defaultAutoSitesEnabled:
      typeof candidate.defaultAutoSitesEnabled === 'boolean'
        ? candidate.defaultAutoSitesEnabled
        : DEFAULT_SETTINGS.autoTranslation.defaultAutoSitesEnabled,
    sourceLanguagePolicy: resolveSourceLanguagePolicy(
      candidate.sourceLanguagePolicy,
    ),
  };
}

function resolveSourceLanguagePolicy(value: unknown): SourceLanguagePolicy {
  if (value == null || typeof value !== 'object') {
    return DEFAULT_SETTINGS.autoTranslation.sourceLanguagePolicy;
  }
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.mode !== 'all' &&
      candidate.mode !== 'included' &&
      candidate.mode !== 'excluded') ||
    !Array.isArray(candidate.languages) ||
    candidate.languages.some((language) => !validLanguage(language, ''))
  ) {
    return DEFAULT_SETTINGS.autoTranslation.sourceLanguagePolicy;
  }
  return { mode: candidate.mode, languages: candidate.languages };
}

const PROVIDER_KINDS: ProviderKind[] = [
  'openai-compatible',
  'deepl',
  'google-cloud',
  'azure-translator',
];

function resolveProviderProfile(value: unknown): ProviderProfile[] {
  if (value == null || typeof value !== 'object') return [];
  const profile = value as Record<string, unknown>;
  if (
    typeof profile.id !== 'string' ||
    profile.id.length === 0 ||
    typeof profile.name !== 'string' ||
    profile.name.length === 0 ||
    !PROVIDER_KINDS.includes(profile.provider as ProviderKind)
  ) {
    return [];
  }

  return [
    {
      id: profile.id,
      name: profile.name,
      provider: profile.provider as ProviderKind,
      ...optionalString(profile, 'endpoint'),
      ...optionalString(profile, 'model'),
      ...optionalString(profile, 'region'),
      ...optionalString(profile, 'nativeGlossaryId'),
    },
  ];
}

function optionalString(
  value: Record<string, unknown>,
  key: 'endpoint' | 'model' | 'region' | 'nativeGlossaryId',
): Partial<ProviderProfile> {
  return typeof value[key] === 'string' && value[key].length > 0
    ? { [key]: value[key] }
    : {};
}

function validLanguage(value: unknown, fallback: string): string {
  return typeof value === 'string' &&
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
    ? value
    : fallback;
}
