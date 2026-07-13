import { describe, expect, it } from 'vitest';
import {
  createTranslationPortClient,
  isTranslationPortRequest,
  isTranslationPortResponse,
  TRANSLATION_PORT_NAME,
  type TranslationRuntimePort,
} from './translation-port';

describe('translation port protocol', () => {
  it('requires a stable paragraph number for every translation unit', () => {
    expect(
      isTranslationPortRequest({
        type: 'translate',
        request: {
          sessionId: 'session-1',
          pageRevision: 0,
          sourceLanguage: 'auto',
          targetLanguage: 'zh-CN',
          units: [{ id: 'paragraph-1', number: 1, text: 'Hello world.' }],
        },
      }),
    ).toBe(true);
    expect(
      isTranslationPortRequest({
        type: 'translate',
        request: {
          sessionId: 'session-1',
          pageRevision: 0,
          sourceLanguage: 'auto',
          targetLanguage: 'zh-CN',
          units: [{ id: 'paragraph-1', text: 'Hello world.' }],
        },
      }),
    ).toBe(false);
  });

  it('accepts a versioned translation request without credentials', () => {
    expect(TRANSLATION_PORT_NAME).toBe('lingo-translation-v3');
    expect(
      isTranslationPortRequest({
        type: 'translate',
        request: {
          sessionId: 'session-1',
          pageRevision: 0,
          sourceLanguage: 'auto',
          targetLanguage: 'zh-CN',
          units: [{ id: 'paragraph-1', number: 1, text: 'Hello world.' }],
        },
      }),
    ).toBe(true);
  });

  it('rejects requests that attempt to send credentials from the page side', () => {
    expect(
      isTranslationPortRequest({
        type: 'translate',
        request: {
          sessionId: 'session-1',
          pageRevision: 0,
          sourceLanguage: 'auto',
          targetLanguage: 'zh-CN',
          units: [{ id: 'paragraph-1', number: 1, text: 'Hello world.' }],
          credential: 'must-not-cross-the-port',
        },
      }),
    ).toBe(false);
  });

  it('validates every field in background events', () => {
    expect(
      isTranslationPortResponse({
        type: 'translation-event',
        event: {
          type: 'translated',
          sessionId: 'session-1',
          pageRevision: 0,
          unitId: 'paragraph-1',
          text: '你好。',
        },
      }),
    ).toBe(true);
    expect(
      isTranslationPortResponse({
        type: 'translation-event',
        event: { type: 'translated', sessionId: 'session-1' },
      }),
    ).toBe(false);
  });

  it('rejects a pending translation and reconnects for the next request', async () => {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    let runtimeErrorRead = false;
    const port: TranslationRuntimePort = {
      name: TRANSLATION_PORT_NAME,
      onMessage: {
        addListener: (listener) => messageListeners.add(listener),
        removeListener: (listener) => messageListeners.delete(listener),
      },
      onDisconnect: {
        addListener: (listener) => disconnectListeners.add(listener),
        removeListener: (listener) => disconnectListeners.delete(listener),
      },
      postMessage() {},
      disconnect() {},
    };
    const replacementPort = createCompletedPort();
    let connections = 0;
    const client = createTranslationPortClient(
      () => (connections++ === 0 ? port : replacementPort),
      () => 'session-1',
      () => {
        runtimeErrorRead = true;
        return 'The page entered the back/forward cache.';
      },
    );

    const translation = client.translate(
      [{ id: 'paragraph-1', number: 1, text: 'Hello' }],
      'zh-CN',
    );
    for (const listener of disconnectListeners) listener();

    await expect(translation).resolves.toEqual([]);
    expect(runtimeErrorRead).toBe(true);
    expect(messageListeners).toHaveLength(0);
    expect(disconnectListeners).toHaveLength(0);
    await expect(client.translate([], 'zh-CN')).resolves.toEqual([]);
    expect(connections).toBe(2);
  });

  it('shares one replacement port across concurrent requests', async () => {
    const disconnectListeners = new Set<() => void>();
    const initialPort: TranslationRuntimePort = {
      name: TRANSLATION_PORT_NAME,
      onMessage: { addListener() {}, removeListener() {} },
      onDisconnect: {
        addListener: (listener) => disconnectListeners.add(listener),
        removeListener: (listener) => disconnectListeners.delete(listener),
      },
      postMessage() {},
      disconnect() {},
    };
    const replacementPort = createCompletedPort();
    let connections = 0;
    let session = 0;
    const client = createTranslationPortClient(
      () => (connections++ === 0 ? initialPort : replacementPort),
      () => `session-${++session}`,
      () => undefined,
    );

    const first = client.translate(
      [{ id: 'paragraph-1', number: 1, text: 'Hello' }],
      'zh-CN',
    );
    const second = client.translate(
      [{ id: 'paragraph-2', number: 2, text: 'World' }],
      'zh-CN',
    );
    for (const listener of [...disconnectListeners]) listener();

    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(connections).toBe(2);
  });

  it('rejects the request when reconnecting throws', async () => {
    const disconnectListeners = new Set<() => void>();
    const port: TranslationRuntimePort = {
      name: TRANSLATION_PORT_NAME,
      onMessage: { addListener() {}, removeListener() {} },
      onDisconnect: {
        addListener: (listener) => disconnectListeners.add(listener),
        removeListener: (listener) => disconnectListeners.delete(listener),
      },
      postMessage() {},
      disconnect() {},
    };
    let connections = 0;
    const client = createTranslationPortClient(
      () => {
        if (connections++ === 0) return port;
        throw new Error('Extension context invalidated.');
      },
      () => 'session-1',
      () => undefined,
    );
    const translation = client.translate(
      [{ id: 'paragraph-1', number: 1, text: 'Hello' }],
      'zh-CN',
    );

    expect(() => {
      for (const listener of [...disconnectListeners]) listener();
    }).not.toThrow();
    await expect(translation).rejects.toThrow(
      'Translation connection closed: Extension context invalidated.',
    );
  });

  it('rejects the request when reading the disconnect reason throws', async () => {
    const disconnectListeners = new Set<() => void>();
    const port: TranslationRuntimePort = {
      name: TRANSLATION_PORT_NAME,
      onMessage: { addListener() {}, removeListener() {} },
      onDisconnect: {
        addListener: (listener) => disconnectListeners.add(listener),
        removeListener: (listener) => disconnectListeners.delete(listener),
      },
      postMessage() {},
      disconnect() {},
    };
    const client = createTranslationPortClient(
      () => port,
      () => 'session-1',
      () => {
        throw new Error('Extension context invalidated.');
      },
    );
    const translation = client.translate(
      [{ id: 'paragraph-1', number: 1, text: 'Hello' }],
      'zh-CN',
    );

    expect(() => {
      for (const listener of [...disconnectListeners]) listener();
    }).not.toThrow();
    await expect(translation).rejects.toThrow(
      'Translation connection closed: Extension context invalidated.',
    );
  });

  it('rejects completed requests that contain categorized failures', async () => {
    const client = createTranslationPortClient(
      createFailedPort,
      () => 'session-1',
    );

    await expect(
      client.translate(
        [{ id: 'paragraph-1', number: 1, text: 'Hello' }],
        'zh-CN',
      ),
    ).rejects.toMatchObject({
      category: 'quota',
      message: 'The provider balance is insufficient.',
    });
  });

  it('returns translated paragraphs alongside partial failures', async () => {
    const client = createTranslationPortClient(
      createPartialPort,
      () => 'session-1',
    );

    await expect(
      client.translate(
        [
          { id: 'paragraph-1', number: 1, text: 'Hello' },
          { id: 'paragraph-2', number: 2, text: 'World' },
        ],
        'zh-CN',
      ),
    ).resolves.toEqual({
      translations: [{ id: 'paragraph-1', number: 1, text: '你好' }],
      failures: [
        {
          unitId: 'paragraph-2',
          category: 'rate-limit',
          message: 'Try again later.',
        },
      ],
    });
  });
});

