import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger/logger';
import { sendMessage } from '@/lib/messaging/send-message';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  getSettings,
  watchSettings,
} from '@/lib/storage/settings';
import './App.css';

const logger = createLogger('popup');

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [lastPing, setLastPing] = useState<string>('Not checked yet');

  useEffect(() => {
    void getSettings().then(setSettings);
    return watchSettings(setSettings);
  }, []);

  async function pingBackground() {
    try {
      const response = await sendMessage('ping', { source: 'popup' });
      setLastPing(new Date(response.timestamp).toLocaleTimeString());
      logger.debug('Background ping succeeded.', {
        extensionId: response.extensionId,
      });
    } catch (error) {
      logger.error('Background ping failed.', { error });
      setLastPing('Failed');
    }
  }

  return (
    <main className="popup">
      <div className="badge">WXT</div>
      <h1>Browser Extension</h1>
      <p>
        A typed starter for popup, options, background, content script,
        messaging, and storage workflows.
      </p>
      <dl className="settings">
        <div>
          <dt>Status</dt>
          <dd>{settings.enabled ? 'Enabled' : 'Disabled'}</dd>
        </div>
        <div>
          <dt>Theme</dt>
          <dd>{settings.theme}</dd>
        </div>
        <div>
          <dt>Background</dt>
          <dd>{lastPing}</dd>
        </div>
      </dl>
      <div className="actions">
        <button type="button" onClick={pingBackground}>
          Ping
        </button>
        <button type="button" onClick={() => browser.runtime.openOptionsPage()}>
          Options
        </button>
      </div>
    </main>
  );
}

export default App;
