import { describe, expect, it } from 'vitest';
import { protocolForModel, protocolsFromEndpoints } from './model-protocols';

describe('per-model gateway protocols', () => {
  it('maps native endpoints listed by local gateways to Lingo protocols', () => {
    expect(
      protocolsFromEndpoints([
        '/v1/chat/completions',
        '/v1/responses',
        '/v1/messages',
        '/v1/embeddings',
      ]),
    ).toEqual(['openai-compatible', 'openai-responses', 'anthropic']);
    expect(protocolsFromEndpoints(['/v1/embeddings'])).toBeUndefined();
    expect(protocolsFromEndpoints(undefined)).toBeUndefined();
  });

  it('keeps a supported protocol and switches only when the model needs another', () => {
    const responsesOnly = { protocols: ['openai-responses' as const] };
    const messagesOrChat = {
      protocols: ['anthropic' as const, 'openai-compatible' as const],
    };
    expect(protocolForModel(responsesOnly, 'openai-compatible')).toBe(
      'openai-responses',
    );
    expect(protocolForModel(messagesOrChat, 'anthropic')).toBe('anthropic');
    expect(protocolForModel(messagesOrChat, 'openai-responses')).toBe(
      'openai-compatible',
    );
    expect(protocolForModel({}, 'gemini')).toBe('gemini');
    expect(protocolForModel(undefined, 'openai-compatible')).toBe(
      'openai-compatible',
    );
  });
});
