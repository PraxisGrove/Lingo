import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import type { ProviderBatchInput } from '../translation/orchestrator';
import { resolveTranslationQuality } from '../translation/quality';
import {
  type BuiltInRequest,
  createOffscreenBuiltInEngine,
  serveBuiltInRequests,
} from './built-in-provider';
import type { BuiltInTranslationEngine } from './built-in-translator';
import { ProviderError } from './provider';
import { createProviderChain, registerBuiltInEngine } from './provider-service';

const input = {
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  quality: resolveTranslationQuality(),
  units: [{ id: 'a', number: 1, text: 'Hello' }],
};

function fakeEngine(
  overrides: Partial<BuiltInTranslationEngine> = {},
): BuiltInTranslationEngine {
  return {
    availability: vi.fn().mockResolvedValue('available'),
    translate: vi.fn(async (batch: ProviderBatchInput) =>
      batch.units.map((unit) => ({ id: unit.id, text: `译:${unit.text}` })),
    ),
    ...overrides,
  };
}

function loopback(engine: BuiltInTranslationEngine) {
  const serve = serveBuiltInRequests(engine);
  const send = vi.fn((request: BuiltInRequest) =>
    serve(structuredClone(request)),
  );
  return { send, engine: createOffscreenBuiltInEngine(send) };
}

describe('on-device translation through the offscreen document', () => {
  it('round-trips a batch without sending the abort signal across contexts', async () => {
    const { send, engine } = loopback(fakeEngine());
    const controller = new AbortController();
    await expect(
      engine.translate({ ...input, signal: controller.signal }),
    ).resolves.toEqual([{ id: 'a', text: '译:Hello' }]);
    expect(send.mock.calls[0][0]).not.toHaveProperty('input.signal');
  });

  it('keeps the language-pack category so the reader is sent to download it', async () => {
    const { engine } = loopback(
      fakeEngine({
        translate: () =>
          Promise.reject(new ProviderError('language-pack', 'Missing pack')),
      }),
    );
    await expect(engine.translate(input)).rejects.toMatchObject({
      category: 'language-pack',
    });
  });

  it('cancels the offscreen request when the reader stops translation', async () => {
    let seen: AbortSignal | undefined;
    const { send, engine } = loopback(
      fakeEngine({
        translate: (batch) =>
          new Promise((_, reject) => {
            seen = batch.signal;
            batch.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      }),
    );
    const controller = new AbortController();
    const pending = engine.translate({ ...input, signal: controller.signal });
    await vi.waitFor(() => expect(seen).toBeDefined());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cancel' }),
    );
  });

  it('reports a missing offscreen response as unavailable', async () => {
    const engine = createOffscreenBuiltInEngine(async () => undefined);
    await expect(engine.translate(input)).rejects.toMatchObject({
      category: 'unavailable',
    });
  });

  it('builds a credential-free provider chain entry for the built-in profile', async () => {
    const profile = {
      id: 'device',
      name: 'On-device',
      provider: 'built-in' as const,
    };
    const engine = fakeEngine();
    const getCredential = vi.fn().mockResolvedValue(null);
    registerBuiltInEngine(engine);
    const [provider] = await createProviderChain(
      {
        ...DEFAULT_SETTINGS,
        providerProfiles: [profile],
        activeProviderProfileId: profile.id,
      },
      getCredential,
    );
    await expect(provider.translateBatch(input)).resolves.toEqual([
      { id: 'a', text: '译:Hello' },
    ]);
    expect(provider.capabilities.supportsContext).toBe(false);
  });
});
