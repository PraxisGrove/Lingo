import { describe, expect, it } from 'vitest';
import { createMessage, isExtensionMessage } from './messages';

describe('messages', () => {
  it('creates typed messages', () => {
    expect(createMessage('ping', { source: 'popup' })).toEqual({
      type: 'ping',
      payload: { source: 'popup' },
    });
  });

  it('identifies extension-shaped messages', () => {
    expect(
      isExtensionMessage({ type: 'ping', payload: { source: 'popup' } }),
    ).toBe(true);
    expect(isExtensionMessage({ type: 'ping', payload: {} })).toBe(false);
    expect(
      isExtensionMessage({
        type: 'startPageTranslation',
        payload: {
          targetLanguage: 'zh-CN',
          displayMode: 'bilingual',
          credential: 'must-not-cross-the-message-boundary',
        },
      }),
    ).toBe(false);
    expect(isExtensionMessage(null)).toBe(false);
  });

  it('validates provider configuration commands', () => {
    expect(
      isExtensionMessage({
        type: 'saveProviderProfile',
        payload: {
          profile: { id: 'work', name: 'Work', provider: 'deepl' },
          credential: 'secret',
        },
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        type: 'testProviderConnection',
        payload: {
          profile: { id: 'work', name: 'Work', provider: 'deepl' },
          credential: 'secret',
        },
      }),
    ).toBe(true);
  });
});
