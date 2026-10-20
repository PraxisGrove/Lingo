import { useEffect, useState } from 'react';
import {
  changeInterfaceLanguage,
  useInterfaceTranslation,
} from '@/lib/i18n/i18n';
import type { MessageKey } from '@/lib/i18n/resources';
import { createLogger } from '@/lib/logger/logger';
import {
  createMessage,
  type ExtensionMessages,
} from '@/lib/messaging/messages';
import { sendMessage } from '@/lib/messaging/send-message';
import type { SessionSnapshot } from '@/lib/page-translation/page-translation';
import type { SiteTranslationPolicy } from '@/lib/preferences/preference-resolver';
import { userRuleStore } from '@/lib/rules/user-rules';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  getSettings,
  setSettings,
  watchSettings,
} from '@/lib/storage/settings';
import { resolvePopupNotice } from '@/lib/ui/popup-state';
import { ProviderIcon } from '@/lib/ui/provider-icon';
import { detectProviderPreset } from '@/lib/ui/provider-presets';
import type { SettingsSection } from '@/lib/ui/settings-section';
import SubtitleControl from './SubtitleControl';
import './App.css';

const logger = createLogger('popup');

const IDLE_SNAPSHOT: SessionSnapshot = {
  status: 'idle',
  displayMode: 'bilingual',
  translatedUnitCount: 0,
  failedUnitCount: 0,
  totalUnitCount: 0,
  pageRevision: 0,
};

type ExtensionStatus = ExtensionMessages['getExtensionStatus']['response'];

