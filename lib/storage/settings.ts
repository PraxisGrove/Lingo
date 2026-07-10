import { storage } from '@wxt-dev/storage';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  resolveSettings,
} from './settings-model';

export {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type ExtensionTheme,
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
  patch: Partial<ExtensionSettings>,
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
