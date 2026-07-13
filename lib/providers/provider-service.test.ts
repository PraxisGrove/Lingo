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

    expect(chain.map((provider) => provider.id)).toEqual([
      'primary:',
      'secondary:model-b',
    ]);
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
