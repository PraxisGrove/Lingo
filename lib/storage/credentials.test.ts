import { describe, expect, it } from 'vitest';
import { createCredentialStore } from './credentials';

describe('credential store', () => {
  it('stores, retrieves, and removes credentials by profile without exposing a list of secrets', async () => {
    let values: Record<string, string> = {};
    const store = createCredentialStore({
      getValue: async () => values,
      setValue: async (next) => {
        values = next;
      },
    });
    await store.set('work', 'secret');
    expect(await store.get('work')).toBe('secret');
    expect(await store.has('work')).toBe(true);
    await store.remove('work');
    expect(await store.get('work')).toBeNull();
  });
});
