import { useEffect, useState } from 'react';
import {
  changeInterfaceLanguage,
  getBrowserInterfaceLocale,
  useInterfaceTranslation,
} from '@/lib/i18n/i18n';
import {
  SUPPORTED_UI_LOCALES,
  type UiLocalePreference,
} from '@/lib/i18n/locales';
import type { MessageKey } from '@/lib/i18n/resources';
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
  endpoint: 'options.provider.endpoint',
  model: 'options.provider.model',
  region: 'options.provider.region',
  nativeGlossaryId: 'options.provider.glossaryId',
} satisfies Record<string, MessageKey>;

function OptionsApp() {
  const { locale, t } = useInterfaceTranslation();
  const browserLocale = getBrowserInterfaceLocale();
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
    void getSettings()
      .then(async (loadedSettings) => {
        setSettingsState(loadedSettings);
        setGlossaryText(formatGlossary(loadedSettings));
        await changeInterfaceLanguage(loadedSettings.uiLocale);
      })
      .catch((error) => logger.error('Could not load settings.', { error }));
    void userRuleStore
      .export()
      .then(setUserRules)
      .catch((error) => {
        logger.error('Could not load user rules.', { error });
        setRuleStatus(t('options.status.rulesLoadError'));
      });
    void communityRuleStore
      .get()
      .then((state) => setCommunityUpdatesEnabled(state.updatesEnabled))
      .catch((error) =>
        logger.error('Could not load community rule settings.', { error }),
      );
    void sendMessage('getExtensionStatus', {})
      .then(setExtensionStatus)
      .catch((error) =>
        logger.error('Could not load extension status.', { error }),
      );
    return watchSettings((nextSettings) => {
      setSettingsState(nextSettings);
      setGlossaryText(formatGlossary(nextSettings));
      void changeInterfaceLanguage(nextSettings.uiLocale).catch((error) =>
        logger.error('Could not apply options interface language.', { error }),
      );
    });
  }, [t]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
    document.title = `${t('options.title.settings')} - Lingo`;
  }, [locale, settings.theme, t]);

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
    setStatus(t('options.status.testing'));
    try {
      const result = await sendMessage('testProviderConnection', {
        profile,
        credential,
      });
      if (!result.ok) {
        setStatus(
          `${t('options.status.providerError', { category: result.category })}: ${result.message}`,
        );
        return;
      }
      await sendMessage('saveProviderProfile', { profile, credential });
      await updateSettings({ setupCompleted: true });
      setCredential('');
      setStatus(t('options.status.connectionReady'));
    } catch (error) {
      logger.error('Could not test or save provider profile.', {
        provider: profile.provider,
        error,
      });
      setStatus(t('options.status.connectionError'));
    } finally {
      setBusy(false);
    }
  }

  async function saveUserRules() {
    try {
      const rules = await userRuleStore.import(userRules);
      setUserRules(JSON.stringify(rules, null, 2));
      setRuleStatus(t('options.status.rulesSaved'));
    } catch (error) {
      logger.error('Could not import user rules.', { error });
      setRuleStatus(t('options.status.rulesSaveError'));
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
      setRuleStatus(t('options.status.rulesExported'));
    } catch (error) {
      logger.warn('Could not export user rules.', { error });
      setRuleStatus(t('options.status.rulesInvalidJson'));
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
      setQualityStatus(t('options.status.invalidHostname'));
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
        ? t('options.status.glossarySaved', { hostname })
        : t('options.status.glossaryRemoved', { hostname }),
    );
  }

  async function clearCache() {
    await sendMessage('clearTranslationCache', {});
    await refreshExtensionStatus();
    setPrivacyStatus(t('options.status.cacheCleared'));
  }

  async function exportDiagnostics() {
    const report = await sendMessage('exportDiagnostics', {});
    downloadJson('lingo-diagnostics.json', report);
    setPrivacyStatus(t('options.status.diagnosticsExported'));
  }

  async function deleteActiveProvider() {
    const profileId = settings.activeProviderProfileId;
    if (!profileId) return;
    await sendMessage('deleteProviderProfile', { profileId });
    setConfirmingDelete(false);
    setStatus(t('options.status.serviceRemoved'));
  }

  const providerDefinition =
    PROVIDER_DEFINITIONS.find((item) => item.value === profile.provider) ??
    PROVIDER_DEFINITIONS[0];
  return (
    <main className="options">
      <header>
        <div className="badge">Lingo</div>
        <h1>
          {settings.setupCompleted
            ? t('options.title.settings')
            : t('options.title.setup')}
        </h1>
        <p>{t('options.subtitle')}</p>
        {!settings.setupCompleted && (
          <button
            className="skip-button"
            type="button"
            onClick={() => void updateSettings({ setupCompleted: true })}
          >
            {t('options.setupLater')}
          </button>
        )}
      </header>
      <nav className="section-nav" aria-label={t('options.sections.label')}>
        <a href="#language-heading">{t('options.sections.languages')}</a>
        <a href="#provider-heading">{t('options.sections.services')}</a>
        <a href="#automation-heading">{t('options.sections.automation')}</a>
        <a href="#quality-heading">{t('options.sections.quality')}</a>
        <a href="#privacy-heading">{t('options.sections.privacy')}</a>
      </nav>
      <section className="panel" aria-labelledby="language-heading">
        <h2 id="language-heading">{t('options.sections.languages')}</h2>
        <label className="row">
          <span>
            <strong>{t('options.interfaceLanguage')}</strong>
            <small>{t('options.interfaceLanguage.help')}</small>
          </span>
          <select
            value={settings.uiLocale}
            onChange={(event) => {
              const uiLocale = event.currentTarget.value as UiLocalePreference;
              setStatus('');
              setRuleStatus('');
              setQualityStatus('');
              setPrivacyStatus('');
              void changeInterfaceLanguage(uiLocale).then(() =>
                updateSettings({ uiLocale }),
              );
            }}
          >
            <option value="auto">
              {t('language.auto', {
                language: t(`language.${browserLocale}` as MessageKey),
              })}
            </option>
            {SUPPORTED_UI_LOCALES.map((supportedLocale) => (
              <option value={supportedLocale} key={supportedLocale}>
                {t(`language.${supportedLocale}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <span>
            <strong>{t('options.sourceLanguage')}</strong>
            <small>{t('options.sourceLanguage.help')}</small>
          </span>
          <select
            value={settings.sourceLanguage}
            onChange={(event) =>
              void updateSettings({ sourceLanguage: event.currentTarget.value })
            }
          >
            <option value="auto">{t('options.detectAutomatically')}</option>
            {SUPPORTED_UI_LOCALES.map((language) => (
              <option value={language} key={language}>
                {t(`language.${language}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <span>
            <strong>{t('popup.targetLanguage')}</strong>
            <small>{t('options.targetLanguage.help')}</small>
          </span>
          <select
            value={settings.targetLanguage}
            onChange={(event) =>
              void updateSettings({ targetLanguage: event.currentTarget.value })
            }
          >
            {SUPPORTED_UI_LOCALES.map((language) => (
              <option value={language} key={language}>
                {t(`language.${language}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="panel" aria-labelledby="automation-heading">
        <h2 id="automation-heading">{t('options.automation.title')}</h2>
        <label className="row">
          <span>
            <strong>{t('options.automation.enabled')}</strong>
            <small>{t('options.automation.enabled.help')}</small>
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
            <strong>{t('options.automation.defaultSites')}</strong>
            <small>{t('options.automation.defaultSites.help')}</small>
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
            <strong>{t('options.automation.communityRules')}</strong>
            <small>{t('options.automation.communityRules.help')}</small>
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
            {t('options.automation.sourcePolicy')}
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
              <option value="all">{t('options.automation.policy.all')}</option>
              <option value="included">
                {t('options.automation.policy.included')}
              </option>
              <option value="excluded">
                {t('options.automation.policy.excluded')}
              </option>
            </select>
          </label>
          <label>
            {t('options.sections.languages')}
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
        <h2 id="site-rules-heading">{t('options.rules.title')}</h2>
        <div className="rule-editor">
          <textarea
            aria-label={t('options.rules.jsonLabel')}
            value={userRules}
            onChange={(event) => setUserRules(event.currentTarget.value)}
            spellCheck={false}
          />
          <div className="rule-actions">
            <button type="button" onClick={() => void saveUserRules()}>
              {t('options.rules.save')}
            </button>
            <button type="button" onClick={downloadUserRules}>
              {t('options.rules.export')}
            </button>
          </div>
          <p className="connection-status" role="status">
            {ruleStatus}
          </p>
        </div>
      </section>
      <section className="panel" aria-labelledby="quality-heading">
        <h2 id="quality-heading">{t('options.quality.title')}</h2>
        <label className="row">
          <span>
            <strong>{t('options.quality.template')}</strong>
            <small>{t('options.quality.template.help')}</small>
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
            <option value="faithful">{t('options.quality.faithful')}</option>
            <option value="natural">{t('options.quality.natural')}</option>
            <option value="concise">{t('options.quality.concise')}</option>
          </select>
        </label>
        <label>
          {t('options.quality.instruction')}
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
          {t('options.quality.globalGlossary')}
          <textarea
            aria-label={t('options.quality.glossaryLabel')}
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
          <h3>{t('options.quality.siteGlossary')}</h3>
          <p className="site-glossary-intro">
            {t('options.quality.siteGlossary.help')}
          </p>
          <label>
            {t('options.quality.hostname')}
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
            {t('options.quality.terms')}
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
              {t('options.quality.saveSiteGlossary')}
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
        <h2 id="provider-heading">{t('popup.translationService')}</h2>
        {settings.providerProfiles.length > 0 && (
          <div className="saved-profile-row">
            <label className="existing-profile">
              {t('options.provider.savedProfile')}
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
              {confirmingDelete
                ? t('options.provider.confirmRemoval')
                : t('options.provider.removeSelected')}
            </button>
            {confirmingDelete && (
              <button
                className="cancel-button"
                type="button"
                onClick={() => setConfirmingDelete(false)}
              >
                {t('options.cancel')}
              </button>
            )}
          </div>
        )}
        {settings.providerProfiles.length > 1 && (
          <fieldset className="fallback-chain">
            <legend>{t('options.provider.fallbackServices')}</legend>
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
            {t('options.provider.provider')}
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
            {t('options.provider.profileName')}
            <input
              value={profile.name}
              placeholder={t('options.provider.profilePlaceholder')}
              onChange={(event) =>
                setProfile({ ...profile, name: event.currentTarget.value })
              }
            />
          </label>
          {providerDefinition.fields.map((field) => (
            <label key={field}>
              {t(FIELD_LABELS[field])}
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
            {t('options.provider.credential')}
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
            {busy
              ? t('options.provider.testing')
              : t('options.provider.saveAndTest')}
          </button>
          <p className="connection-status" role="status">
            {status}
          </p>
        </div>
        <small className="privacy-note">
          {t('options.provider.privacyNote')}
        </small>
        <div className="translation-preview">
          <span>{t('options.provider.previewSource')}</span>
          <span>{t('options.provider.previewTarget')}</span>
        </div>
      </section>
      <section
        className="panel"
        id="privacy-heading"
        aria-labelledby="privacy-title"
      >
        <h2 id="privacy-title">{t('options.privacy.title')}</h2>
        <div className="status-list">
          <div>
            <span>{t('options.privacy.pageAccess')}</span>
            <strong>
              {extensionStatus?.hostPermissionGranted
                ? t('options.privacy.allowedAllSites')
                : t('options.privacy.notGranted')}
            </strong>
            {extensionStatus && !extensionStatus.hostPermissionGranted && (
              <small>{t('options.privacy.grantAccess')}</small>
            )}
          </div>
          <div>
            <span>{t('options.settings.cache')}</span>
            <strong>
              {extensionStatus
                ? t('options.privacy.cacheUsage', {
                    count: extensionStatus.cache.entryCount,
                    size: formatBytes(extensionStatus.cache.byteSize, locale),
                  })
                : t('options.privacy.calculating')}
            </strong>
          </div>
          <div>
            <span>{t('popup.dataFlow')}</span>
            <strong>
              {t('options.privacy.webpageToProvider', {
                provider:
                  settings.providerProfiles.find(
                    (item) => item.id === settings.activeProviderProfileId,
                  )?.name ?? t('popup.noServiceSelected'),
              })}
            </strong>
            <small>{t('options.privacy.dataFlowHelp')}</small>
          </div>
        </div>
        <div className="privacy-actions">
          <button type="button" onClick={() => void exportDiagnostics()}>
            {t('options.privacy.exportDiagnostics')}
          </button>
          <button type="button" onClick={() => void clearCache()}>
            {t('options.privacy.clearCache')}
          </button>
        </div>
        <p className="connection-status" role="status">
          {privacyStatus}
        </p>
      </section>
      <section className="panel" aria-label={t('options.settings.label')}>
        <label className="row">
          <span>
            <strong>{t('options.settings.cache')}</strong>
            <small>{t('options.settings.cache.help')}</small>
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
            <strong>{t('options.settings.floatingControl')}</strong>
            <small>{t('options.settings.floatingControl.help')}</small>
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
            <strong>{t('options.settings.enabled')}</strong>
            <small>{t('options.settings.enabled.help')}</small>
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
            <strong>{t('options.settings.theme')}</strong>
            <small>{t('options.settings.theme.help')}</small>
          </span>
          <select
            value={settings.theme}
            onChange={(event) =>
              void updateSettings({
                theme: event.currentTarget.value as ExtensionTheme,
              })
            }
          >
            <option value="system">{t('options.settings.theme.system')}</option>
            <option value="light">{t('options.settings.theme.light')}</option>
            <option value="dark">{t('options.settings.theme.dark')}</option>
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

function formatBytes(bytes: number, locale: string): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${number.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
  return `${number.format(bytes / (1024 * 1024))} MB`;
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
