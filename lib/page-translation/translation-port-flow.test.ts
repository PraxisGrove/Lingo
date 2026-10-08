// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
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
  it('renders the first completed batch while a later batch is still pending', async () => {
    document.body.innerHTML =
      '<main><p>Fast paragraph.</p><p>Slow paragraph.</p></main>';
    const provider = createInMemoryProvider();
    let release: (() => void) | undefined;
    const [contentPort, backgroundPort] = createPortPair([]);
    serveTranslationPort(
      backgroundPort,
      createTranslationOrchestrator({
        ...provider,
        capabilities: { ...provider.capabilities, maxBatchSize: 1 },
        async translateBatch(input) {
          if (input.units[0].text === 'Slow paragraph.')
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return provider.translateBatch(input);
        },
      }),
      (error) => {
        throw error;
      },
    );
    const client = createTranslationPortClient(() => contentPort);
    const session = createPageTranslation({
      document,
      translate: client.translate,
      cancel: client.cancel,
    });
    const started = session.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });
    try {
      await vi.waitFor(() =>
        expect(
          document.querySelector('[data-lingo-translation]')?.textContent,
        ).toBe('[zh-CN] Fast paragraph.'),
      );
      expect(session.snapshot()).toMatchObject({
        status: 'translating',
        translatedUnitCount: 1,
        totalUnitCount: 2,
      });
      release?.();
      await started;
      expect(session.snapshot()).toMatchObject({
        status: 'translated',
        translatedUnitCount: 2,
      });
    } finally {
      release?.();
      await session.stop();
      client.disconnect();
    }
  });

  it('uses saved source language for provider requests across the port', async () => {
    const [contentPort, backgroundPort] = createPortPair([]);
    const provider = createInMemoryProvider();
    const translateBatch = vi.fn(provider.translateBatch);
    serveTranslationPort(
      backgroundPort,
      createTranslationOrchestrator(
        { ...provider, translateBatch },
        {
          sourceLanguage: async () => 'ja',
        },
      ),
      (error) => {
        throw error;
      },
    );
    const client = createTranslationPortClient(() => contentPort);
    await client.translate(
      [{ id: '1', number: 1, text: 'こんにちは' }],
      'zh-CN',
    );
    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLanguage: 'ja',
        targetLanguage: 'zh-CN',
      }),
    );
    client.disconnect();
  });

  it('stops queued batches, aborts the pending request, and can start again', async () => {
    document.body.innerHTML = '<main><p>First.</p><p>Second.</p></main>';
    const provider = createInMemoryProvider();
    let signal: AbortSignal | undefined;
    const translateBatch = vi
      .fn<TranslationProvider['translateBatch']>()
      .mockImplementationOnce((input) => {
        signal = input.signal;
        return new Promise(() => {});
      })
      .mockImplementation(provider.translateBatch);
    const orchestrator = createTranslationOrchestrator(
      {
        ...provider,
        capabilities: { ...provider.capabilities, maxBatchSize: 1 },
        translateBatch,
      },
      { maxConcurrentBatches: 1 },
    );
    const onError = vi.fn();
    const connect = vi.fn(() => {
      const [contentPort, backgroundPort] = createPortPair([]);
      serveTranslationPort(backgroundPort, orchestrator, onError);
      return contentPort;
    });
    const client = createTranslationPortClient(connect);
    const session = createPageTranslation({
      document,
      translate: client.translate,
      cancel: client.cancel,
    });
    const options = {
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual' as const,
    };
    const started = session.start(options);
    await vi.waitFor(() => expect(translateBatch).toHaveBeenCalledTimes(1));

    await session.stop();
    await started;
    expect(signal?.aborted).toBe(true);
    expect(session.snapshot().status).toBe('idle');
    expect(document.querySelector('[data-lingo-translation]')).toBeNull();
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    await session.start(options);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(session.snapshot().translatedUnitCount).toBe(2);
    await session.stop();
    client.disconnect();
  });

  it('keeps primary results while completing an explicitly configured fallback', async () => {
    const [contentPort, backgroundPort] = createPortPair([]);
    const fallback = createInMemoryProvider();
    const primary: TranslationProvider = {
      capabilities: { ...fallback.capabilities, maxBatchSize: 1 },
      async translateBatch({ units }) {
        if (units[0].id === 'paragraph-2') {
          throw Object.assign(new Error('Primary quota exhausted.'), {
            category: 'quota',
          });
        }
        return units.map((unit) => ({ ...unit, text: 'Primary translation.' }));
      },
    };
    serveTranslationPort(
      backgroundPort,
      createTranslationOrchestrator(primary, { fallbackProviders: [fallback] }),
      (error) => {
        throw error;
      },
    );
    const client = createTranslationPortClient(() => contentPort);

    await expect(
      client.translate(
        [
          { id: 'paragraph-1', number: 1, text: 'First paragraph.' },
          { id: 'paragraph-2', number: 2, text: 'Second paragraph.' },
        ],
        'zh-CN',
      ),
    ).resolves.toEqual([
      { id: 'paragraph-1', number: 1, text: 'Primary translation.' },
      { id: 'paragraph-2', number: 2, text: '[zh-CN] Second paragraph.' },
    ]);
    client.disconnect();
  });

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

  it('returns a recoverable page failure when no provider can be resolved', async () => {
    document.body.innerHTML =
      '<article><p>Hello without a provider.</p></article>';
    const [contentPort, backgroundPort] = createPortPair([]);
    serveTranslationPort(
      backgroundPort,
      createTranslationOrchestrator(async () => {
        throw Object.assign(
          new Error('Configure a translation service first.'),
          {
            category: 'invalid-request',
          },
        );
      }),
      () => undefined,
    );
    const client = createTranslationPortClient(() => contentPort);
    const pageTranslation = createPageTranslation({
      document,
      translate: client.translate,
    });

    await expect(
      pageTranslation.start({
        targetLanguage: 'zh-CN',
        displayMode: 'bilingual',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failure: {
        category: 'invalid-request',
        message: 'Configure a translation service first.',
      },
    });
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
