import { createLogger } from '@/lib/logger/logger';
import { isExtensionMessage } from '@/lib/messaging/messages';
import {
  serveTranslationPort,
  TRANSLATION_PORT_NAME,
} from '@/lib/messaging/translation-port';
import { createInMemoryProvider } from '@/lib/providers/in-memory';
import { createTranslationOrchestrator } from '@/lib/translation/orchestrator';

export default defineBackground(() => {
  const logger = createLogger('background');
  const orchestrator = createTranslationOrchestrator(createInMemoryProvider());

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

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== TRANSLATION_PORT_NAME) return;
    serveTranslationPort(port, orchestrator, (error) => {
      logger.error('Translation request failed.', { error });
    });
  });
});
