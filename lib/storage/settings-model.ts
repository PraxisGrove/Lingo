import type {
  AutoTranslationPreferences,
  SourceLanguagePolicy,
} from '@/lib/preferences/preference-resolver';
import {
  resolveUiLocale,
  SUPPORTED_UI_LOCALES,
  type UiLocalePreference,
} from '../i18n/locales';
import {
  DEFAULT_TRANSLATION_APPEARANCE,
  resolveTranslationAppearance,
  type TranslationAppearance,
} from '../page-translation/appearance';
import type { ModelProtocol } from '../providers/model-protocols';
import {
  type ProviderIconPreference,
  parseProviderIconPreference,
} from '../providers/provider-icon-model';
import {
  type CustomHeader,
  resolveCustomHeaders,
} from '../providers/request-options';

const MODEL_PROTOCOLS: ModelProtocol[] = [
  'openai-compatible',
  'openai-responses',
  'anthropic',
];

import {
  DEFAULT_TRANSLATION_QUALITY,
  type GlossaryEntry,
  resolveTranslationQuality,
  type TranslationQualitySettings,
} from '../translation/quality';

export type ExtensionTheme = 'system' | 'light' | 'dark';

export const CURRENT_SETTINGS_SCHEMA_VERSION = 13 as const;

export type { ProviderIconPreference } from '../providers/provider-icon-model';
export type { CustomHeader } from '../providers/request-options';

export type ProviderKind =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic'
  | 'gemini'
  | 'deepl'
  | 'google-cloud'
  | 'azure-translator'
  | 'built-in';

export type ProviderModel = {
  id: string;
  name: string;
  /** Protocols a gateway reports for this model; absent when unknown. */
  protocols?: ModelProtocol[];
};

export type ProviderProfile = {
  id: string;
  name: string;
  provider: ProviderKind;
  endpoint?: string;
  model?: string;
  models?: ProviderModel[];
  modelSelection?: 'recommended' | 'manual';
  region?: string;
  nativeGlossaryId?: string;
  icon?: ProviderIconPreference;
  tuning?: ProviderTuning;
  /** Gateway headers; secret values are kept in the credential store. */
  headers?: CustomHeader[];
  /** Azure OpenAI and some gateways expect `api-key` instead of Bearer. */
  credentialHeader?: 'api-key';
};

export type ProviderTuning = {
  concurrency?: number;
  requestsPerMinute?: number;
  timeoutSeconds?: number;
  maxBatchSize?: number;
  maxBatchCharacters?: number;
};

export const PROVIDER_TUNING_LIMITS: Record<
  keyof ProviderTuning,
  [min: number, max: number]
> = {
  concurrency: [1, 16],
  requestsPerMinute: [1, 6000],
  timeoutSeconds: [5, 180],
  maxBatchSize: [1, 100],
  maxBatchCharacters: [500, 50_000],
};

export function resolveProviderTuning(
  value: unknown,
): ProviderTuning | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const tuning: ProviderTuning = {};
  for (const [key, [min, max]] of Object.entries(PROVIDER_TUNING_LIMITS)) {
    const number = (value as Record<string, unknown>)[key];
    if (typeof number === 'number' && Number.isFinite(number))
      tuning[key as keyof ProviderTuning] = Math.min(
        max,
        Math.max(min, Math.round(number)),
      );
  }
  return Object.keys(tuning).length > 0 ? tuning : undefined;
}

