import { changeInterfaceLanguage, translate } from '@/lib/i18n/i18n';
import { createLogger } from '@/lib/logger/logger';
import { isExtensionMessage } from '@/lib/messaging/messages';
import { createTranslationPortClient } from '@/lib/messaging/translation-port';
import { startAutomaticTranslation } from '@/lib/page-translation/automatic-session';
import { createPageTranslation } from '@/lib/page-translation/page-translation';
import { getSettings, watchSettings } from '@/lib/storage/settings';
import { createFloatingPageControl } from '@/lib/ui/floating-page-control';
import './page-translation.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main() {
    const logger = createLogger('content');
    const client = createTranslationPortClient();
    const pageTranslation = createPageTranslation({
      document,
      translate: client.translate,
      logger,
    });
    const floatingControl = createFloatingPageControl({
      document,
      isTopFrame: window.top === window,
      pageTranslation,
      translate,
    });

    browser.runtime.onMessage.addListener((message) => {
      if (!isExtensionMessage(message)) return undefined;

      switch (message.type) {
        case 'getPageTranslation':
          return Promise.resolve(pageTranslation.snapshot());
        case 'startPageTranslation':
          return pageTranslation.start(message.payload);
        case 'updatePageTranslation':
          return pageTranslation.update(message.payload);
        case 'stopPageTranslation':
          return pageTranslation.stop().then(() => pageTranslation.snapshot());
        default:
          return undefined;
      }
    });

    void getSettings()
      .then(async (settings) => {
        await changeInterfaceLanguage(settings.uiLocale);
        floatingControl.update(settings);
      })
      .catch((error) => {
        logger.error('Could not initialize content settings.', { error });
      });
    const unwatchSettings = watchSettings((settings) => {
      void changeInterfaceLanguage(settings.uiLocale)
        .then(() => floatingControl.update(settings))
        .catch((error) => {
          logger.error('Could not apply updated content settings.', { error });
        });
    });
    void startAutomaticTranslation(pageTranslation, document).catch((error) => {
      logger.error('Automatic page translation failed.', { error });
    });

    window.addEventListener(
      'pagehide',
      () => {
        try {
          unwatchSettings();
          floatingControl.dispose();
          client.disconnect();
        } catch (error) {
          logger.warn('Content script cleanup was interrupted.', { error });
        }
      },
      { once: true },
    );
  },
});
