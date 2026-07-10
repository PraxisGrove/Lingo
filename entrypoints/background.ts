import { createLogger } from '@/lib/logger/logger';
import { isExtensionMessage } from '@/lib/messaging/messages';

export default defineBackground(() => {
  const logger = createLogger('background');

  logger.info('Background service worker started.');

  browser.runtime.onMessage.addListener((message) => {
    if (!isExtensionMessage(message)) {
      return undefined;
    }

    if (message.type === 'ping') {
      logger.debug('Received ping message.', {
        source: message.payload.source,
      });

      return Promise.resolve({
        ok: true,
        timestamp: Date.now(),
        extensionId: browser.runtime.id,
      });
    }

    return undefined;
  });
});
