export type ExtensionTheme = 'system' | 'light' | 'dark';

export const CURRENT_SETTINGS_SCHEMA_VERSION = 1 as const;

export type ExtensionSettings = {
  schemaVersion: typeof CURRENT_SETTINGS_SCHEMA_VERSION;
  enabled: boolean;
  theme: ExtensionTheme;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
  enabled: true,
  theme: 'system',
};

const THEMES: ExtensionTheme[] = ['system', 'light', 'dark'];

export function resolveSettings(value?: unknown): ExtensionSettings {
  if (value == null || typeof value !== 'object') {
    return DEFAULT_SETTINGS;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== undefined &&
    candidate.schemaVersion !== CURRENT_SETTINGS_SCHEMA_VERSION
  ) {
    return DEFAULT_SETTINGS;
  }

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
  };
}
