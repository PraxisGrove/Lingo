import { useEffect, useState } from 'react';
import {
  createMessage,
  type ExtensionMessages,
} from '@/lib/messaging/messages';
import type { SessionSnapshot } from '@/lib/page-translation/page-translation';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  getSettings,
  watchSettings,
} from '@/lib/storage/settings';
import './App.css';

const IDLE_SNAPSHOT: SessionSnapshot = {
  status: 'idle',
  displayMode: 'bilingual',
  translatedUnitCount: 0,
  pageRevision: 0,
};

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [page, setPage] = useState<SessionSnapshot>(IDLE_SNAPSHOT);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
    void sendToActiveTab('getPageTranslation', {})
      .then(setPage)
      .catch(() => setError('Lingo cannot translate this browser page.'));
    return watchSettings(setSettings);
  }, []);

  async function runCommand<TName extends PageMessageName>(
    type: TName,
    payload: ExtensionMessages[TName]['request'],
  ) {
    setBusy(true);
    setError('');
    try {
      setPage(await sendToActiveTab(type, payload));
    } catch {
      setError('This page did not respond. Reload it and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="popup">
      <header>
        <div className="brand">Lingo</div>
        <button
          className="settings-button"
          type="button"
          title="Open settings"
          aria-label="Open settings"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </header>
      <div className="page-status">
        <span className={`status-dot status-${page.status}`} />
        <span>{statusLabel(page)}</span>
      </div>
      {page.status === 'idle' ? (
        <button
          className="primary-action"
          type="button"
          disabled={busy || !settings.enabled || Boolean(error)}
          onClick={() =>
            runCommand('startPageTranslation', {
              targetLanguage: settings.targetLanguage,
              displayMode: 'bilingual',
              translateImmediately: false,
            })
          }
        >
          {busy ? 'Translating…' : 'Translate page'}
        </button>
      ) : (
        <>
          <fieldset
            className="display-modes"
            aria-label="Translation display mode"
          >
            {(['bilingual', 'translation', 'original'] as const).map((mode) => (
              <button
                type="button"
                aria-pressed={page.displayMode === mode}
                disabled={busy}
                onClick={() =>
                  runCommand('updatePageTranslation', { displayMode: mode })
                }
                key={mode}
              >
                {mode === 'bilingual'
                  ? 'Bilingual'
                  : mode === 'translation'
                    ? 'Translation'
                    : 'Original'}
              </button>
            ))}
          </fieldset>
          <button
            className="primary-action"
            type="button"
            disabled={busy}
            onClick={() =>
              runCommand('updatePageTranslation', {
                displayMode: page.displayMode,
                translateImmediately: true,
              })
            }
          >
            Translate to bottom
          </button>
          <button
            className="restore-action"
            type="button"
            disabled={busy}
            onClick={() => runCommand('stopPageTranslation', {})}
          >
            Stop and restore
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

type PageMessageName =
  | 'getPageTranslation'
  | 'startPageTranslation'
  | 'updatePageTranslation'
  | 'stopPageTranslation';

async function sendToActiveTab<TName extends PageMessageName>(
  type: TName,
  payload: ExtensionMessages[TName]['request'],
): Promise<ExtensionMessages[TName]['response']> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab.');
  return browser.tabs.sendMessage(tab.id, createMessage(type, payload));
}

function statusLabel(snapshot: SessionSnapshot): string {
  if (snapshot.status === 'translating') return 'Translating page';
  if (snapshot.status === 'translated') {
    return `${snapshot.translatedUnitCount} paragraphs translated`;
  }
  return 'Ready to translate';
}

export default App;
