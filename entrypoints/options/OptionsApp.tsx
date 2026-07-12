import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger/logger';
import { sendMessage } from '@/lib/messaging/send-message';
import { PROVIDER_DEFINITIONS } from '@/lib/providers/config';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type ExtensionTheme,
  getSettings,
  type ProviderKind,
  type ProviderProfile,
  setSettings,
  watchSettings,
} from '@/lib/storage/settings';
import './OptionsApp.css';

const logger = createLogger('options');
const FIELD_LABELS = {
  endpoint: 'API endpoint (optional)',
  model: 'Model',
  region: 'Region',
};

function OptionsApp() {
  const [settings, setSettingsState] =
    useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<ProviderProfile>({
    id: crypto.randomUUID(),
    name: '',
    provider: 'openai-compatible',
  });
  const [credential, setCredential] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettingsState);
    return watchSettings(setSettingsState);
  }, []);

  async function updateSettings(
    patch: Partial<Omit<ExtensionSettings, 'schemaVersion'>>,
  ) {
    const next = await setSettings(patch);
    setSettingsState(next);
    logger.debug('Settings updated.', { patch });
  }

  async function saveAndTest() {
    setBusy(true);
    setStatus('Saving and testing connection...');
    try {
      const result = await sendMessage('testProviderConnection', {
        profile,
        credential,
      });
      if (!result.ok) {
        setStatus(`${result.category}: ${result.message}`);
        return;
      }
      await sendMessage('saveProviderProfile', { profile, credential });
      await updateSettings({ setupCompleted: true });
      setCredential('');
      setStatus('Connection successful. Lingo is ready.');
    } catch {
      setStatus('Could not save or test this service.');
    } finally {
      setBusy(false);
    }
  }

  const providerDefinition =
    PROVIDER_DEFINITIONS.find((item) => item.value === profile.provider) ??
    PROVIDER_DEFINITIONS[0];
  return (
    <main className="options">
      <header>
        <div className="badge">Lingo</div>
        <h1>{settings.setupCompleted ? 'Settings' : 'Set up Lingo'}</h1>
        <p>Choose your reading language and connect a translation service.</p>
        {!settings.setupCompleted && (
          <button
            className="skip-button"
            type="button"
            onClick={() => void updateSettings({ setupCompleted: true })}
          >
            Set up later
          </button>
        )}
      </header>
      <section className="panel" aria-labelledby="language-heading">
        <h2 id="language-heading">Languages</h2>
        <label className="row">
          <span>
            <strong>Source language</strong>
            <small>Automatic detection works for most pages.</small>
          </span>
          <select
            value={settings.sourceLanguage}
            onChange={(event) =>
              void updateSettings({ sourceLanguage: event.currentTarget.value })
            }
          >
            <option value="auto">Detect automatically</option>
            <option value="en">English</option>
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="ja">Japanese</option>
            <option value="de">German</option>
            <option value="fr">French</option>
          </select>
        </label>
        <label className="row">
          <span>
            <strong>Target language</strong>
            <small>The language used for translated paragraphs.</small>
          </span>
          <select
            value={settings.targetLanguage}
            onChange={(event) =>
              void updateSettings({ targetLanguage: event.currentTarget.value })
            }
          >
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
          </select>
        </label>
      </section>
      <section
        className="panel provider-panel"
        aria-labelledby="provider-heading"
      >
        <h2 id="provider-heading">Translation service</h2>
        {settings.providerProfiles.length > 0 && (
          <label className="existing-profile">
            Saved profile
            <select
              value={settings.activeProviderProfileId ?? ''}
              onChange={(event) =>
                void updateSettings({
                  activeProviderProfileId: event.currentTarget.value,
                })
              }
            >
              {settings.providerProfiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-grid">
          <label>
            Provider
            <select
              value={profile.provider}
              onChange={(event) =>
                setProfile({
                  id: profile.id,
                  name: profile.name,
                  provider: event.currentTarget.value as ProviderKind,
                })
              }
            >
              {PROVIDER_DEFINITIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Profile name
            <input
              value={profile.name}
              placeholder="Personal API"
              onChange={(event) =>
                setProfile({ ...profile, name: event.currentTarget.value })
              }
            />
          </label>
          {providerDefinition.fields.map((field) => (
            <label key={field}>
              {FIELD_LABELS[field]}
              <input
                value={profile[field] ?? ''}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    [field]: event.currentTarget.value || undefined,
                  })
                }
              />
            </label>
          ))}
          <label>
            API credential
            <input
              type="password"
              value={credential}
              autoComplete="off"
              onChange={(event) => setCredential(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="connection-actions">
          <button
            type="button"
            disabled={busy || !profile.name || !credential}
            onClick={() => void saveAndTest()}
          >
            {busy ? 'Testing...' : 'Save and test connection'}
          </button>
          <p className="connection-status" role="status">
            {status}
          </p>
        </div>
        <small className="privacy-note">
          The test sends only the fixed word “Hello”. When translating, webpage
          text is sent directly from the extension to this provider. Credentials
          remain in this browser profile. Provider pricing and data handling are
          governed by your provider account.
        </small>
        <div className="translation-preview">
          <span>Hello, welcome to Lingo.</span>
          <span>你好，欢迎使用 Lingo。</span>
        </div>
      </section>
      <section className="panel" aria-label="Extension settings">
        <label className="row">
          <span>
            <strong>Enabled</strong>
            <small>Allow Lingo to run on supported webpages.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              void updateSettings({ enabled: event.currentTarget.checked })
            }
          />
        </label>
        <label className="row">
          <span>
            <strong>Theme</strong>
            <small>Choose how Lingo follows your browser appearance.</small>
          </span>
          <select
            value={settings.theme}
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
