import type {
  ExtensionSettings,
  ProviderProfile,
} from '../storage/settings-model';
import type {
  ProviderBatchInput,
  ProviderBatchResult,
  TranslationProvider,
} from '../translation/orchestrator';
import { createBuiltInProvider } from './built-in-provider';
import type { BuiltInTranslationEngine } from './built-in-translator';
import {
  discoverProviderModelCatalog,
  ProviderModelError,
  type ProviderModelResult,
} from './model-discovery';
import {
  type ConfiguredTranslationProvider,
  createProvider,
  ProviderError,
} from './provider';

let builtInEngine: BuiltInTranslationEngine | undefined;

export function registerBuiltInEngine(engine: BuiltInTranslationEngine) {
  builtInEngine = engine;
}

export function createConfiguredProvider(
  profile: ProviderProfile,
  credential: string,
  headerSecrets: Record<string, string> = {},
  engine = builtInEngine,
): ConfiguredTranslationProvider {
  if (profile.provider !== 'built-in')
    return createProvider(profile, credential, fetch, headerSecrets);
  if (!engine)
    throw new ProviderError(
      'unsupported',
      'This browser does not provide on-device translation.',
    );
  return createBuiltInProvider(engine);
}

/** Draft secrets override saved ones; saved secrets apply only to saved profiles. */
async function resolveHeaderSecrets(
  profile: ProviderProfile,
  draft: Record<string, string>,
  saved: boolean,
  getHeaderSecrets: ProviderProfileDependencies['getHeaderSecrets'],
): Promise<Record<string, string>> {
  const stored =
    saved && getHeaderSecrets ? await getHeaderSecrets(profile.id) : {};
  const merged: Record<string, string> = { ...stored };
  for (const [name, value] of Object.entries(draft))
    if (value) merged[name.toLowerCase()] = value;
  return merged;
}

