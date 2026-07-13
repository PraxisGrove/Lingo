import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger/logger';
import type { ExtensionMessages } from '@/lib/messaging/messages';
import { sendMessage } from '@/lib/messaging/send-message';
import { PROVIDER_DEFINITIONS } from '@/lib/providers/config';
import { communityRuleStore } from '@/lib/rules/community-rules';
import { userRuleStore } from '@/lib/rules/user-rules';
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
type ExtensionStatus = ExtensionMessages['getExtensionStatus']['response'];
const FIELD_LABELS = {
  endpoint: 'API endpoint (optional)',
  model: 'Model',
  region: 'Region',
  nativeGlossaryId: 'DeepL glossary ID (optional)',
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
  const [userRules, setUserRules] = useState('');
  const [glossaryText, setGlossaryText] = useState('');
  const [siteHostname, setSiteHostname] = useState('');
  const [siteGlossaryText, setSiteGlossaryText] = useState('');
  const [qualityStatus, setQualityStatus] = useState('');
  const [ruleStatus, setRuleStatus] = useState('');
  const [communityUpdatesEnabled, setCommunityUpdatesEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [extensionStatus, setExtensionStatus] =
    useState<ExtensionStatus | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    void getSettings().then((loadedSettings) => {
      setSettingsState(loadedSettings);
      setGlossaryText(formatGlossary(loadedSettings));
    });
    void userRuleStore
      .export()
      .then(setUserRules)
      .catch(() => setRuleStatus('Could not load saved site rules.'));
    void communityRuleStore
      .get()
      .then((state) => setCommunityUpdatesEnabled(state.updatesEnabled));
    void sendMessage('getExtensionStatus', {}).then(setExtensionStatus);
    return watchSettings((nextSettings) => {
      setSettingsState(nextSettings);
      setGlossaryText(formatGlossary(nextSettings));
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  async function refreshExtensionStatus() {
    setExtensionStatus(await sendMessage('getExtensionStatus', {}));
  }

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

  async function saveUserRules() {
    try {
      const rules = await userRuleStore.import(userRules);
      setUserRules(JSON.stringify(rules, null, 2));
      setRuleStatus('Site rules saved.');
    } catch (error) {
      setRuleStatus(
        error instanceof Error ? error.message : 'Could not save site rules.',
      );
    }
  }

  function downloadUserRules() {
    try {
      const serialized = JSON.stringify(JSON.parse(userRules), null, 2);
      const url = URL.createObjectURL(
        new Blob([serialized], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lingo-user-rules.json';
      link.click();
      URL.revokeObjectURL(url);
      setRuleStatus('Site rules exported.');
    } catch {
      setRuleStatus('Enter valid JSON before exporting site rules.');
    }
  }

  async function updateCommunityRules(updatesEnabled: boolean) {
    await communityRuleStore.setUpdatesEnabled(updatesEnabled);
    setCommunityUpdatesEnabled(updatesEnabled);
  }

  function selectSiteGlossary(hostname: string) {
    setSiteHostname(hostname);
    setSiteGlossaryText(
      formatGlossaryEntries(settings.siteGlossaries[hostname] ?? []),
    );
    setQualityStatus('');
  }

  async function saveSiteGlossary() {
    const hostname = siteHostname.trim().toLowerCase();
    if (!validHostname(hostname)) {
      setQualityStatus('Enter a valid hostname, such as docs.example.com.');
      return;
    }
    const siteGlossaries = { ...settings.siteGlossaries };
    const glossary = parseGlossary(siteGlossaryText);
    if (glossary.length > 0) siteGlossaries[hostname] = glossary;
    else delete siteGlossaries[hostname];
    await updateSettings({ siteGlossaries });
    setSiteHostname(hostname);
    setQualityStatus(
      glossary.length > 0
        ? `Glossary saved for ${hostname}.`
        : `Glossary removed for ${hostname}.`,
    );
  }

  async function clearCache() {
    await sendMessage('clearTranslationCache', {});
    await refreshExtensionStatus();
    setPrivacyStatus('Translation cache cleared.');
  }

  async function exportDiagnostics() {
    const report = await sendMessage('exportDiagnostics', {});
    downloadJson('lingo-diagnostics.json', report);
    setPrivacyStatus('Redacted diagnostics exported.');
  }

  async function deleteActiveProvider() {
    const profileId = settings.activeProviderProfileId;
    if (!profileId) return;
    await sendMessage('deleteProviderProfile', { profileId });
    setConfirmingDelete(false);
    setStatus('Translation service removed from this browser.');
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
      <nav className="section-nav" aria-label="Settings sections">
        <a href="#language-heading">Languages</a>
        <a href="#provider-heading">Services</a>
        <a href="#automation-heading">Automation</a>
        <a href="#quality-heading">Quality</a>
        <a href="#privacy-heading">Privacy</a>
      </nav>
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
      <section className="panel" aria-labelledby="automation-heading">
        <h2 id="automation-heading">Automatic translation</h2>
        <label className="row">
          <span>
            <strong>Automatic translation</strong>
            <small>
              Allow Lingo to begin translation when a matching rule applies.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.autoTranslation.enabled}
            onChange={(event) =>
              void updateSettings({
                autoTranslation: {
                  ...settings.autoTranslation,
                  enabled: event.currentTarget.checked,
                },
              })
            }
          />
        </label>
        <label className="row">
          <span>
            <strong>Default automatic sites</strong>
            <small>
              Use Lingo's built-in rules for selected reading sites.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.autoTranslation.defaultAutoSitesEnabled}
            onChange={(event) =>
              void updateSettings({
                autoTranslation: {
                  ...settings.autoTranslation,
                  defaultAutoSitesEnabled: event.currentTarget.checked,
                },
              })
            }
          />
        </label>
        <label className="row">
          <span>
            <strong>Community rule updates</strong>
            <small>
              Accept only signed community rule updates stored on this device.
            </small>
          </span>
          <input
            type="checkbox"
            checked={communityUpdatesEnabled}
            onChange={(event) =>
              void updateCommunityRules(event.currentTarget.checked)
            }
          />
        </label>
        <div className="language-policy">
          <label>
            Source language policy
            <select
              value={settings.autoTranslation.sourceLanguagePolicy.mode}
              onChange={(event) =>
                void updateSettings({
                  autoTranslation: {
                    ...settings.autoTranslation,
                    sourceLanguagePolicy: {
                      ...settings.autoTranslation.sourceLanguagePolicy,
                      mode: event.currentTarget.value as
                        | 'all'
                        | 'included'
                        | 'excluded',
                    },
                  },
                })
              }
            >
              <option value="all">Translate all detected languages</option>
              <option value="included">Translate only these languages</option>
              <option value="excluded">Do not translate these languages</option>
            </select>
          </label>
          <label>
            Languages
            <input
              value={settings.autoTranslation.sourceLanguagePolicy.languages.join(
                ', ',
              )}
              disabled={
                settings.autoTranslation.sourceLanguagePolicy.mode === 'all'
              }
              placeholder="en, ja"
              onChange={(event) =>
                void updateSettings({
                  autoTranslation: {
                    ...settings.autoTranslation,
                    sourceLanguagePolicy: {
                      ...settings.autoTranslation.sourceLanguagePolicy,
                      languages: event.currentTarget.value
                        .split(',')
                        .map((language) => language.trim())
                        .filter(Boolean),
                    },
                  },
                })
              }
            />
          </label>
        </div>
      </section>
      <section className="panel" aria-labelledby="site-rules-heading">
        <h2 id="site-rules-heading">Site rules</h2>
        <div className="rule-editor">
          <textarea
            aria-label="User site rules JSON"
            value={userRules}
            onChange={(event) => setUserRules(event.currentTarget.value)}
            spellCheck={false}
          />
          <div className="rule-actions">
            <button type="button" onClick={() => void saveUserRules()}>
              Save imported rules
            </button>
            <button type="button" onClick={downloadUserRules}>
              Export rules
            </button>
          </div>
          <p className="connection-status" role="status">
            {ruleStatus}
          </p>
        </div>
      </section>
      <section className="panel" aria-labelledby="quality-heading">
        <h2 id="quality-heading">Translation quality</h2>
        <label className="row">
          <span>
            <strong>Instruction template</strong>
            <small>Sets the default style for translated paragraphs.</small>
          </span>
          <select
            value={settings.translationQuality.template}
            onChange={(event) =>
              void updateSettings({
                translationQuality: {
                  ...settings.translationQuality,
                  template: event.currentTarget.value as
                    | 'faithful'
                    | 'natural'
                    | 'concise',
                },
              })
            }
          >
            <option value="faithful">Faithful</option>
            <option value="natural">Natural</option>
            <option value="concise">Concise</option>
          </select>
        </label>
        <label>
          Additional translation instruction
          <textarea
            value={settings.translationQuality.instruction}
            onChange={(event) =>
              void updateSettings({
                translationQuality: {
                  ...settings.translationQuality,
                  instruction: event.currentTarget.value,
                },
              })
            }
          />
        </label>
        <label>
          Global glossary
          <textarea
            aria-label="Glossary"
            placeholder="Lingo => Lingo"
            value={glossaryText}
            onChange={(event) => setGlossaryText(event.currentTarget.value)}
            onBlur={(event) =>
              void updateSettings({
                translationQuality: {
                  ...settings.translationQuality,
                  glossary: parseGlossary(event.currentTarget.value),
                },
              })
            }
          />
        </label>
        <div className="site-glossary">
          <h3>Site glossary</h3>
          <p className="site-glossary-intro">
            Override terminology only when translating a matching hostname.
          </p>
          <label>
            Site hostname
            <input
              list="site-glossary-hostnames"
              value={siteHostname}
              placeholder="docs.example.com"
              onChange={(event) =>
                selectSiteGlossary(event.currentTarget.value)
              }
            />
            <datalist id="site-glossary-hostnames">
              {Object.keys(settings.siteGlossaries).map((hostname) => (
                <option value={hostname} key={hostname} />
              ))}
            </datalist>
          </label>
          <label>
            Terms
            <textarea
              value={siteGlossaryText}
              placeholder="API => interface"
              onChange={(event) =>
                setSiteGlossaryText(event.currentTarget.value)
              }
            />
          </label>
          <div className="site-glossary-actions">
            <button type="button" onClick={() => void saveSiteGlossary()}>
              Save site glossary
            </button>
            <p className="connection-status" role="status">
              {qualityStatus}
            </p>
          </div>
        </div>
      </section>
      <section
        className="panel provider-panel"
        aria-labelledby="provider-heading"
      >
        <h2 id="provider-heading">Translation service</h2>
        {settings.providerProfiles.length > 0 && (
          <div className="saved-profile-row">
            <label className="existing-profile">
              Saved profile
              <select
                value={settings.activeProviderProfileId ?? ''}
                onChange={(event) =>
                  void (async () => {
                    setConfirmingDelete(false);
                    await updateSettings({
                      activeProviderProfileId: event.currentTarget.value,
                    });
                  })()
                }
              >
                {settings.providerProfiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="danger-button"
              type="button"
              onClick={() =>
                confirmingDelete
                  ? void deleteActiveProvider()
                  : setConfirmingDelete(true)
              }
            >
              {confirmingDelete ? 'Confirm removal' : 'Remove selected service'}
            </button>
            {confirmingDelete && (
              <button
                className="cancel-button"
                type="button"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {settings.providerProfiles.length > 1 && (
          <fieldset className="fallback-chain">
            <legend>Fallback services</legend>
            {settings.providerProfiles
              .filter((item) => item.id !== settings.activeProviderProfileId)
              .map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={settings.fallbackProviderProfileIds.includes(
                      item.id,
                    )}
                    onChange={(event) =>
                      void updateSettings({
                        fallbackProviderProfileIds: event.currentTarget.checked
                          ? [...settings.fallbackProviderProfileIds, item.id]
                          : settings.fallbackProviderProfileIds.filter(
                              (id) => id !== item.id,
                            ),
                      })
                    }
                  />
                  {item.name}
                </label>
              ))}
            {settings.fallbackProviderProfileIds.length > 0 && (
              <ol className="fallback-order">
                {settings.fallbackProviderProfileIds.map((id) => (
                  <li key={id}>
                    {settings.providerProfiles.find((item) => item.id === id)
                      ?.name ?? id}
                  </li>
                ))}
              </ol>
            )}
          </fieldset>
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
      <section
        className="panel"
        id="privacy-heading"
        aria-labelledby="privacy-title"
      >
        <h2 id="privacy-title">Privacy and device data</h2>
        <div className="status-list">
          <div>
            <span>Page access</span>
            <strong>
              {extensionStatus?.hostPermissionGranted
                ? 'Allowed on all sites'
                : 'Not granted'}
            </strong>
            {extensionStatus && !extensionStatus.hostPermissionGranted && (
              <small>
                Grant site access in your browser extension controls.
              </small>
            )}
          </div>
          <div>
            <span>Translation cache</span>
            <strong>
              {extensionStatus
                ? `${extensionStatus.cache.entryCount} entries, ${formatBytes(extensionStatus.cache.byteSize)}`
                : 'Calculating usage'}
            </strong>
          </div>
          <div>
            <span>Data flow</span>
            <strong>
              Webpage text →{' '}
              {settings.providerProfiles.find(
                (item) => item.id === settings.activeProviderProfileId,
              )?.name ?? 'No service selected'}
            </strong>
            <small>
              Credentials stay in this browser profile. Lingo has no telemetry
              endpoint.
            </small>
          </div>
        </div>
        <div className="privacy-actions">
          <button type="button" onClick={() => void exportDiagnostics()}>
            Export redacted diagnostics
          </button>
          <button type="button" onClick={() => void clearCache()}>
            Clear translation cache
          </button>
        </div>
        <p className="connection-status" role="status">
          {privacyStatus}
        </p>
      </section>
      <section className="panel" aria-label="Extension settings">
        <label className="row">
          <span>
            <strong>Translation cache</strong>
            <small>
              Reuse local translations from the same service and model.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.translationCacheEnabled}
            onChange={(event) =>
              void updateSettings({
                translationCacheEnabled: event.currentTarget.checked,
              })
            }
          />
        </label>
        <label className="row">
          <span>
            <strong>Floating page control</strong>
            <small>
              Show a compact translate button on supported webpages.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.floatingButtonEnabled}
            onChange={(event) =>
              void updateSettings({
                floatingButtonEnabled: event.currentTarget.checked,
              })
            }
          />
        </label>
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

function formatGlossary(settings: ExtensionSettings): string {
  return formatGlossaryEntries(settings.translationQuality.glossary);
}

function formatGlossaryEntries(
  glossary: ExtensionSettings['translationQuality']['glossary'],
): string {
  return glossary
    .map((entry) => `${entry.source} => ${entry.target}`)
    .join('\n');
}

function parseGlossary(value: string) {
  return value.split('\n').flatMap((line) => {
    const [source, ...target] = line.split('=>');
    return source && target.length > 0
      ? [{ source, target: target.join('=>') }]
      : [];
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validHostname(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
    value,
  );
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default OptionsApp;
