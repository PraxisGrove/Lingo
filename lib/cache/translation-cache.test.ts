import { describe, expect, it } from 'vitest';
import { createTranslationCache } from './translation-cache';

type Entry = { key: string; text: string; size: number; accessedAt: number };

function createStore() {
  const entries = new Map<string, Entry>();
  return {
    get: async (key: string) => entries.get(key),
    put: async (entry: Entry) => void entries.set(entry.key, entry),
    entries: async () => [...entries.values()],
    delete: async (key: string) => void entries.delete(key),
    clear: async () => void entries.clear(),
  };
}

describe('TranslationCache', () => {
  it('reports local entry count and byte usage', async () => {
    const cache = createTranslationCache(createStore());
    const key = (text: string) => ({
      providerId: 'personal',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      qualityVersion: 'quality-v1:123',
      text,
    });

    await cache.set(key('one'), 'a');
    await cache.set(key('two'), '你好');

    await expect(cache.stats()).resolves.toEqual({
      entryCount: 2,
      byteSize: 7,
    });
  });

  it('isolates entries by provider and language', async () => {
    const cache = createTranslationCache(createStore());
    await cache.set(
      {
        providerId: 'personal',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        qualityVersion: 'quality-v1:123',
        text: 'Hello',
      },
      '你好',
    );
    await expect(
      cache.get({
        providerId: 'work',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        qualityVersion: 'quality-v1:123',
        text: 'Hello',
      }),
    ).resolves.toBeUndefined();
    await expect(
      cache.get({
        providerId: 'personal',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        qualityVersion: 'quality-v1:123',
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
      qualityVersion: 'quality-v1:123',
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
