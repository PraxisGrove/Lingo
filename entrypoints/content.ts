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
    const client = createTranslationPortClient();
    const pageTranslation = createPageTranslation({
      document,
      translate: client.translate,
    });
    const floatingControl = createFloatingPageControl({
      document,
      isTopFrame: window.top === window,
      pageTranslation,
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

    void getSettings().then((settings) => floatingControl.update(settings));
    const unwatchSettings = watchSettings((settings) =>
      floatingControl.update(settings),
    );
    void startAutomaticTranslation(pageTranslation, document).catch(
      () => undefined,
    );

    window.addEventListener(
      'pagehide',
      () => {
        unwatchSettings();
        floatingControl.dispose();
        client.disconnect();
      },
      { once: true },
    );
  },
});
