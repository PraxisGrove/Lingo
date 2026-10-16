import { storage } from '@wxt-dev/storage';

type CredentialValues = Record<string, string>;

const HEADER_SECRET_SEPARATOR = '\u0000h:';
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
      for (const key of Object.keys(next))
        if (key.startsWith(`${profileId}${HEADER_SECRET_SEPARATOR}`))
          delete next[key];
      await target.setValue(next);
    },
    /** Secret header values by lowercase header name. */
    async getHeaderSecrets(profileId: string): Promise<Record<string, string>> {
      const prefix = `${profileId}${HEADER_SECRET_SEPARATOR}`;
      const secrets: Record<string, string> = {};
      for (const [key, value] of Object.entries(await getItem().getValue()))
        if (key.startsWith(prefix)) secrets[key.slice(prefix.length)] = value;
      return secrets;
    },
    /** Replace provided secrets; an empty value deletes that header secret. */
    async setHeaderSecrets(
      profileId: string,
      secrets: Record<string, string>,
      keep: string[],
    ): Promise<void> {
      const target = getItem();
      const prefix = `${profileId}${HEADER_SECRET_SEPARATOR}`;
      const kept = new Set(keep.map((name) => name.toLowerCase()));
      const next = { ...(await target.getValue()) };
      for (const key of Object.keys(next))
        if (key.startsWith(prefix) && !kept.has(key.slice(prefix.length)))
          delete next[key];
      for (const [name, value] of Object.entries(secrets)) {
        const key = `${prefix}${name.toLowerCase()}`;
        if (value) next[key] = value;
        else delete next[key];
      }
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
