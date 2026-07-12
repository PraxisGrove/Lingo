// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  createTranslationPortClient,
  serveTranslationPort,
  TRANSLATION_PORT_NAME,
  type TranslationRuntimePort,
} from '../messaging/translation-port';
import { createInMemoryProvider } from '../providers/in-memory';
import {
  createTranslationOrchestrator,
  type TranslationProvider,
} from '../translation/orchestrator';
import { createPageTranslation } from './page-translation';

describe('translation port flow', () => {
  it('translates and restores a static article through the long-lived port', async () => {
    document.body.innerHTML = '<article><p>Hello over the port.</p></article>';
    const observedMessages: unknown[] = [];
    const [contentPort, backgroundPort] = createPortPair(observedMessages);
    const testCredential = 'provider-secret-sentinel';
    serveTranslationPort(
      backgroundPort,
      createTranslationOrchestrator(providerWithCredential(testCredential)),
      (error) => {
        throw error;
      },
    );
    const client = createTranslationPortClient(() => contentPort);
    const pageTranslation = createPageTranslation({
      document,
      translate: client.translate,
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });
    expect(document.body.textContent).toContain('[zh-CN] Hello over the port.');
    expect(JSON.stringify(observedMessages)).not.toContain(testCredential);
    expect(document.documentElement.outerHTML).not.toContain(testCredential);

    await pageTranslation.stop();
    expect(document.body.innerHTML).toBe(
      '<article><p>Hello over the port.</p></article>',
    );
    client.disconnect();
  });
});

function providerWithCredential(credential: string): TranslationProvider {
  const provider = createInMemoryProvider();
  return {
    capabilities: provider.capabilities,
    async translateBatch(input) {
      if (credential.length === 0) throw new Error('Missing test credential.');
      return provider.translateBatch(input);
    },
  };
}

function createPortPair(
  observedMessages: unknown[],
): [TranslationRuntimePort, TranslationRuntimePort] {
  const contentListeners = new Set<(message: unknown) => void>();
  const backgroundListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  let disconnected = false;

  const createPort = (
    ownListeners: Set<(message: unknown) => void>,
    peerListeners: Set<(message: unknown) => void>,
  ): TranslationRuntimePort => ({
    name: TRANSLATION_PORT_NAME,
    onMessage: {
      addListener: (listener) => ownListeners.add(listener),
      removeListener: (listener) => ownListeners.delete(listener),
    },
    onDisconnect: {
      addListener: (listener) => disconnectListeners.add(listener),
      removeListener: (listener) => disconnectListeners.delete(listener),
    },
    postMessage(message) {
      if (disconnected) throw new Error('Port disconnected.');
      observedMessages.push(message);
      queueMicrotask(() => {
        for (const listener of peerListeners) listener(message);
      });
    },
    disconnect() {
      disconnected = true;
      for (const listener of disconnectListeners) listener();
      contentListeners.clear();
      backgroundListeners.clear();
      disconnectListeners.clear();
    },
  });

  return [
    createPort(contentListeners, backgroundListeners),
    createPort(backgroundListeners, contentListeners),
  ];
}
