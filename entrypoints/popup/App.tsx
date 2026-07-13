import { useEffect, useState } from 'react';
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
  const [settings, setSettingsState] =
    useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [page, setPage] = useState<SessionSnapshot | null>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [extensionStatus, setExtensionStatus] =
    useState<ExtensionStatus | null>(null);
  const [hostname, setHostname] = useState('Current page');
  const [sitePolicy, setSitePolicy] =
    useState<SiteTranslationPolicy>('default');
  const [includePageInterface, setIncludePageInterface] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettingsState);
    void sendMessage('getExtensionStatus', {}).then(setExtensionStatus);
    void loadActivePage().then(({ hostname: activeHostname, snapshot }) => {
      setHostname(activeHostname);
      setPage(snapshot);
      setPageLoaded(true);
      if (activeHostname !== 'Current page') {
        void userRuleStore
          .translationPolicyFor(activeHostname)
          .then(setSitePolicy);
      }
    });
    return watchSettings(setSettingsState);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    if (!pageLoaded) return;
    const timer = window.setInterval(() => {
      void sendToActiveTab('getPageTranslation', {})
        .then(setPage)
        .catch(() => setPage(null));
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
    if (hostname !== 'Current page') {
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
    } catch {
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
          <span className="hostname" title={hostname}>
            {hostname}
          </span>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Open settings"
          aria-label="Open settings"
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
        <span>{pageLoaded ? statusLabel(page) : 'Checking this page'}</span>
        {page?.totalUnitCount ? (
          <span className="progress-count">
            {page.translatedUnitCount}/{page.totalUnitCount}
            {page.failedUnitCount > 0 ? `, ${page.failedUnitCount} failed` : ''}
          </span>
        ) : null}
      </div>

      {notice ? (
        <section className={`notice notice-${notice.kind}`} aria-live="polite">
          <h1>{notice.title}</h1>
          <p>{notice.message}</p>
          {notice.action && (
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={() =>
                notice.action === 'Retry translation'
                  ? void retryTranslation()
                  : browser.runtime.openOptionsPage()
              }
            >
              {notice.action}
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
              {busy ? 'Starting translation' : 'Translate page'}
            </button>
          ) : (
            <section className="session-controls" aria-label="Page translation">
              <fieldset className="segmented-control">
                <legend>Display</legend>
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
                      {displayModeLabel(mode)}
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
                  Translate all
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => runCommand('stopPageTranslation', {})}
                >
                  Restore original
                </button>
              </div>
              {page && page.failedUnitCount > 0 && (
                <button
                  className="retry-action"
                  type="button"
                  disabled={busy}
                  onClick={() => void retryTranslation()}
                >
                  Retry {page.failedUnitCount} failed paragraphs
                </button>
              )}
            </section>
          )}

          <section className="page-options" aria-label="Current page options">
            <label>
              <span>Target language</span>
              <select
                value={settings.targetLanguage}
                onChange={(event) =>
                  void updateSettings({
                    targetLanguage: event.currentTarget.value,
                  })
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
            <label className="toggle-option">
              <span>
                Translate page interface
                <small>
                  Include navigation, buttons, headers, and footers.
                </small>
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
              <span>Translation service</span>
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
              <span>Site policy</span>
              <select
                value={sitePolicy}
                onChange={(event) =>
                  void updateSitePolicy(
                    event.currentTarget.value as SiteTranslationPolicy,
                  )
                }
              >
                <option value="default">Follow default</option>
                <option value="always">Always translate</option>
                <option value="never">Never translate</option>
              </select>
            </label>
          </section>
        </>
      )}

      <footer className="data-flow">
        <span>Data flow</span>
        <strong>
          This page → {activeProvider?.name ?? 'No service selected'}
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
  let hostname = 'Current page';
  try {
    hostname = tab?.url
      ? new URL(tab.url).hostname || 'Current page'
      : hostname;
  } catch {
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
  } catch {
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

function statusLabel(snapshot: SessionSnapshot | null): string {
  if (!snapshot) return 'Page unavailable';
  if (snapshot.status === 'translating') return 'Translating visible content';
  if (snapshot.status === 'translated' && snapshot.failedUnitCount > 0) {
    return 'Translation active with partial failures';
  }
  if (snapshot.status === 'translated') return 'Translation active';
  if (snapshot.status === 'failed') return 'Translation needs attention';
  return 'Ready to translate';
}

function displayModeLabel(mode: SessionSnapshot['displayMode']): string {
  if (mode === 'bilingual') return 'Bilingual';
  if (mode === 'translation') return 'Translation';
  return 'Original';
}

export default App;
