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

  it('keeps header secrets per profile, drops removed headers, and deletes them with the profile', async () => {
    let values: Record<string, string> = {};
    const store = createCredentialStore({
      getValue: async () => values,
      setValue: async (next) => {
        values = next;
      },
    });
    await store.set('gw', 'key');
    await store.set('gw2', 'other');
    await store.setHeaderSecrets('gw', { 'X-Token': 'one', 'X-Extra': 'two' }, [
      'X-Token',
      'X-Extra',
    ]);
    expect(await store.getHeaderSecrets('gw')).toEqual({
      'x-token': 'one',
      'x-extra': 'two',
    });
    // Editing without new values keeps listed secrets and drops removed ones.
    await store.setHeaderSecrets('gw', {}, ['X-Token']);
    expect(await store.getHeaderSecrets('gw')).toEqual({ 'x-token': 'one' });
    expect(await store.getHeaderSecrets('gw2')).toEqual({});
    await store.remove('gw');
    expect(values).toEqual({ gw2: 'other' });
  });
});
