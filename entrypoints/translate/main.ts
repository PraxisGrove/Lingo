import './style.css';
import {
  changeInterfaceLanguage,
  getBrowserInterfaceLocale,
  translate,
} from '@/lib/i18n/i18n';
import { createLogger } from '@/lib/logger/logger';
import { createTranslationPortClient } from '@/lib/messaging/translation-port';
import { getSettings, watchSettings } from '@/lib/storage/settings';
import { createTextTools } from '@/lib/ui/text-tools';

const logger = createLogger('text-window');
void initialize().catch((error) =>
  logger.error('Could not open text translation.', { error }),
);

async function initialize() {
  const settings = await getSettings();
  await changeInterfaceLanguage(settings.uiLocale);
  const tools = createTextTools({
    document,
    client: createTranslationPortClient(),
    getSettings,
    t: translate,
    openSettings: () => {
      void browser.runtime.openOptionsPage();
    },
    standalone: true,
  });
  tools.update(settings);
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.lang =
    settings.uiLocale === 'auto'
      ? getBrowserInterfaceLocale()
      : settings.uiLocale;
  tools.execute('open');
  const unwatch = watchSettings((next) => {
    void changeInterfaceLanguage(next.uiLocale)
      .then(() => {
        tools.update(next);
        document.documentElement.dataset.theme = next.theme;
        document.documentElement.lang =
          next.uiLocale === 'auto'
            ? getBrowserInterfaceLocale()
            : next.uiLocale;
      })
      .catch((error) =>
        logger.error('Could not update text translation.', { error }),
      );
  });
  window.addEventListener('pagehide', () => {
    unwatch();
    tools.dispose();
  });
}
