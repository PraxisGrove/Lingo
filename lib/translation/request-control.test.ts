import { describe, expect, it, vi } from 'vitest';
import type { ProviderBatchInput, TranslationProvider } from './orchestrator';
import { resolveTranslationQuality } from './quality';
import { createRequestControl } from './request-control';

const provider: TranslationProvider = {
  id: 'same-service',
  capabilities: {
    maxBatchSize: 50,
    supportsContext: false,
    supportsNativeGlossary: false,
    supportsStructuredOutput: false,
    supportsStreaming: false,
  },
  translateBatch: async () => [],
};
const input = (id: string, signal?: AbortSignal): ProviderBatchInput => ({
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  quality: resolveTranslationQuality(),
  signal,
  units: [{ id, number: 1, text: 'Same source' }],
});

describe('worker-wide request control', () => {
  it('shares equivalent requests across page ids without cancelling another reader', async () => {
    const execute = createRequestControl(2, 0);
    let release: (() => void) | undefined;
    let sharedSignal: AbortSignal | undefined;
    const run = vi.fn(async (signal: AbortSignal) => {
      sharedSignal = signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return [{ id: 'page-a', text: '译文' }];
    });
    const controller = new AbortController();
    const first = execute(provider, input('page-a', controller.signal), run);
    const rejected = expect(first).rejects.toThrow();
    const second = execute(provider, input('page-b'), run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    // Allow the second asynchronous digest to attach its lease.
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await rejected;
    expect(sharedSignal?.aborted).toBe(false);
    release?.();
    expect(await second).toEqual([{ id: 'page-b', text: '译文' }]);
  });

  it('caps concurrency and spaces starts across independent sessions', async () => {
    const execute = createRequestControl(2, 20);
    let active = 0;
    let maximum = 0;
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => {
        const request = input(String(index));
        request.units[0].text = `Unique ${index}`;
        return execute(provider, request, async () => {
          starts.push(Date.now());
          maximum = Math.max(maximum, ++active);
          await new Promise((resolve) => setTimeout(resolve, 50));
          active -= 1;
          return [{ id: String(index), text: '译文' }];
        });
      }),
    );
    expect(maximum).toBe(2);
    expect(
      starts.every(
        (start, index) => index === 0 || start - starts[index - 1] >= 18,
      ),
    ).toBe(true);
  });

  it('does not share translations with different quality or language', async () => {
    const execute = createRequestControl(2, 0);
    const run = vi.fn(async () => [{ id: 'a', text: '译文' }]);
    const other = input('a');
    other.targetLanguage = 'ja';
    await Promise.all([
      execute(provider, input('a'), run),
      execute(provider, other, run),
    ]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