function createPartialPort(): TranslationRuntimePort {
  const messageListeners = new Set<(message: unknown) => void>();
  return {
    name: TRANSLATION_PORT_NAME,
    onMessage: {
      addListener: (listener) => messageListeners.add(listener),
      removeListener: (listener) => messageListeners.delete(listener),
    },
    onDisconnect: { addListener() {}, removeListener() {} },
    postMessage(message) {
      const request = message as {
        request: { sessionId: string; pageRevision: number };
      };
      queueMicrotask(() => {
        const common = {
          sessionId: request.request.sessionId,
          pageRevision: request.request.pageRevision,
        };
        for (const listener of messageListeners) {
          listener({
            type: 'translation-event',
            event: {
              type: 'translated',
              ...common,
              unitId: 'paragraph-1',
              text: '你好',
            },
          });
          listener({
            type: 'translation-event',
            event: {
              type: 'failed',
              ...common,
              unitId: 'paragraph-2',
              category: 'rate-limit',
              message: 'Try again later.',
            },
          });
          listener({
            type: 'translation-event',
            event: { type: 'completed', ...common, unitId: null },
          });
        }
      });
    },
    disconnect() {},
  };
}

function createFailedPort(): TranslationRuntimePort {
  const messageListeners = new Set<(message: unknown) => void>();
  return {
    name: TRANSLATION_PORT_NAME,
    onMessage: {
      addListener: (listener) => messageListeners.add(listener),
      removeListener: (listener) => messageListeners.delete(listener),
    },
    onDisconnect: { addListener() {}, removeListener() {} },
    postMessage(message) {
      const request = message as {
        request: { sessionId: string; pageRevision: number };
      };
      queueMicrotask(() => {
        for (const listener of messageListeners) {
          listener({
            type: 'translation-event',
            event: {
              type: 'failed',
              sessionId: request.request.sessionId,
              pageRevision: request.request.pageRevision,
              unitId: 'paragraph-1',
              category: 'quota',
              message: 'The provider balance is insufficient.',
            },
          });
          listener({
            type: 'translation-event',
            event: {
              type: 'completed',
              sessionId: request.request.sessionId,
              pageRevision: request.request.pageRevision,
              unitId: null,
            },
          });
        }
      });
    },
    disconnect() {},
  };
}

function createCompletedPort(): TranslationRuntimePort {
  const messageListeners = new Set<(message: unknown) => void>();
  return {
    name: TRANSLATION_PORT_NAME,
    onMessage: {
      addListener: (listener) => messageListeners.add(listener),
      removeListener: (listener) => messageListeners.delete(listener),
    },
    onDisconnect: { addListener() {}, removeListener() {} },
    postMessage(message) {
      const request = message as {
        request: { sessionId: string; pageRevision: number };
      };
      queueMicrotask(() => {
        for (const listener of messageListeners) {
          listener({
            type: 'translation-event',
            event: {
              type: 'completed',
              sessionId: request.request.sessionId,
              pageRevision: request.request.pageRevision,
              unitId: null,
            },
          });
        }
      });
    },
    disconnect() {},
  };
}
