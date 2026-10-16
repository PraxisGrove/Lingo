import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type ProviderProfile,
} from '../storage/settings-model';
import {
  createProviderChain,
  deleteProviderProfile,
  saveProviderProfile,
  testProviderProfile,
} from './provider-service';

describe('provider profile credentials', () => {
  const profile: ProviderProfile = {
    id: 'saved',
    name: 'OpenAI',
    provider: 'openai-compatible',
    model: 'gpt-4.1-mini',
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    providerProfiles: [profile],
    activeProviderProfileId: profile.id,
  };

  afterEach(() => vi.unstubAllGlobals());

  it('returns a failed connection result for a model that does not follow the test contract', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"translations":[{"id":"unrelated","text":"Hola"}]}',
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(
      await testProviderProfile(profile, 'fixture-key', {
        getSettings: async () => settings,
        getCredential: async () => null,
      }),
    ).toMatchObject({ ok: false, category: 'invalid-response' });
  });

  it('tests edited profiles with their stored key without exposing it in the result', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"translations":[{"id":"connection-test","text":"Hola"}]}',
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await testProviderProfile(profile, '', {
      getSettings: async () => settings,
      getCredential: async () => 'stored-secret',
    });
    expect(result).toEqual({ ok: true });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toHaveProperty(
      'authorization',
      'Bearer stored-secret',
    );
    expect(JSON.stringify(result)).not.toContain('stored-secret');
  });

  it('preserves a saved key when an edited profile leaves the key field empty', async () => {
    const setCredential = vi.fn();
    const setSettings = vi.fn();
    await saveProviderProfile({ ...profile, name: 'Renamed' }, ' ', {
      getSettings: async () => settings,
      getCredential: async () => 'stored-secret',
      setCredential,
      setSettings,
    });
    expect(setCredential).not.toHaveBeenCalled();
    expect(setSettings).toHaveBeenCalledWith({
      providerProfiles: [{ ...profile, name: 'Renamed' }],
      activeProviderProfileId: profile.id,
    });
  });

  it('replaces a saved key when the user supplies a new one', async () => {
    const setCredential = vi.fn();
    await saveProviderProfile(profile, ' new-secret ', {
      getSettings: async () => settings,
      getCredential: async () => 'stored-secret',
      setCredential,
      setSettings: vi.fn(),
    });
    expect(setCredential).toHaveBeenCalledWith(profile.id, 'new-secret');
  });

  it('keeps the default service and fallback order when editing a saved fallback', async () => {
    const primary: ProviderProfile = { ...profile, id: 'primary' };
    const fallbackSettings = {
      ...settings,
      providerProfiles: [primary, profile],
      activeProviderProfileId: primary.id,
      fallbackProviderProfileIds: [profile.id],
    };
    const setSettings = vi.fn();
    await saveProviderProfile({ ...profile, name: 'Renamed fallback' }, '', {
      getSettings: async () => fallbackSettings,
      getCredential: async () => 'stored-secret',
      setCredential: vi.fn(),
      setSettings,
    });
    expect(setSettings).toHaveBeenCalledWith({
      providerProfiles: [primary, { ...profile, name: 'Renamed fallback' }],
      activeProviderProfileId: primary.id,
    });
    expect(fallbackSettings.fallbackProviderProfileIds).toEqual([profile.id]);
  });

  it('does not reuse orphaned credentials for new profiles or save cloud profiles without a key', async () => {
    const getCredential = vi.fn().mockResolvedValue('orphaned-secret');
    const setSettings = vi.fn();
    const dependencies = {
      getSettings: async () => DEFAULT_SETTINGS,
      getCredential,
      setCredential: vi.fn(),
      setSettings,
    };
    expect(await testProviderProfile(profile, '', dependencies)).toMatchObject({
      ok: false,
      category: 'authentication',
    });
    await expect(
      saveProviderProfile(profile, '', dependencies),
    ).rejects.toMatchObject({
      category: 'authentication',
    });
    expect(getCredential).not.toHaveBeenCalled();
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('saves a local model without creating an empty credential record', async () => {
    const setCredential = vi.fn();
    const setSettings = vi.fn();
    const local: ProviderProfile = {
      ...profile,
      id: 'local',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
    };
    await saveProviderProfile(local, '', {
      getSettings: async () => DEFAULT_SETTINGS,
      getCredential: async () => null,
      setCredential,
      setSettings,
    });
    expect(setCredential).not.toHaveBeenCalled();
    expect(setSettings).toHaveBeenCalledWith({
      providerProfiles: [local],
      activeProviderProfileId: local.id,
    });
  });
});

