import {
  createPageActions,
  PAGE_CONTEXT_MENUS,
} from '@/lib/browser/page-actions';
import {
  createConditionalTranslationCache,
  createTranslationCache,
} from '@/lib/cache/translation-cache';
import { createDiagnosticReport } from '@/lib/diagnostics/diagnostics';
import { createLogger } from '@/lib/logger/logger';
import { createMessage, isExtensionMessage } from '@/lib/messaging/messages';
import {
  serveTranslationPort,
  TRANSLATION_PORT_NAME,
} from '@/lib/messaging/translation-port';
import {
  deleteProviderProfile,
  getActiveProviderChain,
  saveProviderProfile,
  testProviderProfile,
} from '@/lib/providers/provider-service';
import { getSettings } from '@/lib/storage/settings';
import { createTranslationOrchestrator } from '@/lib/translation/orchestrator';
import { resolveRequestQuality } from '@/lib/translation/request-quality';

export default defineBackground(() => {
  const logger = createLogger('background');
  const translationCache = createTranslationCache();
  const orchestrator = createTranslationOrchestrator(getActiveProviderChain, {
    cache: createConditionalTranslationCache(
      translationCache,
      async () => (await getSettings()).translationCacheEnabled,
    ),
    quality: async (request) => {
      const settings = await getSettings();
      return resolveRequestQuality(settings, request.siteHostname);
    },
  });
  const pageActions = createPageActions({
    async getActiveTabId() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.id;
    },
    getTargetLanguage: async () => (await getSettings()).targetLanguage,
    getSnapshot: (tabId) =>
      browser.tabs.sendMessage(tabId, createMessage('getPageTranslation', {})),
    start: (tabId, options) =>
      browser.tabs.sendMessage(
        tabId,
        createMessage('startPageTranslation', options),
      ),
    update: (tabId, patch) =>
      browser.tabs.sendMessage(
        tabId,
        createMessage('updatePageTranslation', patch),
      ),
    stop: (tabId) =>
      browser.tabs.sendMessage(tabId, createMessage('stopPageTranslation', {})),
  });

  logger.info('Background service worker started.');

  browser.runtime.onInstalled.addListener(() => {
    void installContextMenus().catch((error) => {
      logger.error('Could not install context menus.', { error });
    });
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-page-translation') return;
    void pageActions
      .run('toggle')
      .catch((error) =>
        logger.error('Keyboard translation command failed.', { error }),
      );
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id === undefined) return;
    const item = PAGE_CONTEXT_MENUS.find(
      (candidate) => candidate.id === info.menuItemId,
    );
    if (!item) return;
    void pageActions.run(item.action, tab.id).catch((error) => {
      logger.error('Context menu translation command failed.', { error });
    });
  });

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
        await saveProviderProfile(
          message.payload.profile,
          message.payload.credential,
        );
        return { ok: true as const };
      })();
    }

    if (message.type === 'testProviderConnection') {
      return (async () => {
        return testProviderProfile(
          message.payload.profile,
          message.payload.credential,
        );
      })();
    }

    if (message.type === 'deleteProviderProfile') {
      return deleteProviderProfile(message.payload.profileId).then(() => ({
        ok: true as const,
      }));
    }

    if (message.type === 'clearTranslationCache') {
      return translationCache.clear().then(() => ({ ok: true as const }));
    }

    if (message.type === 'getExtensionStatus') {
      return Promise.all([hasHostPermission(), translationCache.stats()]).then(
        ([hostPermissionGranted, cache]) => ({
          hostPermissionGranted,
          cache,
        }),
      );
    }

    if (message.type === 'exportDiagnostics') {
      return Promise.all([
        getSettings(),
        hasHostPermission(),
        translationCache.stats(),
      ]).then(([settings, hostPermissionGranted, cache]) =>
        createDiagnosticReport({
          extensionVersion: browser.runtime.getManifest().version,
          generatedAt: new Date().toISOString(),
          hostPermissionGranted,
          cache,
          settings,
        }),
      );
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

async function hasHostPermission(): Promise<boolean> {
  return browser.permissions.contains({ origins: ['<all_urls>'] });
}

async function installContextMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  for (const item of PAGE_CONTEXT_MENUS) {
    browser.contextMenus.create({
      id: item.id,
      title: item.title,
      contexts: ['page'],
    });
  }
}
