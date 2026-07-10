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
    expect(isExtensionMessage({ type: 'ping', payload: {} })).toBe(true);
    expect(isExtensionMessage(null)).toBe(false);
  });
});