export type ExtensionSettings = {
  schemaVersion: typeof CURRENT_SETTINGS_SCHEMA_VERSION;
  enabled: boolean;
  theme: ExtensionTheme;
  uiLocale: UiLocalePreference;
  sourceLanguage: string;
  targetLanguage: string;
  providerProfiles: ProviderProfile[];
  activeProviderProfileId: string | null;
  fallbackProviderProfileIds: string[];
  translationCacheEnabled: boolean;
  floatingButtonEnabled: boolean;
  selectionButtonEnabled: boolean;
  translationQuality: TranslationQualitySettings;
  translationAppearance: TranslationAppearance;
  siteGlossaries: Record<string, GlossaryEntry[]>;
  autoTranslation: AutoTranslationPreferences;
  setupCompleted: boolean;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
  enabled: true,
  theme: 'system',
  uiLocale: 'auto',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  providerProfiles: [],
  activeProviderProfileId: null,
  fallbackProviderProfileIds: [],
  translationCacheEnabled: true,
  floatingButtonEnabled: false,
  selectionButtonEnabled: true,
  translationQuality: DEFAULT_TRANSLATION_QUALITY,
  translationAppearance: DEFAULT_TRANSLATION_APPEARANCE,
  siteGlossaries: {},
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
    candidate.schemaVersion !== 5 &&
    candidate.schemaVersion !== 6 &&
    candidate.schemaVersion !== 7 &&
    candidate.schemaVersion !== 8 &&
    candidate.schemaVersion !== 9 &&
    candidate.schemaVersion !== 10 &&
    candidate.schemaVersion !== 11 &&
    candidate.schemaVersion !== 12 &&
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
    uiLocale:
      candidate.uiLocale === 'auto' ||
      SUPPORTED_UI_LOCALES.includes(candidate.uiLocale as never)
        ? (candidate.uiLocale as UiLocalePreference)
        : DEFAULT_SETTINGS.uiLocale,
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
    floatingButtonEnabled:
      typeof candidate.floatingButtonEnabled === 'boolean'
        ? candidate.floatingButtonEnabled
        : DEFAULT_SETTINGS.floatingButtonEnabled,
    selectionButtonEnabled:
      typeof candidate.selectionButtonEnabled === 'boolean'
        ? candidate.selectionButtonEnabled
        : DEFAULT_SETTINGS.selectionButtonEnabled,
    translationQuality: resolveQualitySettings(candidate.translationQuality),
    translationAppearance: resolveTranslationAppearance(
      candidate.translationAppearance,
    ),
    siteGlossaries: resolveSiteGlossaries(candidate.siteGlossaries),
    autoTranslation: resolveAutoTranslation(candidate.autoTranslation),
    setupCompleted: candidate.setupCompleted === true,
  };
}

export function targetLanguageForBrowser(browserLocale: string): string {
  return resolveUiLocale(browserLocale);
}

export function initialSettingsForInstall(
  reason: string,
  browserLocale: string,
): Pick<ExtensionSettings, 'targetLanguage'> | undefined {
  return reason === 'install'
    ? { targetLanguage: targetLanguageForBrowser(browserLocale) }
    : undefined;
}

function resolveSiteGlossaries(
  value: unknown,
): Record<string, GlossaryEntry[]> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const glossaries: Record<string, GlossaryEntry[]> = {};
  for (const [rawHostname, glossary] of Object.entries(value)) {
    const hostname = rawHostname.toLowerCase();
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        hostname,
      )
    ) {
      continue;
    }
    const normalized = resolveTranslationQuality({ glossary }).glossary;
    if (normalized.length > 0) glossaries[hostname] = normalized;
  }
  return glossaries;
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
  'openai-responses',
  'anthropic',
  'gemini',
  'deepl',
  'google-cloud',
  'azure-translator',
  'built-in',
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

  const icon = parseProviderIconPreference(profile.icon);
  const tuning = resolveProviderTuning(profile.tuning);
  const headers = resolveCustomHeaders(profile.headers);
  return [
    {
      id: profile.id,
      name: profile.name,
      provider: profile.provider as ProviderKind,
      ...optionalString(profile, 'endpoint'),
      ...optionalString(profile, 'model'),
      ...(Array.isArray(profile.models)
        ? { models: normalizeProviderModels(profile.models) }
        : {}),
      ...(profile.modelSelection === 'recommended' ||
      profile.modelSelection === 'manual'
        ? { modelSelection: profile.modelSelection }
        : {}),
      ...optionalString(profile, 'region'),
      ...optionalString(profile, 'nativeGlossaryId'),
      ...(icon ? { icon } : {}),
      ...(tuning ? { tuning } : {}),
      ...(headers.length ? { headers } : {}),
      ...(profile.credentialHeader === 'api-key'
        ? { credentialHeader: 'api-key' as const }
        : {}),
    },
  ];
}

export function normalizeProviderModels(value: unknown[]): ProviderModel[] {
  const models = new Map<string, ProviderModel>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== 'string') continue;
    const id = item.id.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]{0,255}$/.test(id)) continue;
    const name =
      typeof item.name === 'string'
        ? item.name
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim()
            .slice(0, 200)
        : '';
    const protocols = Array.isArray(item.protocols)
      ? MODEL_PROTOCOLS.filter((protocol) =>
          (item.protocols as unknown[]).includes(protocol),
        )
      : [];
    if (!models.has(id))
      models.set(id, {
        id,
        name: name || id,
        ...(protocols.length ? { protocols } : {}),
      });
    if (models.size >= 1000) break;
  }
  return [...models.values()];
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