function App({
  onOpenSettings,
}: {
  onOpenSettings?: (section: SettingsSection) => void;
}) {
  const { locale, t } = useInterfaceTranslation();
  const [settings, setSettingsState] =
    useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [page, setPage] = useState<SessionSnapshot | null>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [extensionStatus, setExtensionStatus] =
    useState<ExtensionStatus | null>(null);
  const [hostname, setHostname] = useState('');
  const [sitePolicy, setSitePolicy] =
    useState<SiteTranslationPolicy>('default');
  const [includePageInterface, setIncludePageInterface] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSettings()
      .then(async (loadedSettings) => {
        setSettingsState(loadedSettings);
        setSettingsLoaded(true);
        await changeInterfaceLanguage(loadedSettings.uiLocale);
      })
      .catch((error) => {
        logger.error('Could not load popup settings.', { error });
        setSettingsLoaded(true);
      });
    void sendMessage('getExtensionStatus', {})
      .then(setExtensionStatus)
      .catch((error) =>
        logger.error('Could not load extension status.', { error }),
      );
    void loadActivePage()
      .then(({ hostname: activeHostname, snapshot }) => {
        setHostname(activeHostname);
        setPage(snapshot);
        setPageLoaded(true);
        if (activeHostname !== '') {
          void userRuleStore
            .translationPolicyFor(activeHostname)
            .then(setSitePolicy)
            .catch((error) =>
              logger.error('Could not load site translation policy.', {
                error,
              }),
            );
        }
      })
      .catch((error) => {
        logger.error('Could not inspect the active page.', { error });
        setPageLoaded(true);
      });
    return watchSettings((nextSettings) => {
      setSettingsState(nextSettings);
      void changeInterfaceLanguage(nextSettings.uiLocale).catch((error) =>
        logger.error('Could not apply popup interface language.', { error }),
      );
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
  }, [locale, settings.theme]);

  useEffect(() => {
    if (!pageLoaded) return;
    let failureReported = false;
    const timer = window.setInterval(() => {
      void sendToActiveTab('getPageTranslation', {})
        .then((snapshot) => {
          failureReported = false;
          setPage(snapshot);
        })
        .catch((error) => {
          if (!failureReported) {
            logger.warn('Lost contact with the active page.', { error });
            failureReported = true;
          }
          setPage(null);
        });
    }, 800);
    return () => window.clearInterval(timer);
  }, [pageLoaded]);

  async function updateSettings(
    patch: Partial<Omit<ExtensionSettings, 'schemaVersion'>>,
  ) {
    const next = await setSettings(patch);
    setSettingsState(next);
    if (
      page &&
      page.status !== 'idle' &&
      ('targetLanguage' in patch ||
        'activeProviderProfileId' in patch ||
        'providerProfiles' in patch)
    ) {
      await runCommand('startPageTranslation', {
        targetLanguage: next.targetLanguage,
        displayMode: page.displayMode,
        restart: true,
      });
    }
  }

  async function updateSitePolicy(policy: SiteTranslationPolicy) {
    setSitePolicy(policy);
    if (hostname !== '') {
      await userRuleStore.setTranslationPolicy(hostname, policy);
    }
  }

  async function runCommand<TName extends PageMessageName>(
    type: TName,
    payload: ExtensionMessages[TName]['request'],
  ) {
    setBusy(true);
    try {
      setPage(await sendToActiveTab(type, payload));
    } catch (error) {
      logger.error('Popup page command failed.', { command: type, error });
      setPage(null);
    } finally {
      setBusy(false);
    }
  }

  async function startTranslation() {
    await runCommand('startPageTranslation', {
      targetLanguage: settings.targetLanguage,
      displayMode: 'bilingual',
      contentScope: includePageInterface ? 'main-and-interface' : 'main',
      translateImmediately: false,
    });
  }

  async function retryTranslation() {
    await runCommand('updatePageTranslation', {
      displayMode: page?.displayMode ?? 'bilingual',
      retryFailed: true,
    });
  }

  function openSettings(section: SettingsSection) {
    if (onOpenSettings) {
      onOpenSettings(section);
    } else if (section === 'provider') {
      void openProviderSettings();
    } else {
      void browser.tabs.create({
        url: `${browser.runtime.getURL('/options.html')}#${section === 'reading' ? 'language' : section}-heading`,
      });
    }
  }

  const notice = resolvePopupNotice(
    settings,
    extensionStatus?.hostPermissionGranted ?? true,
    pageLoaded ? page : IDLE_SNAPSHOT,
  );
  const activeProvider = settings.providerProfiles.find(
    (profile) => profile.id === settings.activeProviderProfileId,
  );
  const translationNotice =
    notice?.kind === 'quota' ||
    notice?.kind === 'authentication' ||
    notice?.kind === 'rate-limit' ||
    notice?.kind === 'translation-error';
  const canUsePage = settingsLoaded && (!notice || translationNotice);

  const sourceLanguage =
    settings.sourceLanguage === 'auto'
      ? t('popup.language.source')
      : TRANSLATION_LANGUAGES.some(
            (language) => language === settings.sourceLanguage,
          )
        ? t(languageLabel(settings.sourceLanguage))
        : settings.sourceLanguage;

  return (
    <main className="popup" aria-busy={busy || !settingsLoaded}>
      <header className="popup-header">
        <div className="brand">
          <img
            className="brand-light"
            src="/brand/lingo-logo-ink.svg"
            alt="Lingo"
            width="88"
            height="28"
          />
          <img
            className="brand-dark"
            src="/brand/lingo-logo-white.svg"
            alt="Lingo"
            width="88"
            height="28"
          />
        </div>
        <button
          className="icon-button settings-button"
          type="button"
          title={t('common.openSettings')}
          aria-label={t('common.openSettings')}
          onClick={() => openSettings('provider')}
        >
          <PopupIcon name="settings" />
        </button>
      </header>

      <section className="current-page" aria-label={t('popup.currentPage')}>
        <div className="page-origin">
          <PopupIcon name="globe" />
          <span className="hostname" title={hostname || t('popup.currentPage')}>
            {hostname || t('popup.currentPage')}
          </span>
        </div>
        <div className="page-status" role="status" aria-live="polite">
          <span
            className={`status-dot status-${notice?.kind === 'no-service' ? 'setup' : (page?.status ?? 'loading')}`}
            aria-hidden="true"
          />
          <span>
            {!pageLoaded || !settingsLoaded
              ? t('popup.checkingPage')
              : notice?.kind === 'no-service'
                ? t('popup.noServiceSelected')
                : notice?.kind === 'disabled'
                  ? t(notice.titleKey)
                  : t(statusLabel(page))}
          </span>
          {page?.totalUnitCount ? (
            <span className="progress-count">
              {page.translatedUnitCount}/{page.totalUnitCount}
              {page.failedUnitCount > 0
                ? `, ${t('popup.failedCount', { count: page.failedUnitCount })}`
                : ''}
            </span>
          ) : null}
        </div>
      </section>

      <div className="popup-content">
        {settingsLoaded && notice ? (
          <section
            className={`notice notice-${notice.kind}`}
            aria-live="polite"
          >
            <h1>{t(notice.titleKey)}</h1>
            <p>
              {notice.kind === 'no-service'
                ? t('popup.setup.ownKey')
                : (notice.detail ??
                  (notice.messageKey ? t(notice.messageKey) : ''))}
            </p>
            {notice.action && (
              <button
                className="primary-action"
                type="button"
                disabled={busy}
                onClick={() =>
                  notice.action === 'retry-translation'
                    ? void retryTranslation()
                    : openSettings(
                        notice.kind === 'no-service' ||
                          notice.action === 'review-service'
                          ? 'provider'
                          : notice.kind === 'disabled'
                            ? 'reading'
                            : 'advanced',
                      )
                }
              >
                {notice.kind === 'no-service'
                  ? t('popup.setup.action')
                  : t(actionLabel(notice.action))}
                <PopupIcon name="arrow" />
              </button>
            )}
          </section>
        ) : null}
        {canUsePage && (
          <>
            {page?.status === 'idle' ? (
              <button
                className="primary-action main-command"
                type="button"
                disabled={busy || !pageLoaded}
                onClick={() => void startTranslation()}
              >
                {busy
                  ? t('popup.action.starting')
                  : t('popup.action.translatePage')}
                <PopupIcon name="arrow" />
              </button>
            ) : (
              <section
                className="session-controls"
                aria-label={t('popup.session.label')}
              >
                <fieldset className="segmented-control">
                  <legend>{t('popup.display.legend')}</legend>
                  {(['bilingual', 'translation', 'original'] as const).map(
                    (mode) => (
                      <button
                        type="button"
                        aria-pressed={page?.displayMode === mode}
                        disabled={busy}
                        onClick={() =>
                          runCommand('updatePageTranslation', {
                            displayMode: mode,
                          })
                        }
                        key={mode}
                      >
                        {t(displayModeLabel(mode))}
                      </button>
                    ),
                  )}
                </fieldset>
                <div
                  className={`command-row${translationNotice ? ' command-row-recovery' : ''}`}
                >
                  {!translationNotice && (
                    <button
                      className="primary-action"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runCommand('updatePageTranslation', {
                          displayMode: page?.displayMode ?? 'bilingual',
                          translateImmediately: true,
                        })
                      }
                    >
                      {t('popup.action.translateAll')}
                    </button>
                  )}
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => runCommand('stopPageTranslation', {})}
                  >
                    {t('popup.action.restore')}
                  </button>
                </div>
                {page && page.failedUnitCount > 0 && !translationNotice && (
                  <button
                    className="retry-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void retryTranslation()}
                  >
                    {t('popup.action.retryFailed', {
                      count: page.failedUnitCount,
                    })}
                  </button>
                )}
              </section>
            )}

            {activeProvider && settings.enabled && (
              <SubtitleControl
                hostname={hostname}
                serviceName={activeProvider.name}
              />
            )}

            <section
              className="translation-settings"
              aria-label={t('popup.options.label')}
            >
              <label className="popup-setting language-direction">
                <span className="setting-label">
                  {t('popup.targetLanguage')}
                </span>
                <span className="language-values">
                  <span className="source-language" title={sourceLanguage}>
                    {sourceLanguage}
                  </span>
                  <span className="direction-arrow" aria-hidden="true">
                    <PopupIcon name="arrow" />
                  </span>
                  <select
                    className="target-language"
                    aria-label={t('popup.targetLanguage')}
                    value={settings.targetLanguage}
                    disabled={busy}
                    onChange={(event) =>
                      void updateSettings({
                        targetLanguage: event.currentTarget.value,
                      })
                    }
                  >
                    {TRANSLATION_LANGUAGES.map((language) => (
                      <option value={language} key={language}>
                        {t(languageLabel(language))}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="popup-setting service-picker">
                <span className="setting-label">
                  {t('popup.translationService')}
                </span>
                <span className="service-value">
                  <span className="service-monogram" aria-hidden="true">
                    <ProviderIcon
                      presetId={
                        activeProvider
                          ? detectProviderPreset(activeProvider).id
                          : 'custom'
                      }
                      icon={activeProvider?.icon}
                      size={18}
                    />
                  </span>
                  <select
                    aria-label={t('popup.translationService')}
                    value={settings.activeProviderProfileId ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      void updateSettings({
                        activeProviderProfileId: event.currentTarget.value,
                      })
                    }
                  >
                    {settings.providerProfiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              {activeProvider?.model &&
              (activeProvider.models?.length ?? 0) > 0 ? (
                <label className="popup-setting popup-model-picker">
                  <span className="setting-label">
                    {t('popup.service.model')}
                  </span>
                  <select
                    aria-label={t('modelSetup.popupModel')}
                    title={activeProvider.model}
                    value={activeProvider.model}
                    disabled={busy}
                    onChange={(event) => {
                      const model = event.currentTarget.value;
                      void updateSettings({
                        providerProfiles: settings.providerProfiles.map(
                          (saved) =>
                            saved.id === activeProvider.id
                              ? { ...saved, model, modelSelection: 'manual' }
                              : saved,
                        ),
                      });
                    }}
                  >
                    {!activeProvider.models?.some(
                      (model) => model.id === activeProvider.model,
                    ) && (
                      <option value={activeProvider.model}>
                        {activeProvider.model}
                      </option>
                    )}
                    {activeProvider.models?.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : activeProvider?.model ? (
                <div className="popup-setting service-model">
                  <span className="setting-label">
                    {t('popup.service.model')}
                  </span>
                  <span title={activeProvider.model}>
                    {activeProvider.model}
                  </span>
                </div>
              ) : null}
            </section>
            <button
              className="reading-appearance-shortcut secondary-action"
              type="button"
              onClick={() => openSettings('reading')}
            >
              <PopupIcon name="sliders" />
              <span>{t('readingAppearance.title')}</span>
              <PopupIcon name={onOpenSettings ? 'arrow' : 'arrow-up'} />
            </button>
          </>
        )}

        <details className="page-preferences">
          <summary>
            <PopupIcon name="sliders" />
            <span>{t('popup.moreOptions')}</span>
            <span className="preferences-chevron" aria-hidden="true">
              <PopupIcon name="chevron" />
            </span>
          </summary>
          <section
            className="page-options"
            aria-label={t('popup.options.label')}
          >
            {settingsLoaded && !notice && (
              <>
                <label className="toggle-option">
                  <span>
                    {t('popup.translateInterface')}
                    <small>{t('popup.translateInterface.help')}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={includePageInterface}
                    disabled={page?.status !== 'idle'}
                    onChange={(event) =>
                      setIncludePageInterface(event.currentTarget.checked)
                    }
                  />
                  <span className="toggle-track" aria-hidden="true" />
                </label>
                <label className="site-policy">
                  <span>{t('popup.sitePolicy')}</span>
                  <select
                    value={sitePolicy}
                    disabled={hostname === '' || busy}
                    onChange={(event) =>
                      void updateSitePolicy(
                        event.currentTarget.value as SiteTranslationPolicy,
                      )
                    }
                  >
                    <option value="default">
                      {t('popup.sitePolicy.default')}
                    </option>
                    <option value="always">
                      {t('popup.sitePolicy.always')}
                    </option>
                    <option value="never">{t('popup.sitePolicy.never')}</option>
                  </select>
                </label>
              </>
            )}
            {activeProvider && (
              <button
                className="service-manage secondary-action"
                type="button"
                onClick={() => openSettings('provider')}
              >
                {t('popup.service.manage')}
                <PopupIcon name={onOpenSettings ? 'arrow' : 'arrow-up'} />
              </button>
            )}
            <button
              className="tools-shortcut secondary-action"
              type="button"
              onClick={() =>
                void browser.tabs.create({
                  url: browser.runtime.getURL('/translate.html'),
                })
              }
            >
              <PopupIcon name="text" />
              <span>{t('tools.menuOpen')}</span>
              <PopupIcon name="arrow-up" />
            </button>
          </section>
        </details>
        {activeProvider && (
          <footer className="data-flow">
            <PopupIcon name="lock" />
            <span>
              {t('popup.dataFlow.pageToProvider', {
                provider: activeProvider.name,
              })}
            </span>
          </footer>
        )}
      </div>
    </main>
  );
}

function openProviderSettings() {
  return browser.tabs.create({
    url: `${browser.runtime.getURL('/options.html')}#provider-heading`,
  });
}

type PageMessageName =
  | 'getPageTranslation'
  | 'startPageTranslation'
  | 'updatePageTranslation'
  | 'stopPageTranslation';

async function loadActivePage(): Promise<{
  hostname: string;
  snapshot: SessionSnapshot | null;
}> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let hostname = '';
  try {
    hostname = tab?.url ? new URL(tab.url).hostname : hostname;
  } catch (error) {
    logger.debug('Active tab URL is not a web origin.', { error });
    // Browser-internal URLs do not always parse as web origins.
  }
  if (tab?.id === undefined) return { hostname, snapshot: null };
  try {
    return {
      hostname,
      snapshot: await browser.tabs.sendMessage(
        tab.id,
        createMessage('getPageTranslation', {}),
        { frameId: 0 },
      ),
    };
  } catch (error) {
    logger.warn('Could not read translation state from the active page.', {
      error,
    });
    return { hostname, snapshot: null };
  }
}

async function sendToActiveTab<TName extends PageMessageName>(
  type: TName,
  payload: ExtensionMessages[TName]['request'],
): Promise<ExtensionMessages[TName]['response']> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab.');
  return browser.tabs.sendMessage(
    tab.id,
    createMessage(type, payload),
    type === 'getPageTranslation' ? { frameId: 0 } : undefined,
  );
}

function statusLabel(snapshot: SessionSnapshot | null): MessageKey {
  if (!snapshot) return 'popup.status.unavailable';
  if (snapshot.status === 'translating') return 'popup.status.translating';
  if (snapshot.status === 'translated' && snapshot.failedUnitCount > 0) {
    return 'popup.status.partial';
  }
  if (snapshot.status === 'translated') return 'popup.status.active';
  if (snapshot.status === 'failed') return 'popup.status.attention';
  return 'popup.status.ready';
}

function displayModeLabel(mode: SessionSnapshot['displayMode']): MessageKey {
  if (mode === 'bilingual') return 'popup.display.bilingual';
  if (mode === 'translation') return 'popup.display.translation';
  return 'popup.display.original';
}

function actionLabel(
  action: NonNullable<ReturnType<typeof resolvePopupNotice>>['action'],
): MessageKey {
  if (action === 'review-service') return 'popup.action.reviewService';
  if (action === 'retry-translation') return 'popup.action.retry';
  return 'common.openSettings';
}

export default App;

const TRANSLATION_LANGUAGES = [
  'zh-CN',
  'zh-TW',
  'en',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt-BR',
] as const;

function languageLabel(language: string): MessageKey {
  return TRANSLATION_LANGUAGES.includes(
    language as (typeof TRANSLATION_LANGUAGES)[number],
  )
    ? (`language.${language}` as MessageKey)
    : 'popup.language.source';
}

type PopupIconName =
  | 'settings'
  | 'globe'
  | 'arrow'
  | 'arrow-up'
  | 'lock'
  | 'sliders'
  | 'chevron'
  | 'text';

function PopupIcon({ name }: { name: PopupIconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'settings' && (
        <>
          <path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {name === 'globe' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" />
        </>
      )}
      {name === 'arrow' && <path d="M4 12h15m-6-6 6 6-6 6" />}
      {name === 'arrow-up' && <path d="M6 18 18 6M6 6h12v12" />}
      {name === 'lock' && (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
        </>
      )}
      {name === 'sliders' && (
        <>
          <path d="M4 7h6m4 0h6M4 17h10m4 0h2" />
          <circle cx="12" cy="7" r="2" />
          <circle cx="16" cy="17" r="2" />
        </>
      )}
      {name === 'chevron' && <path d="m6 9 6 6 6-6" />}
      {name === 'text' && <path d="M4 5h16M12 5v14M8 19h8M4 5v3m16-3v3" />}
    </svg>
  );
}
