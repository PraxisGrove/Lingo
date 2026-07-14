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

function App() {
  const { locale, t } = useInterfaceTranslation();
  const [settings, setSettingsState] =
    useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [page, setPage] = useState<SessionSnapshot | null>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
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
        await changeInterfaceLanguage(loadedSettings.uiLocale);
      })
      .catch((error) =>
        logger.error('Could not load popup settings.', { error }),
      );
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
    setSettingsState(await setSettings(patch));
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

  const notice = resolvePopupNotice(
    settings,
    extensionStatus?.hostPermissionGranted ?? true,
    pageLoaded ? page : IDLE_SNAPSHOT,
  );
  const activeProvider = settings.providerProfiles.find(
    (profile) => profile.id === settings.activeProviderProfileId,
  );

  return (
    <main className="popup" aria-busy={busy}>
      <header className="popup-header">
        <div>
          <strong className="brand">Lingo</strong>
          <span className="hostname" title={hostname || t('popup.currentPage')}>
            {hostname || t('popup.currentPage')}
          </span>
        </div>
        <button
          className="icon-button"
          type="button"
          title={t('common.openSettings')}
          aria-label={t('common.openSettings')}
          onClick={() => browser.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </header>

      <div className="page-status" role="status" aria-live="polite">
        <span
          className={`status-dot status-${page?.status ?? 'loading'}`}
          aria-hidden="true"
        />
        <span>
          {pageLoaded ? t(statusLabel(page)) : t('popup.checkingPage')}
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

      {notice ? (
        <section className={`notice notice-${notice.kind}`} aria-live="polite">
          <h1>{t(notice.titleKey)}</h1>
          <p>
            {notice.detail ?? (notice.messageKey ? t(notice.messageKey) : '')}
          </p>
          {notice.action && (
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={() =>
                notice.action === 'retry-translation'
                  ? void retryTranslation()
                  : browser.runtime.openOptionsPage()
              }
            >
              {t(actionLabel(notice.action))}
            </button>
          )}
        </section>
      ) : (
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
              <div className="command-row">
                <button
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
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => runCommand('stopPageTranslation', {})}
                >
                  {t('popup.action.restore')}
                </button>
              </div>
              {page && page.failedUnitCount > 0 && (
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

          <section
            className="page-options"
            aria-label={t('popup.options.label')}
          >
            <label>
              <span>{t('popup.targetLanguage')}</span>
              <select
                value={settings.targetLanguage}
                onChange={(event) =>
                  void updateSettings({
                    targetLanguage: event.currentTarget.value,
                  })
                }
              >
                <option value="zh-CN">{t('language.zh-CN')}</option>
                <option value="zh-TW">{t('language.zh-TW')}</option>
                <option value="en">{t('language.en')}</option>
                <option value="ja">{t('language.ja')}</option>
                <option value="ko">{t('language.ko')}</option>
                <option value="de">{t('language.de')}</option>
                <option value="fr">{t('language.fr')}</option>
                <option value="es">{t('language.es')}</option>
                <option value="pt-BR">{t('language.pt-BR')}</option>
              </select>
            </label>
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
            </label>
            <label>
              <span>{t('popup.translationService')}</span>
              <select
                value={settings.activeProviderProfileId ?? ''}
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
            </label>
            <label>
              <span>{t('popup.sitePolicy')}</span>
              <select
                value={sitePolicy}
                onChange={(event) =>
                  void updateSitePolicy(
                    event.currentTarget.value as SiteTranslationPolicy,
                  )
                }
              >
                <option value="default">{t('popup.sitePolicy.default')}</option>
                <option value="always">{t('popup.sitePolicy.always')}</option>
                <option value="never">{t('popup.sitePolicy.never')}</option>
              </select>
            </label>
          </section>
        </>
      )}

      <footer className="data-flow">
        <span>{t('popup.dataFlow')}</span>
        <strong>
          {t('popup.dataFlow.pageToProvider', {
            provider: activeProvider?.name ?? t('popup.noServiceSelected'),
          })}
        </strong>
      </footer>
    </main>
  );
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
  return browser.tabs.sendMessage(tab.id, createMessage(type, payload));
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
