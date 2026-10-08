import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import { createProviderChain, deleteProviderProfile } from './provider-service';

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
