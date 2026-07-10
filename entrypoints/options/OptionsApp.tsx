import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger/logger';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type ExtensionTheme,
  getSettings,
  setSettings,
  watchSettings,
} from '@/lib/storage/settings';
import './OptionsApp.css';

const logger = createLogger('options');

function OptionsApp() {
  const [settingsState, setSettingsState] =
    useState<ExtensionSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void getSettings().then(setSettingsState);
    return watchSettings(setSettingsState);
  }, []);

  async function updateSettings(patch: Partial<ExtensionSettings>) {
    const nextSettings = await setSettings(patch);
    setSettingsState(nextSettings);
    logger.debug('Settings updated.', { patch });
  }

  return (
    <main className="options">
      <header>
        <div className="badge">Options</div>
        <h1>Browser Extension Template</h1>
      </header>

      <section className="panel" aria-label="Extension settings">
        <label className="row">
          <span>
            <strong>Enabled</strong>
            <small>Turn the starter behavior on or off.</small>
          </span>
          <input
            type="checkbox"
            checked={settingsState.enabled}
            onChange={(event) =>
              void updateSettings({ enabled: event.currentTarget.checked })
            }
          />
        </label>

        <label className="row">
          <span>
            <strong>Theme</strong>
            <small>Persist a typed setting through WXT storage.</small>
          </span>
          <select
            value={settingsState.theme}
            onChange={(event) =>
              void updateSettings({
                theme: event.currentTarget.value as ExtensionTheme,
              })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>
    </main>
  );
}

export default OptionsApp;
