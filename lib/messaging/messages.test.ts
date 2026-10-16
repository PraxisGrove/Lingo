import { describe, expect, it } from 'vitest';
import { createMessage, isExtensionMessage } from './messages';

describe('messages', () => {
  it.each([
    'saveProviderProfile',
    'testProviderConnection',
    'listProviderModels',
  ] as const)('accepts bounded custom icons and an explicit automatic restore for %s', (type) => {
    const profile = {
      id: 'service',
      name: 'Service',
      provider: 'openai-compatible' as const,
    };
    for (const icon of [
      { type: 'provider' as const, providerId: 'qwen' as const },
      {
        type: 'image' as const,
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=',
      },
      undefined,
    ]) {
      expect(
        isExtensionMessage(
          createMessage(type, {
            profile: { ...profile, icon },
            credential: '',
          }),
        ),
      ).toBe(true);
    }
  });

  it.each([
    { type: 'image', dataUrl: 'https://example.com/image.png' },
    { type: 'image', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    { type: 'image', dataUrl: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' },
    { type: 'image', dataUrl: `data:image/png;base64,${'A'.repeat(32768)}` },
    { type: 'image', dataUrl: 'data:image/png;base64,invalid!' },
    { type: 'image', dataUrl: 123 },
    { type: 'provider', providerId: 'unknown' },
    {
      type: 'provider',
      providerId: 'openai',
      remoteUrl: 'https://example.com',
    },
  ])('rejects unsafe custom icon metadata %j in every profile message', (icon) => {
    for (const type of [
      'saveProviderProfile',
      'testProviderConnection',
      'listProviderModels',
    ]) {
      expect(
        isExtensionMessage({
          type,
          payload: {
            profile: {
              id: 'service',
              name: 'Service',
              provider: 'openai-compatible',
              icon,
            },
            credential: '',
          },
        }),
      ).toBe(false);
    }
  });
  it.each([
    'anthropic',
    'gemini',
    'openai-compatible',
    'openai-responses',
  ] as const)('accepts %s catalog discovery and persisted model selection', (provider) => {
    const profile = {
      id: 'service',
      name: 'Service',
      provider,
      model: 'selected',
      models: [{ id: 'selected', name: 'Selected' }],
      modelSelection: 'manual' as const,
    };
    expect(
      isExtensionMessage(
        createMessage('listProviderModels', { profile, credential: '' }),
      ),
    ).toBe(true);
    expect(
      isExtensionMessage(
        createMessage('saveProviderProfile', { profile, credential: 'key' }),
      ),
    ).toBe(true);
  });

  it.each([
    { models: [{ id: 'x', name: 123 }] },
    { models: [{ id: 'x', name: 'X', secret: 'key' }] },
    { models: 'x' },
    { models: undefined },
    { modelSelection: 'automatic' },
    { modelSelection: undefined },
  ])('rejects malformed model catalog/selection metadata %j', (patch) => {
    expect(
      isExtensionMessage({
        type: 'listProviderModels',
        payload: {
          profile: {
            id: 'x',
            name: 'X',
            provider: 'openai-compatible',
            ...patch,
          },
          credential: '',
        },
      }),
    ).toBe(false);
  });
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
          profile: {
            id: 'work',
            name: 'Work',
            provider: 'deepl',
            nativeGlossaryId: 'glossary-123',
          },
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
    expect(
      isExtensionMessage({
        type: 'deleteProviderProfile',
        payload: { profileId: 'work' },
      }),
    ).toBe(true);
  });

  it('validates read-only extension status commands', () => {
    expect(
      isExtensionMessage({ type: 'getExtensionStatus', payload: {} }),
    ).toBe(true);
    expect(isExtensionMessage({ type: 'exportDiagnostics', payload: {} })).toBe(
      true,
    );
    expect(
      isExtensionMessage({
        type: 'exportDiagnostics',
        payload: { includeCredentials: true },
      }),
    ).toBe(false);
  });
});
