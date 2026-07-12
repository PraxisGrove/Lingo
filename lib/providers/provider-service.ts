import { credentialStore } from '../storage/credentials';
import { getSettings, setSettings } from '../storage/settings';
import type { ProviderProfile } from '../storage/settings-model';
import type { ProviderBatchInput, ProviderBatchResult, TranslationProvider } from '../translation/orchestrator';
import { createProvider, ProviderError } from './provider';

export async function translateWithActiveProvider(input: ProviderBatchInput): Promise<ProviderBatchResult> {
  const settings = await getSettings();
  const profile = settings.providerProfiles.find((item) => item.id === settings.activeProviderProfileId);
  if (!profile) throw new ProviderError('invalid-request', 'Configure a translation service first.');
  const credential = await credentialStore.get(profile.id);
  return createProvider(profile, credential ?? '').translateBatch({ ...input, sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage });
}

export async function testProviderProfile(profile: ProviderProfile, credential: string) {
  try { await createProvider(profile, credential).testConnection(); return { ok: true as const }; }
  catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError('network', 'Connection test failed.');
    return { ok: false as const, category: failure.category, message: failure.message };
  }
}

export async function saveProviderProfile(profile: ProviderProfile, credential: string): Promise<void> {
  const settings = await getSettings();
  const profiles = settings.providerProfiles.filter((item) => item.id !== profile.id);
  profiles.push(profile);
  await credentialStore.set(profile.id, credential);
  await setSettings({ providerProfiles: profiles, activeProviderProfileId: profile.id });
}

export const activeProvider: TranslationProvider = {
  capabilities: { maxBatchSize: 50, supportsContext: false, supportsNativeGlossary: false, supportsStructuredOutput: false, supportsStreaming: false },
  translateBatch: translateWithActiveProvider,
};
