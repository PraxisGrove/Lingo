import { createLogger } from '@/lib/logger/logger';
import { isExtensionMessage } from '@/lib/messaging/messages';
import {
  serveTranslationPort,
  TRANSLATION_PORT_NAME,
} from '@/lib/messaging/translation-port';
import { activeProvider, saveProviderProfile, testProviderProfile } from '@/lib/providers/provider-service';
import { createTranslationOrchestrator } from '@/lib/translation/orchestrator';

export default defineBackground(() => {
  const logger = createLogger('background');
  const orchestrator = createTranslationOrchestrator(activeProvider);

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

    if (message.type === 'saveProviderProfile') {
      return (async () => {
        await saveProviderProfile(message.payload.profile, message.payload.credential);
        return { ok: true as const };
      })();
    }

    if (message.type === 'testProviderConnection') {
      return (async () => {
        return testProviderProfile(message.payload.profile, message.payload.credential);
      })();
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
