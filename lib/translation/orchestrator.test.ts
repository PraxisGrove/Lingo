import { describe, expect, it } from 'vitest';
import { createTranslationCache } from '../cache/translation-cache';
import {
  createTranslationOrchestrator,
  type ProviderBatchInput,
  type ProviderBatchResult,
  type TranslationProvider,
} from './orchestrator';
import { resolveTranslationQuality } from './quality';

describe('TranslationOrchestrator', () => {
  it('emits a translated result for every queued unit', async () => {
    const orchestrator = createTranslationOrchestrator({
      capabilities: {
        maxBatchSize: 10,
        supportsContext: false,
        supportsNativeGlossary: false,
        supportsStructuredOutput: false,
        supportsStreaming: false,
      },
      async translateBatch(input: ProviderBatchInput) {
        return input.units.map((unit) => ({
          id: unit.id,
          text: `Chinese: ${unit.text}`,
        }));
      },
    });

    const events = [];
    for await (const event of orchestrator.translate({
      sessionId: 'session-1',
      pageRevision: 0,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      units: [{ id: 'paragraph-1', number: 1, text: 'Hello world.' }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'queued',
        sessionId: 'session-1',
        pageRevision: 0,
        unitId: 'paragraph-1',
      },
      {
        type: 'translated',
        sessionId: 'session-1',
        pageRevision: 0,
        unitId: 'paragraph-1',
        text: 'Chinese: Hello world.',
      },
      {
        type: 'completed',
        sessionId: 'session-1',
        pageRevision: 0,
        unitId: null,
      },
    ]);
  });

  it('respects the provider maximum batch size', async () => {
    const batchSizes: number[] = [];
    const orchestrator = createTranslationOrchestrator({
      capabilities: {
        maxBatchSize: 2,
        supportsContext: false,
        supportsNativeGlossary: false,
        supportsStructuredOutput: false,
        supportsStreaming: false,
      },
      async translateBatch(input: ProviderBatchInput) {
        batchSizes.push(input.units.length);
        return input.units;
      },
    });

    for await (const _event of orchestrator.translate({
      sessionId: 'session-1',
      pageRevision: 0,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      units: [
        { id: '1', number: 1, text: 'One' },
        { id: '2', number: 2, text: 'Two' },
        { id: '3', number: 3, text: 'Three' },
      ],
    })) {
      // Consume the complete event stream.
    }

    expect(batchSizes).toEqual([2, 1]);
  });

  it('does not send a later batch after cancellation', async () => {
    const requestedUnits: string[] = [];
    let releaseFirstBatch: (() => void) | undefined;
    let markFirstBatchStarted: (() => void) | undefined;
    const firstBatchStarted = new Promise<void>((resolve) => {
      markFirstBatchStarted = resolve;
    });
    const orchestrator = createTranslationOrchestrator(
      {
        capabilities: {
          maxBatchSize: 1,
          supportsContext: false,
          supportsNativeGlossary: false,
          supportsStructuredOutput: false,
          supportsStreaming: false,
        },
        async translateBatch(input: ProviderBatchInput) {
          requestedUnits.push(...input.units.map((unit) => unit.id));
          markFirstBatchStarted?.();
          await new Promise<void>((resolve) => {
            releaseFirstBatch = resolve;
          });
          return input.units;
        },
      },
      { maxConcurrentBatches: 1 },
    );
    const events = orchestrator
      .translate({
        sessionId: 'session-to-cancel',
        pageRevision: 0,
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        units: [
          { id: '1', number: 1, text: 'One' },
          { id: '2', number: 2, text: 'Two' },
        ],
      })
      [Symbol.asyncIterator]();

    await events.next();
    await events.next();
    const result = events.next();
    await firstBatchStarted;
    await orchestrator.cancel('session-to-cancel');
    releaseFirstBatch?.();
    expect(await result).toMatchObject({ done: true });
    expect(requestedUnits).toEqual(['1']);
  });

  it('retries transient provider failures with exponential backoff', async () => {
    let attempts = 0;
    const waits: number[] = [];
    const orchestrator = createTranslationOrchestrator(
      provider(async (input: ProviderBatchInput) => {
        attempts += 1;
        if (attempts === 1) throw { category: 'rate-limit' };
        return input.units;
      }),
      { wait: async (milliseconds) => void waits.push(milliseconds) },
    );

    const events = await collect(orchestrator);
    expect(attempts).toBe(2);
    expect(waits).toEqual([250]);
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
  });

  it('uses only an explicitly supplied fallback provider after authentication failure', async () => {
    const orchestrator = createTranslationOrchestrator(
      provider(async () => {
        throw { category: 'authentication' };
      }, 'primary'),
      {
        fallbackProviders: [
          provider(
            async (input: ProviderBatchInput) => input.units,
            'fallback',
          ),
        ],
      },
    );

    const events = await collect(orchestrator);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'paused',
        reason: 'Switching to an explicitly configured fallback service.',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'translated', text: 'Hello' }),
    );
  });

  it('serves a repeated unit from the local cache', async () => {
    let requests = 0;
    const entries = new Map<
      string,
      { key: string; text: string; size: number; accessedAt: number }
    >();
    const cache = createTranslationCache({
      get: async (key) => entries.get(key),
      put: async (entry) => void entries.set(entry.key, entry),
      entries: async () => [...entries.values()],
      delete: async (key) => void entries.delete(key),
      clear: async () => void entries.clear(),
    });
    const orchestrator = createTranslationOrchestrator(
      provider(async (input: ProviderBatchInput) => {
        requests += 1;
        return input.units.map((unit) => ({
          ...unit,
          text: `Cached: ${unit.text}`,
        }));
      }, 'personal'),
      { cache },
    );

    await collect(orchestrator, 'one');
    const events = await collect(orchestrator, 'two');
    expect(requests).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ text: 'Cached: Hello' }),
    );
  });

  it('sends a bounded title and adjacent paragraph context only to capable providers', async () => {
    const contexts: ProviderBatchInput['context'][] = [];
    const orchestrator = createTranslationOrchestrator(
      {
        ...provider(async (input) => input.units),
        capabilities: {
          ...provider(async (input) => input.units).capabilities,
          maxBatchSize: 1,
          supportsContext: true,
        },
        async translateBatch(input) {
          contexts.push(input.context);
          return input.units;
        },
      },
      { maxConcurrentBatches: 1 },
    );

    for await (const _event of orchestrator.translate({
      sessionId: 'context',
      pageRevision: 0,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      pageTitle: 'A page title',
      units: [
        { id: '3', number: 3, text: 'Three' },
        { id: '1', number: 1, text: 'One' },
        { id: '2', number: 2, text: 'Two' },
      ],
    })) {
      // Consume the complete event stream.
    }

    expect(contexts).toEqual([
      {
        pageTitle: 'A page title',
        units: [{ id: '2', number: 2, text: 'Two' }],
      },
      {
        pageTitle: 'A page title',
        units: [{ id: '2', number: 2, text: 'Two' }],
      },
      {
        pageTitle: 'A page title',
        units: [
          { id: '1', number: 1, text: 'One' },
          { id: '3', number: 3, text: 'Three' },
        ],
      },
    ]);
  });

  it('limits the text sent as adjacent paragraph context', async () => {
    const contexts: ProviderBatchInput['context'][] = [];
    const orchestrator = createTranslationOrchestrator({
      ...provider(async (input) => input.units),
      capabilities: {
        ...provider(async (input) => input.units).capabilities,
        maxBatchSize: 1,
        supportsContext: true,
      },
      async translateBatch(input) {
        contexts.push(input.context);
        return input.units;
      },
    });

    for await (const _event of orchestrator.translate({
      sessionId: 'long-context',
      pageRevision: 0,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      units: [
        { id: '1', number: 1, text: 'One' },
        { id: '2', number: 2, text: 'x'.repeat(1_000) },
      ],
    })) {
      // Consume the complete event stream.
    }

    expect(contexts[0]?.units[0]?.text).toHaveLength(600);
  });

  it('rejects malformed per-paragraph results without caching them', async () => {
    const orchestrator = createTranslationOrchestrator({
      ...provider(async () => [
        { id: '1', text: '' },
        { id: '2', text: 'Two' },
        { id: '2', text: 'Duplicate' },
        { id: 'unknown', text: 'Unexpected' },
      ]),
    });

    const events = [];
    for await (const event of orchestrator.translate({
      sessionId: 'validation',
      pageRevision: 0,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      units: [
        { id: '1', number: 1, text: 'One' },
        { id: '2', number: 2, text: 'Two' },
      ],
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'failed', unitId: '1' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'failed', unitId: '2' }),
    );
  });

  it('invalidates cached translations when quality constraints change', async () => {
    let requests = 0;
    const entries = new Map<
      string,
      { key: string; text: string; size: number; accessedAt: number }
    >();
    const cache = createTranslationCache({
      get: async (key) => entries.get(key),
      put: async (entry) => void entries.set(entry.key, entry),
      entries: async () => [...entries.values()],
      delete: async (key) => void entries.delete(key),
      clear: async () => void entries.clear(),
    });
    let quality = resolveTranslationQuality({
      glossary: [{ source: 'Lingo', target: '灵译' }],
    });
    const orchestrator = createTranslationOrchestrator(
      provider(async (input) => {
        requests += 1;
        return input.units;
      }),
      { cache, quality: async () => quality },
    );

    await collect(orchestrator, 'quality-one');
    quality = resolveTranslationQuality({
      glossary: [{ source: 'Lingo', target: 'Lingo' }],
    });
    await collect(orchestrator, 'quality-two');
    expect(requests).toBe(2);
  });
});

function provider(
  translateBatch: (input: ProviderBatchInput) => Promise<ProviderBatchResult>,
  id = 'provider',
): TranslationProvider {
  return {
    id,
    capabilities: {
      maxBatchSize: 10,
      supportsContext: false,
      supportsNativeGlossary: false,
      supportsStructuredOutput: false,
      supportsStreaming: false,
    },
    translateBatch,
  };
}

async function collect(
  orchestrator: ReturnType<typeof createTranslationOrchestrator>,
  sessionId = 'session-1',
) {
  const events = [];
  for await (const event of orchestrator.translate({
    sessionId,
    pageRevision: 0,
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    units: [{ id: 'paragraph-1', number: 1, text: 'Hello' }],
  }))
    events.push(event);
  return events;
}
