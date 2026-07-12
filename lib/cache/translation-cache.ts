export type TranslationCacheKey = {
  providerId: string;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
};

export type TranslationCache = {
  get(key: TranslationCacheKey): Promise<string | undefined>;
  set(key: TranslationCacheKey, text: string): Promise<void>;
  clear(): Promise<void>;
};

export function createConditionalTranslationCache(
  cache: TranslationCache,
  enabled: () => Promise<boolean>,
): TranslationCache {
  return {
    async get(key) {
      return (await enabled()) ? cache.get(key) : undefined;
    },
    async set(key, text) {
      if (await enabled()) await cache.set(key, text);
    },
    clear: () => cache.clear(),
  };
}

type CacheEntry = {
  key: string;
  text: string;
  size: number;
  accessedAt: number;
};

type CacheStore = {
  get(key: string): Promise<CacheEntry | undefined>;
  put(entry: CacheEntry): Promise<void>;
  entries(): Promise<CacheEntry[]>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
};

export function createTranslationCache(
  store: CacheStore = createIndexedDbStore(),
  maxBytes = 25 * 1024 * 1024,
  now: () => number = Date.now,
): TranslationCache {
  return {
    async get(key) {
      const entry = await store.get(await cacheKey(key));
      if (!entry) return undefined;
      await store.put({ ...entry, accessedAt: now() });
      return entry.text;
    },
    async set(key, text) {
      const entry: CacheEntry = {
        key: await cacheKey(key),
        text,
        size: new Blob([text]).size,
        accessedAt: now(),
      };
      await store.put(entry);
      const entries = await store.entries();
      let total = entries.reduce((sum, item) => sum + item.size, 0);
      for (const item of entries.sort((a, b) => a.accessedAt - b.accessedAt)) {
        if (total <= maxBytes) break;
        await store.delete(item.key);
        total -= item.size;
      }
    },
    clear: () => store.clear(),
  };
}

async function cacheKey(key: TranslationCacheKey): Promise<string> {
  const value = JSON.stringify([
    key.providerId,
    key.sourceLanguage,
    key.targetLanguage,
    key.text,
  ]);
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function createIndexedDbStore(): CacheStore {
  const database = openDatabase();
  return {
    async get(key) {
      return request<CacheEntry | undefined>(
        (await database)
          .transaction('translations')
          .objectStore('translations')
          .get(key),
      );
    },
    async put(entry) {
      await transaction(database, 'readwrite', (store) => store.put(entry));
    },
    async entries() {
      return request<CacheEntry[]>(
        (await database)
          .transaction('translations')
          .objectStore('translations')
          .getAll(),
      );
    },
    async delete(key) {
      await transaction(database, 'readwrite', (store) => store.delete(key));
    },
    async clear() {
      await transaction(database, 'readwrite', (store) => store.clear());
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lingo-translation-cache', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('translations', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function transaction(
  database: Promise<IDBDatabase>,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    void database.then((db) => {
      const request = operation(
        db.transaction('translations', mode).objectStore('translations'),
      );
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }, reject);
  });
}
