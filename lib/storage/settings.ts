import { storage } from '@wxt-dev/storage';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  resolveSettings,
} from './settings-model';

export {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type ExtensionTheme,
  type ProviderKind,
  type ProviderProfile,
  resolveSettings,
} from './settings-model';

export const settingsItem = storage.defineItem<ExtensionSettings>(
  'local:settings',
  {
    fallback: DEFAULT_SETTINGS,
  },
);

export async function getSettings(): Promise<ExtensionSettings> {
  return resolveSettings(await settingsItem.getValue());
}

export async function setSettings(
  patch: Partial<Omit<ExtensionSettings, 'schemaVersion'>>,
): Promise<ExtensionSettings> {
  const nextSettings = resolveSettings({
    ...(await getSettings()),
    ...patch,
  });

  await settingsItem.setValue(nextSettings);
  return nextSettings;
}

export function watchSettings(
  callback: (settings: ExtensionSettings) => void,
): () => void {
  return settingsItem.watch((settings) => {
    callback(resolveSettings(settings));
  });
}
