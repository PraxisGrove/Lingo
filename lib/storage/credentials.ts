import { storage } from '@wxt-dev/storage';

type CredentialValues = Record<string, string>;
type CredentialItem = { getValue(): Promise<CredentialValues>; setValue(value: CredentialValues): Promise<void> };

const credentialItem = storage.defineItem<CredentialValues>('local:providerCredentials', { fallback: {} });

export function createCredentialStore(item: CredentialItem = credentialItem) {
  return {
    async get(profileId: string): Promise<string | null> { return (await item.getValue())[profileId] ?? null; },
    async has(profileId: string): Promise<boolean> { return Boolean((await item.getValue())[profileId]); },
    async set(profileId: string, credential: string): Promise<void> { await item.setValue({ ...(await item.getValue()), [profileId]: credential }); },
    async remove(profileId: string): Promise<void> { const next = { ...(await item.getValue()) }; delete next[profileId]; await item.setValue(next); },
  };
}

export const credentialStore = createCredentialStore();
