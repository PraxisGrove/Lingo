import { isExtensionMessage } from '@/lib/messaging/messages';
import { createTranslationPortClient } from '@/lib/messaging/translation-port';
import { createPageTranslation } from '@/lib/page-translation/page-translation';
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

    window.addEventListener('pagehide', () => client.disconnect(), {
      once: true,
    });
  },
});
