import { describe, expect, it } from 'vitest';
import {
  createTranslationPortClient,
  isTranslationPortRequest,
  isTranslationPortResponse,
  TRANSLATION_PORT_NAME,
  type TranslationRuntimePort,
} from './translation-port';

describe('translation port protocol', () => {
  it('accepts a versioned translation request without credentials', () => {
    expect(TRANSLATION_PORT_NAME).toBe('lingo-translation-v1');
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
          units: [{ id: 'paragraph-1', text: 'Hello world.' }],
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

  it('rejects a pending translation and consumes the runtime error when the port disconnects', async () => {
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
    const client = createTranslationPortClient(
      () => port,
      () => 'session-1',
      () => {
        runtimeErrorRead = true;
        return 'The page entered the back/forward cache.';
      },
    );

    const translation = client.translate(
      [{ id: 'paragraph-1', text: 'Hello' }],
      'zh-CN',
    );
    for (const listener of disconnectListeners) listener();

    await expect(translation).rejects.toThrow(
      'Translation connection closed: The page entered the back/forward cache.',
    );
    expect(runtimeErrorRead).toBe(true);
    expect(messageListeners).toHaveLength(0);
    expect(disconnectListeners).toHaveLength(0);
    await expect(client.translate([], 'zh-CN')).rejects.toThrow(
      'Translation connection closed',
    );
  });
});