describe('createProviderChain', () => {
  it('returns the active provider followed by the explicitly ordered fallbacks', async () => {
    const chain = await createProviderChain(
      {
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'primary',
        fallbackProviderProfileIds: ['secondary'],
        providerProfiles: [
          { id: 'primary', name: 'Primary', provider: 'deepl' },
          {
            id: 'secondary',
            name: 'Secondary',
            provider: 'openai-compatible',
            model: 'model-b',
          },
        ],
      },
      async () => 'credential',
    );

    expect(chain[0].id).toMatch(/^primary:[a-f0-9]{64}$/);
    expect(chain[1].id).toMatch(/^secondary:[a-f0-9]{64}$/);
  });

  it('invalidates cache identity when a profile changes service configuration but preserves renames', async () => {
    const profile = {
      id: 'primary',
      name: 'Primary',
      provider: 'openai-compatible' as const,
      endpoint: 'https://first.example/v1',
      model: 'model-a',
    };
    const identity = async (patch: Partial<typeof profile>) =>
      (
        await createProviderChain(
          {
            ...DEFAULT_SETTINGS,
            activeProviderProfileId: profile.id,
            providerProfiles: [{ ...profile, ...patch }],
          },
          async () => 'credential',
        )
      )[0].id;
    const original = await identity({});
    expect(await identity({ endpoint: 'https://second.example/v1' })).not.toBe(
      original,
    );
    expect(await identity({ model: 'model-b' })).not.toBe(original);
    expect(await identity({ name: 'Renamed' })).toBe(original);
    expect(original).not.toContain('first.example');
  });
});

describe('deleteProviderProfile', () => {
  it('removes credentials and every settings reference to the profile', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      activeProviderProfileId: 'primary',
      fallbackProviderProfileIds: ['secondary'],
      providerProfiles: [
        { id: 'primary', name: 'Primary', provider: 'deepl' as const },
        {
          id: 'secondary',
          name: 'Secondary',
          provider: 'google-cloud' as const,
        },
      ],
    };
    let patch: object | undefined;
    let removedCredential = '';

    await deleteProviderProfile('primary', {
      getSettings: async () => settings,
      setSettings: async (next) => {
        patch = next;
      },
      removeCredential: async (profileId) => {
        removedCredential = profileId;
      },
    });

    expect(removedCredential).toBe('primary');
    expect(patch).toEqual({
      providerProfiles: [settings.providerProfiles[1]],
      activeProviderProfileId: 'secondary',
      fallbackProviderProfileIds: [],
    });
  });
});

describe('provider cache identity', () => {
  const base: ProviderProfile = {
    id: 'p',
    name: 'P',
    provider: 'openai-compatible',
    endpoint: 'https://gw.example/v1',
    model: 'm',
  };
  const identity = async (profile: ProviderProfile, secret = 's') => {
    const [provider] = await createProviderChain(
      {
        ...DEFAULT_SETTINGS,
        providerProfiles: [profile],
        activeProviderProfileId: profile.id,
      },
      async () => 'key',
      async () => ({ 'x-token': secret }),
    );
    return provider.id;
  };

  it('changes for plain gateway headers but never depends on secret values', async () => {
    const withHeader = {
      ...base,
      headers: [{ name: 'X-Token' }, { name: 'X-Route', value: 'a' }],
    };
    expect(await identity(withHeader, 'one')).toBe(
      await identity(withHeader, 'two'),
    );
    expect(await identity(withHeader)).not.toBe(await identity(base));
    expect(
      await identity({
        ...withHeader,
        headers: [{ name: 'X-Token' }, { name: 'X-Route', value: 'b' }],
      }),
    ).not.toBe(await identity(withHeader));
  });

  it('keeps the existing key for profiles without gateway options', async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        JSON.stringify([
          base.provider,
          base.endpoint,
          base.model,
          undefined,
          undefined,
        ]),
      ),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(await identity(base)).toBe(`p:${hash}`);
  });
});

describe('header secrets', () => {
  it('stores secret values outside settings and passes them to the connection test', async () => {
    const profile: ProviderProfile = {
      id: 'gw',
      name: 'Gateway',
      provider: 'openai-compatible',
      endpoint: 'https://gw.example/v1',
      model: 'm',
      headers: [{ name: 'X-Token' }],
    };
    let stored = { ...DEFAULT_SETTINGS };
    const setHeaderSecrets = vi.fn();
    await saveProviderProfile(
      profile,
      'key',
      {
        getSettings: async () => stored,
        setSettings: async (patch) => {
          stored = { ...stored, ...patch };
        },
        getCredential: async () => null,
        setCredential: async () => {},
        setHeaderSecrets,
      },
      { 'X-Token': 'secret' },
    );
    expect(JSON.stringify(stored)).not.toContain('secret');
    expect(setHeaderSecrets).toHaveBeenCalledWith(
      'gw',
      { 'X-Token': 'secret' },
      ['X-Token'],
    );
  });
});
