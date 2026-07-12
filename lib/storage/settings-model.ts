export type ExtensionTheme = 'system' | 'light' | 'dark';

export const CURRENT_SETTINGS_SCHEMA_VERSION = 2 as const;

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
};

export type ExtensionSettings = {
  schemaVersion: typeof CURRENT_SETTINGS_SCHEMA_VERSION;
  enabled: boolean;
  theme: ExtensionTheme;
  sourceLanguage: string;
  targetLanguage: string;
  providerProfiles: ProviderProfile[];
  activeProviderProfileId: string | null;
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
    setupCompleted: candidate.setupCompleted === true,
  };
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

  return [{
    id: profile.id,
    name: profile.name,
    provider: profile.provider as ProviderKind,
    ...optionalString(profile, 'endpoint'),
    ...optionalString(profile, 'model'),
    ...optionalString(profile, 'region'),
  }];
}

function optionalString(
  value: Record<string, unknown>,
  key: 'endpoint' | 'model' | 'region',
): Partial<ProviderProfile> {
  return typeof value[key] === 'string' && value[key].length > 0
    ? { [key]: value[key] }
    : {};
}

function validLanguage(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
    ? value
    : fallback;
}
