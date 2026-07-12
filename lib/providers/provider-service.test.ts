import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import { createProviderChain } from './provider-service';

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
