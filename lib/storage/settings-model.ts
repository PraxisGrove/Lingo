export type ExtensionTheme = 'system' | 'light' | 'dark';

export type ExtensionSettings = {
  enabled: boolean;
  theme: ExtensionTheme;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  theme: 'system',
};

const THEMES: ExtensionTheme[] = ['system', 'light', 'dark'];

export function resolveSettings(
  value?: Partial<ExtensionSettings> | null,
): ExtensionSettings {
  return {
    enabled:
      typeof value?.enabled === 'boolean'
        ? value.enabled
        : DEFAULT_SETTINGS.enabled,
    theme:
      value?.theme != null && THEMES.includes(value.theme)
        ? value.theme
        : DEFAULT_SETTINGS.theme,
  };
}
