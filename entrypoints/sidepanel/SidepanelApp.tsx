import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger/logger';
import type { SettingsSection } from '@/lib/ui/settings-section';
import OptionsApp from '../options/OptionsApp';
import App from '../popup/App';
import './SidepanelApp.css';

const logger = createLogger('sidepanel');

export default function SidepanelApp() {
  const [activePage, setActivePage] = useState<string | null>(null);
  const [settingsView, setSettingsView] = useState<{
    section: SettingsSection;
    open: boolean;
  } | null>(null);

  useEffect(() => {
    let revision = 0;
    async function synchronize() {
      const current = ++revision;
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (current === revision)
          setActivePage(`${tab?.id ?? 'none'}:${tab?.url ?? ''}`);
      } catch (error) {
        logger.warn('Could not inspect the active reading tab.', { error });
      }
    }
    const activated = () => void synchronize();
    const updated = (
      _tabId: number,
      change: { url?: string; status?: string },
    ) => {
      if (change.url || change.status === 'complete') void synchronize();
    };
    browser.tabs.onActivated.addListener(activated);
    browser.tabs.onUpdated.addListener(updated);
    void synchronize();
    return () => {
      revision += 1;
      browser.tabs.onActivated.removeListener(activated);
      browser.tabs.onUpdated.removeListener(updated);
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    const heading = document.querySelector<HTMLElement>(
      settingsView?.open ? '.settings-back' : '.settings-button',
    );
    heading?.focus({ preventScroll: true });
  }, [settingsView?.open]);

  return (
    <>
      {settingsView && (
        // Keep unfinished settings in memory while reading or changing tabs.
        // A successful save disposes this view and clears its credential draft.
        <div hidden={!settingsView.open}>
          <OptionsApp
            embedded
            activeSection={settingsView.section}
            onSectionChange={(section) =>
              setSettingsView({ section, open: true })
            }
            onBack={() => setSettingsView({ ...settingsView, open: false })}
            onConnected={() => setSettingsView(null)}
          />
        </div>
      )}
      {!settingsView?.open && activePage !== null && (
        <App
          key={activePage}
          onOpenSettings={(section) => setSettingsView({ section, open: true })}
        />
      )}
    </>
  );
}
