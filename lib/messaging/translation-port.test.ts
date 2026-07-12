import { describe, expect, it } from 'vitest';
import {
  isTranslationPortRequest,
  isTranslationPortResponse,
  TRANSLATION_PORT_NAME,
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
});
