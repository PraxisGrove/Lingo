import { describe, expect, it } from 'vitest';
import { createTranslationCache } from './translation-cache';

type Entry = { key: string; text: string; size: number; accessedAt: number };

function createStore() {
  const entries = new Map<string, Entry>();
  return {
    entries,
    get: async (key: string) => entries.get(key),
    put: async (entry: Entry) => entries.set(entry.key, entry),
    entries: async () => [...entries.values()],
    delete: async (key: string) => entries.delete(key),
    clear: async () => entries.clear(),
  };
}

describe('TranslationCache', () => {
  it('isolates entries by provider and language', async () => {
    const cache = createTranslationCache(createStore());
    await cache.set(
      {
        providerId: 'personal',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        text: 'Hello',
      },
      '你好',
    );
    await expect(
      cache.get({
        providerId: 'work',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        text: 'Hello',
      }),
    ).resolves.toBeUndefined();
    await expect(
      cache.get({
        providerId: 'personal',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        text: 'Hello',
      }),
    ).resolves.toBe('你好');
  });

  it('evicts the least recently used entries when over capacity', async () => {
    let clock = 0;
    const cache = createTranslationCache(createStore(), 3, () => ++clock);
    const key = (text: string) => ({
      providerId: 'p',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      text,
    });
    await cache.set(key('one'), 'a');
    await cache.set(key('two'), 'b');
    await cache.set(key('three'), 'cc');
    await expect(cache.get(key('one'))).resolves.toBeUndefined();
    await expect(cache.get(key('two'))).resolves.toBe('b');
    await expect(cache.get(key('three'))).resolves.toBe('cc');
  });
});
