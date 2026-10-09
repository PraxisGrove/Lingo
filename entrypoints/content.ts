import { changeInterfaceLanguage, translate } from '@/lib/i18n/i18n';
import { createLogger } from '@/lib/logger/logger';
import { isExtensionMessage } from '@/lib/messaging/messages';
import { sendMessage } from '@/lib/messaging/send-message';
import { createTranslationPortClient } from '@/lib/messaging/translation-port';
import { startAutomaticTranslation } from '@/lib/page-translation/automatic-session';
import { createPageTranslation } from '@/lib/page-translation/page-translation';
import { getPageRules } from '@/lib/rules/page-rules';
import { getSettings, watchSettings } from '@/lib/storage/settings';
import { createFloatingPageControl } from '@/lib/ui/floating-page-control';
import { createTextTools } from '@/lib/ui/text-tools';
import './page-translation.css';
import pageTranslationStyle from './page-translation.css?inline';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main() {
    const logger = createLogger('content');
    const client = createTranslationPortClient();
    let onNavigation = () => {};
    const pageTranslation = createPageTranslation({
      document,
      shadowStyle: pageTranslationStyle,
      translate: client.translate,
      cancel: client.cancel,
      getRuleSelectors: async () =>
        (await getPageRules(location.hostname)).selectors,
      watchNavigation: (listener) => {
        onNavigation = listener;
        return () => {
          onNavigation = () => {};
        };
      },
      logger,
    });
    const textTools = createTextTools({
      document,
      client: createTranslationPortClient(),
      getSettings,
      t: translate,
      getRuleSelectors: async () =>
        (await getPageRules(location.hostname)).selectors,
      openSettings: () => {
        void sendMessage('openSettings', {}).catch((error) =>
          logger.error('Could not open settings.', { error }),
        );
      },
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
        case 'runTextAction':
          textTools.execute(message.payload.action);
          return Promise.resolve({ ok: true });
        case 'pageNavigation':
          textTools.suspend();
          onNavigation();
          return Promise.resolve(pageTranslation.snapshot());
        case 'getPageTranslation':
          return Promise.resolve(pageTranslation.snapshot());
        case 'startPageTranslation':
          void pageTranslation.start(message.payload).catch((error) => {
            logger.error('Could not start page translation.', { error });
          });
          return Promise.resolve(pageTranslation.snapshot());
        case 'updatePageTranslation':
          void pageTranslation.update(message.payload).catch((error) => {
            logger.error('Could not update page translation.', { error });
          });
          return Promise.resolve(pageTranslation.snapshot());
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
        textTools.update(settings);
      })
      .catch((error) => {
        logger.error('Could not initialize content settings.', { error });
      });
    const unwatchSettings = watchSettings((settings) => {
      void changeInterfaceLanguage(settings.uiLocale)
        .then(() => {
          floatingControl.update(settings);
          textTools.update(settings);
        })
        .catch((error) => {
          logger.error('Could not apply updated content settings.', { error });
        });
    });
    void startAutomaticTranslation(pageTranslation, document).catch((error) => {
      logger.error('Automatic page translation failed.', { error });
    });

    window.addEventListener('pagehide', (event) => {
      if (event.persisted) {
        textTools.suspend();
        void pageTranslation.stop();
        return;
      }
      try {
        unwatchSettings();
        floatingControl.dispose();
        textTools.dispose();
        client.disconnect();
      } catch (error) {
        logger.warn('Content script cleanup was interrupted.', { error });
      }
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        void startAutomaticTranslation(pageTranslation, document).catch(
          (error) => {
            logger.error('Could not restore automatic page translation.', {
              error,
            });
          },
        );
      }
    });
  },
});
