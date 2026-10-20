import { useEffect, useRef, useState } from 'react';
import {
  changeInterfaceLanguage,
  getBrowserInterfaceLocale,
  translate,
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
import { communityRuleStore } from '@/lib/rules/community-rules';
import { ruleSubscriptionItem } from '@/lib/rules/rule-subscription';
import { userRuleStore } from '@/lib/rules/user-rules';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type ExtensionTheme,
  getSettings,
  setSettings,
  watchSettings,
} from '@/lib/storage/settings';
import { SettingsIcon } from '@/lib/ui/settings-icon';
import type { SettingsSection } from '@/lib/ui/settings-section';
import ProviderSetup from './ProviderSetup';
import ReadingAppearance from './ReadingAppearance';
import SubtitleSettings from './SubtitleSettings';
import VocabularySettings from './VocabularySettings';
import './OptionsApp.css';

const logger = createLogger('options');
type ExtensionStatus = ExtensionMessages['getExtensionStatus']['response'];
type Section = SettingsSection;
const SECTIONS = [
  ['provider', 'navigation.services', 'service'],
  ['reading', 'navigation.reading', 'language'],
] as const;

function OptionsApp({
  initialSection,
  activeSection,
  onSectionChange,
  embedded = false,
  onBack,
  onConnected,
}: {
  initialSection?: Section;
  activeSection?: Section;
  onSectionChange?: (section: Section) => void;
  embedded?: boolean;
  onBack?: () => void;
  onConnected?: () => void;
}) {
  const { locale, t } = useInterfaceTranslation();
  const browserLocale = getBrowserInterfaceLocale();
  const [settings, setSettingsState] =
    useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [localSection, setLocalSection] = useState<Section>(
    () => initialSection ?? sectionFromHash(),
  );
  const section = activeSection ?? localSection;
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const contentHeading = useRef<HTMLHeadingElement>(null);
  const [userRules, setUserRules] = useState('');
  const [glossaryText, setGlossaryText] = useState('');
  const [siteHostname, setSiteHostname] = useState('');
  const [siteGlossaryText, setSiteGlossaryText] = useState('');
  const [qualityStatus, setQualityStatus] = useState('');
  const [ruleStatus, setRuleStatus] = useState('');
  const [ruleUrl, setRuleUrl] = useState('');
  const [ruleKey, setRuleKey] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('');
  const [updatingRules, setUpdatingRules] = useState(false);
  const [communityUpdatesEnabled, setCommunityUpdatesEnabled] = useState(true);
  const [extensionStatus, setExtensionStatus] =
    useState<ExtensionStatus | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState('');

  useEffect(() => {
    void getSettings()
      .then(async (loadedSettings) => {
        setSettingsState(loadedSettings);
        setOnboarding(!embedded && !loadedSettings.setupCompleted);
        if (!initialSection && !window.location.hash)
          setLocalSection(
            loadedSettings.setupCompleted ? 'provider' : 'reading',
          );
        setGlossaryText(formatGlossary(loadedSettings));
        await changeInterfaceLanguage(loadedSettings.uiLocale);
      })
      .catch((error) => logger.error('Could not load settings.', { error }))
      .finally(() => setSettingsLoaded(true));
    void userRuleStore
      .export()
      .then(setUserRules)
      .catch((error) => {
        logger.error('Could not load user rules.', { error });
        setRuleStatus(translate('options.status.rulesLoadError'));
      });
    void ruleSubscriptionItem
      .getValue()
      .then((subscription) => {
        setRuleUrl(subscription?.url ?? '');
        setRuleKey(subscription?.publicKey ?? '');
      })
      .catch((error) =>
        logger.warn('Could not load rule subscription.', { error }),
      );
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
  }, [embedded, initialSection]);

  useEffect(() => {
    if (embedded) return;
    const onHashChange = () => setLocalSection(sectionFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [embedded]);

  function navigate(next: Section) {
    setLocalSection(next);
    onSectionChange?.(next);
    if (!embedded)
      window.history.replaceState(
        null,
        '',
        next === 'reading' ? '#language-heading' : `#${next}-heading`,
      );
    contentHeading.current?.focus();
    if (embedded) window.scrollTo(0, 0);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
    if (!embedded) document.title = `${t('options.title.settings')} - Lingo`;
  }, [embedded, locale, settings.theme, t]);

  async function updateSubscription() {
    setUpdatingRules(true);
    try {
      const result = await sendMessage('updateCommunityRules', {
        url: ruleUrl.trim(),
        publicKey: ruleKey.trim(),
      });
      setSubscriptionStatus(
        t(
          result.status === 'updated'
            ? 'rules.subscription.updated'
            : result.status === 'disabled'
              ? 'rules.subscription.disabled'
              : 'rules.subscription.failed',
        ),
      );
    } catch (error) {
      logger.warn('Rule subscription update failed.', { error });
      setSubscriptionStatus(t('rules.subscription.failed'));
    } finally {
      setUpdatingRules(false);
    }
  }

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

  const hasService = settings.providerProfiles.some(
    (item) => item.id === settings.activeProviderProfileId,
  );
  const initialLanguageSetup = onboarding && !hasService;
  const appearanceControls = (
    <div hidden={section !== 'reading' || initialLanguageSetup}>
      <ReadingAppearance
        appearance={settings.translationAppearance}
        onChange={(appearance) =>
          void updateSettings({ translationAppearance: appearance })
        }
      />
    </div>
  );
  return (
    <div className={`settings-shell${embedded ? ' settings-embedded' : ''}`}>
      <header className="settings-toolbar">
        {embedded ? (
          <button className="settings-back" type="button" onClick={onBack}>
            <SettingsIcon name="back" size={18} />
            {t('sidebar.backToPage')}
          </button>
        ) : (
          <button
            className="sidebar-brand"
            type="button"
            onClick={() => navigate('reading')}
            aria-label="Lingo"
          >
            <img
              src="/brand/lingo-symbol-ink.svg"
              alt=""
              width="24"
              height="24"
            />
            <img
              src="/brand/lingo-wordmark-ink.svg"
              alt="Lingo"
              width="68"
              height="24"
            />
          </button>
        )}
        <nav className="section-nav" aria-label={t('options.sections.label')}>
          {SECTIONS.map(([id, label, icon]) => (
            <a
              key={id}
              href={id === 'reading' ? '#language-heading' : `#${id}-heading`}
              aria-current={section === id ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(id);
              }}
            >
              <SettingsIcon name={icon} />
              <span>{t(label)}</span>
            </a>
          ))}
          <div className="advanced-nav">
            <button
              type="button"
              aria-current={section === 'advanced' ? 'page' : undefined}
              onClick={() => navigate('advanced')}
            >
              <SettingsIcon name="general" />
              <span>{t('navigation.advanced')}</span>
            </button>
          </div>
        </nav>
      </header>
      <main className="options">
        <header className="settings-header">
          <div>
            <h1 ref={contentHeading} tabIndex={-1}>
              {embedded || settings.setupCompleted
                ? t('options.title.settings')
                : t('options.title.setup')}
            </h1>
          </div>
          <span
            className="autosave-note"
            hidden={embedded && section === 'provider'}
          >
            <SettingsIcon name="check" size={15} />
            {t('navigation.preferencesSaved')}
          </span>
        </header>
        {initialLanguageSetup && section === 'reading' && (
          <section className="welcome-panel">
            <div className="welcome-copy">
              <h2>{t('experience.setup.title')}</h2>
              <p>{t('experience.setup.description')}</p>
              <button
                className="skip-button"
                type="button"
                onClick={() => {
                  setOnboarding(false);
                  void updateSettings({ setupCompleted: true });
                }}
              >
                {t('options.setupLater')}
              </button>
            </div>
          </section>
        )}
        {onboarding && (
          <nav className="setup-progress" aria-label={t('options.title.setup')}>
            <button
              type="button"
              className={section === 'reading' ? 'current' : ''}
              onClick={() => navigate('reading')}
            >
              <SettingsIcon name="language" size={15} />
              {t('experience.setup.stepLanguage')}
            </button>
            <div className="step-line" />
            <button
              type="button"
              className={section === 'provider' ? 'current' : ''}
              onClick={() => {
                navigate('provider');
              }}
            >
              <SettingsIcon name="service" size={15} />
              {t('experience.setup.stepService')}
            </button>
          </nav>
        )}
        {embedded && appearanceControls}
        <section
          className="panel"
          aria-labelledby="language-heading"
          hidden={section !== 'reading'}
        >
          <h2 id="language-heading">{t('options.sections.languages')}</h2>
          <p className="section-description">
            {t('experience.section.languages')}
          </p>
          <label className="row">
            <span>
              <strong>{t('options.interfaceLanguage')}</strong>
              <small>{t('options.interfaceLanguage.help')}</small>
            </span>
            <select
              value={settings.uiLocale}
              onChange={(event) => {
                const uiLocale = event.currentTarget
                  .value as UiLocalePreference;
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
                void updateSettings({
                  sourceLanguage: event.currentTarget.value,
                })
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
                void updateSettings({
                  targetLanguage: event.currentTarget.value,
                })
              }
            >
              {SUPPORTED_UI_LOCALES.map((language) => (
                <option value={language} key={language}>
                  {t(`language.${language}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          {onboarding && !hasService && (
            <div className="panel-footer">
              <button
                className="primary-button"
                type="button"
                onClick={() => navigate('provider')}
              >
                {t('experience.setup.next')}
                <SettingsIcon name="arrow" size={18} />
              </button>
            </div>
          )}
        </section>
        {!embedded && appearanceControls}
        <section
          className="panel"
          aria-labelledby="automation-heading"
          hidden={section !== 'reading' || initialLanguageSetup}
        >
          <h2 id="automation-heading">{t('options.automation.title')}</h2>
          <p className="section-description">
            {t('experience.section.automation')}
          </p>
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
                <option value="all">
                  {t('options.automation.policy.all')}
                </option>
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
        <section
          className="panel"
          aria-labelledby="text-tools-heading"
          hidden={section !== 'reading' || initialLanguageSetup}
        >
          <h2 id="text-tools-heading">{t('tools.title')}</h2>
          <p>{t('tools.shortcuts')}</p>
          <label className="row">
            <span>
              <strong>{t('tools.selectionButton')}</strong>
              <small>{t('tools.selectionHelp')}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.selectionButtonEnabled}
              onChange={(event) =>
                void updateSettings({
                  selectionButtonEnabled: event.currentTarget.checked,
                })
              }
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void browser.tabs.create({
                url: browser.runtime.getURL('/translate.html'),
              })
            }
          >
            {t('tools.menuOpen')}
          </button>
        </section>
        <SubtitleSettings
          hidden={section !== 'reading' || initialLanguageSetup}
        />
        <VocabularySettings
          hidden={section !== 'reading' || initialLanguageSetup}
          serviceName={
            settings.providerProfiles.find(
              (profile) => profile.id === settings.activeProviderProfileId,
            )?.name
          }
        />
        {section === 'advanced' && (
          <div className="advanced-intro">
            <h2 id="advanced-heading">{t('navigation.advanced')}</h2>
            <p>{t('navigation.advancedHelp')}</p>
          </div>
        )}
        <details
          className="advanced-disclosure"
          hidden={section !== 'advanced'}
        >
          <summary>{t('navigation.rulesTitle')}</summary>
          <section className="panel" aria-labelledby="site-rules-heading">
            <h2 id="site-rules-heading">{t('navigation.rulesTitle')}</h2>
            <p>{t('navigation.rulesHelp')}</p>
            <details className="nested-advanced">
              <summary>{t('navigation.communityRules')}</summary>
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
              <label>
                {t('rules.subscription.url')}
                <input
                  type="url"
                  value={ruleUrl}
                  onChange={(event) => setRuleUrl(event.currentTarget.value)}
                />
              </label>
              <label>
                {t('rules.subscription.key')}
                <input
                  value={ruleKey}
                  onChange={(event) => setRuleKey(event.currentTarget.value)}
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                disabled={
                  updatingRules ||
                  !communityUpdatesEnabled ||
                  !ruleUrl ||
                  !ruleKey
                }
                onClick={() => void updateSubscription()}
              >
                {t('rules.subscription.update')}
              </button>
              <p role="status">{subscriptionStatus}</p>
            </details>
            <details className="nested-advanced">
              <summary>{t('navigation.ruleEditor')}</summary>
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
            </details>
          </section>
        </details>
        <details
          className="advanced-disclosure"
          hidden={section !== 'advanced'}
        >
          <summary>{t('navigation.translationStyle')}</summary>
          <section className="panel" aria-labelledby="quality-heading">
            <h2 id="quality-heading">{t('options.quality.title')}</h2>
            <p className="section-description">
              {t('experience.section.quality')}
            </p>
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
                <option value="faithful">
                  {t('options.quality.faithful')}
                </option>
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
        </details>
        <section
          hidden={section !== 'provider'}
          aria-labelledby="provider-heading"
        >
          {settingsLoaded && (
            <ProviderSetup
              settings={settings}
              keepDraft={embedded}
              onSettingsChange={setSettingsState}
              onConnected={() => {
                setOnboarding(false);
                onConnected?.();
              }}
              onBack={
                onboarding && !hasService
                  ? () => navigate('reading')
                  : undefined
              }
            />
          )}
        </section>
        <details
          className="advanced-disclosure"
          hidden={section !== 'advanced'}
        >
          <summary>{t('navigation.diagnostics')}</summary>
          <section
            className="panel"
            id="privacy-heading"
            aria-labelledby="privacy-title"
          >
            <h2 id="privacy-title">{t('options.privacy.title')}</h2>
            <p className="section-description">
              {t('experience.section.privacy')}
            </p>
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
                        size: formatBytes(
                          extensionStatus.cache.byteSize,
                          locale,
                        ),
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
        </details>
        <section
          className="panel"
          aria-label={t('options.settings.label')}
          hidden={section !== 'reading' || initialLanguageSetup}
        >
          <h2 id="general-heading">{t('experience.nav.general')}</h2>
          <p className="section-description">
            {t('experience.section.general')}
          </p>
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
              <option value="system">
                {t('options.settings.theme.system')}
              </option>
              <option value="light">{t('options.settings.theme.light')}</option>
              <option value="dark">{t('options.settings.theme.dark')}</option>
            </select>
          </label>
        </section>
      </main>
    </div>
  );
}

function sectionFromHash(): Section {
  const hash = window.location.hash;
  if (hash === '#provider-heading') return 'provider';
  if (
    [
      '#advanced-heading',
      '#quality-heading',
      '#privacy-heading',
      '#site-rules-heading',
    ].includes(hash)
  )
    return 'advanced';
  return 'reading';
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