export async function listProviderModels(
  profile: ProviderProfile,
  credential: string,
  dependencies?: Pick<
    ProviderProfileDependencies,
    'getSettings' | 'getCredential' | 'getHeaderSecrets'
  > & {
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
  headerSecrets: Record<string, string> = {},
): Promise<ProviderModelResult> {
  try {
    const resolved = dependencies ?? (await providerProfileDependencies());
    const settings = await resolved.getSettings();
    const saved = settings.providerProfiles.some(
      (item) => item.id === profile.id,
    );
    const stored = saved ? await resolved.getCredential(profile.id) : null;
    const catalog = await discoverProviderModelCatalog(
      profile,
      credential.trim() || stored || '',
      dependencies?.fetcher,
      dependencies?.timeoutMs,
      await resolveHeaderSecrets(
        profile,
        headerSecrets,
        saved,
        resolved.getHeaderSecrets,
      ),
    );
    return {
      ok: true,
      models: catalog.models,
      ...(profile.endpoint &&
      catalog.resolvedEndpoint !== profile.endpoint.trim().replace(/\/+$/, '')
        ? { resolvedEndpoint: catalog.resolvedEndpoint }
        : {}),
    };
  } catch (error) {
    const failure =
      error instanceof ProviderError || error instanceof ProviderModelError
        ? error
        : new ProviderModelError(
            'network',
            'The model catalog could not be reached. Try again or enter a model manually.',
          );
    return {
      ok: false,
      category: failure.category,
      message: failure.message,
      ...(failure.status === undefined ? {} : { status: failure.status }),
      ...(failure instanceof ProviderModelError && failure.requestUrl
        ? { requestUrl: failure.requestUrl }
        : {}),
    };
  }
}

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
  return createConfiguredProvider(
    profile,
    credential ?? '',
    await credentialStore.getHeaderSecrets(profile.id),
  ).translateBatch({
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
  getHeaderSecrets: (
    profileId: string,
  ) => Promise<Record<string, string>> = async (profileId) =>
    (await import('../storage/credentials')).credentialStore.getHeaderSecrets(
      profileId,
    ),
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
        ...createConfiguredProvider(
          profile,
          credential ?? '',
          profile.headers?.length ? await getHeaderSecrets(profile.id) : {},
        ),
        id: await cacheIdentity(profile),
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

async function cacheIdentity(profile: ProviderProfile): Promise<string> {
  const configuration = JSON.stringify([
    profile.provider,
    profile.endpoint,
    profile.model,
    profile.region,
    profile.nativeGlossaryId,
    // Appended only when set so existing profiles keep their cached entries.
    ...(profile.credentialHeader || profile.headers?.length
      ? [
          profile.credentialHeader,
          // Names and plain values only; secret values never enter the key.
          (profile.headers ?? [])
            .map((header) => [header.name.toLowerCase(), header.value ?? ''])
            .sort(),
        ]
      : []),
  ]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(configuration),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${profile.id}:${hash}`;
}

export async function testProviderProfile(
  profile: ProviderProfile,
  credential: string,
  dependencies?: Pick<
    ProviderProfileDependencies,
    'getSettings' | 'getCredential' | 'getHeaderSecrets'
  >,
  headerSecrets: Record<string, string> = {},
) {
  try {
    const resolved = dependencies ?? (await providerProfileDependencies());
    const settings = await resolved.getSettings();
    const saved = settings.providerProfiles.some(
      (item) => item.id === profile.id,
    );
    const savedCredential = saved
      ? await resolved.getCredential(profile.id)
      : null;
    await createConfiguredProvider(
      profile,
      credential.trim() || savedCredential || '',
      await resolveHeaderSecrets(
        profile,
        headerSecrets,
        saved,
        resolved.getHeaderSecrets,
      ),
    ).testConnection();
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
  dependencies?: ProviderProfileDependencies,
  headerSecrets: Record<string, string> = {},
): Promise<void> {
  const resolved = dependencies ?? (await providerProfileDependencies());
  const settings = await resolved.getSettings();
  const updating = settings.providerProfiles.some(
    (item) => item.id === profile.id,
  );
  const replacementCredential = credential.trim();
  const existingCredential = updating
    ? await resolved.getCredential(profile.id)
    : null;
  createConfiguredProvider(
    profile,
    replacementCredential || existingCredential || '',
  );
  const profiles = settings.providerProfiles.filter(
    (item) => item.id !== profile.id,
  );
  profiles.push(profile);
  if (replacementCredential) {
    await resolved.setCredential(profile.id, replacementCredential);
  }
  await resolved.setHeaderSecrets?.(
    profile.id,
    headerSecrets,
    (profile.headers ?? []).map((header) => header.name),
  );
  await resolved.setSettings({
    providerProfiles: profiles,
    activeProviderProfileId: updating
      ? settings.activeProviderProfileId
      : profile.id,
  });
}

type ProviderProfileDependencies = {
  getSettings(): Promise<ExtensionSettings>;
  setSettings(
    patch: Partial<Omit<ExtensionSettings, 'schemaVersion'>>,
  ): Promise<unknown>;
  getCredential(profileId: string): Promise<string | null>;
  setCredential(profileId: string, credential: string): Promise<void>;
  getHeaderSecrets?(profileId: string): Promise<Record<string, string>>;
  setHeaderSecrets?(
    profileId: string,
    secrets: Record<string, string>,
    keep: string[],
  ): Promise<void>;
};

async function providerProfileDependencies(): Promise<ProviderProfileDependencies> {
  const [{ credentialStore }, { getSettings, setSettings }] = await Promise.all(
    [import('../storage/credentials'), import('../storage/settings')],
  );
  return {
    getSettings,
    setSettings,
    getCredential: (profileId) => credentialStore.get(profileId),
    setCredential: (profileId, credential) =>
      credentialStore.set(profileId, credential),
    getHeaderSecrets: (profileId) =>
      credentialStore.getHeaderSecrets(profileId),
    setHeaderSecrets: (profileId, secrets, keep) =>
      credentialStore.setHeaderSecrets(profileId, secrets, keep),
  };
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
