import { storage } from '@wxt-dev/storage';

type CredentialValues = Record<string, string>;
type CredentialItem = {
  getValue(): Promise<CredentialValues>;
  setValue(value: CredentialValues): Promise<void>;
};

let credentialItem: CredentialItem | undefined;

export function createCredentialStore(item?: CredentialItem) {
  const getItem = () => item ?? getCredentialItem();
  return {
    async get(profileId: string): Promise<string | null> {
      return (await getItem().getValue())[profileId] ?? null;
    },
    async has(profileId: string): Promise<boolean> {
      return Boolean((await getItem().getValue())[profileId]);
    },
    async set(profileId: string, credential: string): Promise<void> {
      const target = getItem();
      await target.setValue({
        ...(await target.getValue()),
        [profileId]: credential,
      });
    },
    async remove(profileId: string): Promise<void> {
      const target = getItem();
      const next = { ...(await target.getValue()) };
      delete next[profileId];
      await target.setValue(next);
    },
  };
}

function getCredentialItem(): CredentialItem {
  credentialItem ??= storage.defineItem<CredentialValues>(
    'local:providerCredentials',
    { fallback: {} },
  );
  return credentialItem;
}

export const credentialStore = createCredentialStore();
