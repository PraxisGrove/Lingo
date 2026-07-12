import { describe, expect, it } from 'vitest';
import { createTranslationOrchestrator } from './orchestrator';

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
      async translateBatch(input) {
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
      units: [{ id: 'paragraph-1', text: 'Hello world.' }],
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
      async translateBatch(input) {
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
        { id: '1', text: 'One' },
        { id: '2', text: 'Two' },
        { id: '3', text: 'Three' },
      ],
    })) {
      // Consume the complete event stream.
    }

    expect(batchSizes).toEqual([2, 1]);
  });

  it('does not send a later batch after cancellation', async () => {
    const requestedUnits: string[] = [];
    const orchestrator = createTranslationOrchestrator({
      capabilities: {
        maxBatchSize: 1,
        supportsContext: false,
        supportsNativeGlossary: false,
        supportsStructuredOutput: false,
        supportsStreaming: false,
      },
      async translateBatch(input) {
        requestedUnits.push(...input.units.map((unit) => unit.id));
        return input.units;
      },
    });
    const events = orchestrator
      .translate({
        sessionId: 'session-to-cancel',
        pageRevision: 0,
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        units: [
          { id: '1', text: 'One' },
          { id: '2', text: 'Two' },
        ],
      })
      [Symbol.asyncIterator]();

    await events.next();
    await events.next();
    await events.next();
    await orchestrator.cancel('session-to-cancel');
    expect(await events.next()).toMatchObject({ done: true });
    expect(requestedUnits).toEqual(['1']);
  });
});
