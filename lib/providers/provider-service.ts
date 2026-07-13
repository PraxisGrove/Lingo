import type {
  ExtensionSettings,
  ProviderProfile,
} from '../storage/settings-model';
import type {
  ProviderBatchInput,
  ProviderBatchResult,
  TranslationProvider,
} from '../translation/orchestrator';
import { createProvider, ProviderError } from './provider';

export async function translateWithActiveProvider(
  input: ProviderBatchInput,
): Promise<ProviderBatchResult> {
  const [{ credentialStore }, { getSettings }] = await Promise.all([
    import('../storage/credentials'),
    import('../storage/settings'),
  ]);
  const settings = await getSettings();
  const profile = settings.providerProfiles.find(
    (item) => item.id === settings.activeProviderProfileId,
  );
  if (!profile)
    throw new ProviderError(
      'invalid-request',
      'Configure a translation service first.',
    );
  const credential = await credentialStore.get(profile.id);
  return createProvider(profile, credential ?? '').translateBatch({
    ...input,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
  });
}

export async function getActiveProviderChain(): Promise<TranslationProvider[]> {
  const { getSettings } = await import('../storage/settings');
  return createProviderChain(await getSettings());
}

export async function createProviderChain(
  settings: ExtensionSettings,
  getCredential: (profileId: string) => Promise<string | null> = async (
    profileId,
  ) => (await import('../storage/credentials')).credentialStore.get(profileId),
): Promise<TranslationProvider[]> {
  const profileIds = [
    settings.activeProviderProfileId,
    ...settings.fallbackProviderProfileIds,
  ].filter((id): id is string => id !== null);
  const providers = await Promise.all(
    profileIds.map(async (id) => {
      const profile = settings.providerProfiles.find((item) => item.id === id);
      if (!profile)
        throw new ProviderError(
          'invalid-request',
          'A configured provider is missing.',
        );
      const credential = await getCredential(profile.id);
      return {
        ...createProvider(profile, credential ?? ''),
        id: `${profile.id}:${profile.model ?? ''}`,
      };
    }),
  );
  if (providers.length === 0)
    throw new ProviderError(
      'invalid-request',
      'Configure a translation service first.',
    );
  return providers;
}

export async function testProviderProfile(
  profile: ProviderProfile,
  credential: string,
) {
  try {
    await createProvider(profile, credential).testConnection();
    return { ok: true as const };
  } catch (error) {
    const failure =
      error instanceof ProviderError
        ? error
        : new ProviderError('network', 'Connection test failed.');
    return {
      ok: false as const,
      category: failure.category,
      message: failure.message,
    };
  }
}

export async function saveProviderProfile(
  profile: ProviderProfile,
  credential: string,
): Promise<void> {
  const [{ credentialStore }, { getSettings, setSettings }] = await Promise.all(
    [import('../storage/credentials'), import('../storage/settings')],
  );
  const settings = await getSettings();
  const profiles = settings.providerProfiles.filter(
    (item) => item.id !== profile.id,
  );
  profiles.push(profile);
  await credentialStore.set(profile.id, credential);
  await setSettings({
    providerProfiles: profiles,
    activeProviderProfileId: profile.id,
  });
}

type DeleteProviderDependencies = {
  getSettings(): Promise<ExtensionSettings>;
  setSettings(
    patch: Partial<Omit<ExtensionSettings, 'schemaVersion'>>,
  ): Promise<unknown>;
  removeCredential(profileId: string): Promise<void>;
};

export async function deleteProviderProfile(
  profileId: string,
  dependencies?: DeleteProviderDependencies,
): Promise<void> {
  const resolved = dependencies ?? (await deleteProviderDependencies());
  const settings = await resolved.getSettings();
  const providerProfiles = settings.providerProfiles.filter(
    (profile) => profile.id !== profileId,
  );
  const activeProviderProfileId =
    settings.activeProviderProfileId === profileId
      ? (providerProfiles[0]?.id ?? null)
      : settings.activeProviderProfileId;
  const fallbackProviderProfileIds = settings.fallbackProviderProfileIds.filter(
    (id) => id !== profileId && id !== activeProviderProfileId,
  );
  await resolved.removeCredential(profileId);
  await resolved.setSettings({
    providerProfiles,
    activeProviderProfileId,
    fallbackProviderProfileIds,
  });
}

async function deleteProviderDependencies(): Promise<DeleteProviderDependencies> {
  const [{ credentialStore }, { getSettings, setSettings }] = await Promise.all(
    [import('../storage/credentials'), import('../storage/settings')],
  );
  return {
    getSettings,
    setSettings,
    removeCredential: (profileId) => credentialStore.remove(profileId),
  };
}

export const activeProvider: TranslationProvider = {
  capabilities: {
    maxBatchSize: 50,
    supportsContext: false,
    supportsNativeGlossary: false,
    supportsStructuredOutput: false,
    supportsStreaming: false,
  },
  translateBatch: translateWithActiveProvider,
};
