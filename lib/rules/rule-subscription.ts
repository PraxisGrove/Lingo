import { storage } from '@wxt-dev/storage';
import { communityRuleStore } from './community-rules';
import type { CommunityRulePackage } from './rule-resolver';

export type RuleSubscription = {
  url: string;
  publicKey: string;
  lastCheckedAt?: number;
};
export const ruleSubscriptionItem = storage.defineItem<RuleSubscription | null>(
  'local:ruleSubscription',
  { fallback: null },
);

export async function validateSubscription(
  candidate: RuleSubscription,
): Promise<CryptoKey> {
  const url = new URL(candidate.url);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error(
      'Rule subscriptions require an HTTPS URL without credentials.',
    );
  if (!/^[A-Za-z0-9+/]{43}=$/.test(candidate.publicKey))
    throw new Error('Provide a base64 Ed25519 public key.');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(candidate.publicKey), (character) =>
      character.charCodeAt(0),
    ),
    'Ed25519',
    false,
    ['verify'],
  );
}

export async function fetchRulePackage(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<CommunityRulePackage> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(10_000),
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok || !response.body)
    throw new Error('Could not download community rules.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_048_576)
        throw new Error('Community rule package exceeds 1 MiB.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  const candidate: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (
    typeof candidate !== 'object' ||
    !candidate ||
    !('payload' in candidate) ||
    !('signature' in candidate) ||
    typeof candidate.signature !== 'string'
  )
    throw new Error('Invalid community rule package.');
  return candidate as CommunityRulePackage;
}

export async function updateRuleSubscription(
  candidate?: RuleSubscription,
): Promise<'updated' | 'rejected' | 'disabled' | 'unconfigured' | 'current'> {
  if (!(await communityRuleStore.get()).updatesEnabled) return 'disabled';
  const subscription = candidate ?? (await ruleSubscriptionItem.getValue());
  if (!subscription) return 'unconfigured';
  if (!candidate && Date.now() - (subscription.lastCheckedAt ?? 0) < 86_400_000)
    return 'current';
  const key = await validateSubscription(subscription);
  // Throttle failed background checks too; retain the last verified rules.
  if (!candidate)
    await ruleSubscriptionItem.setValue({
      ...subscription,
      lastCheckedAt: Date.now(),
    });
  const result = await communityRuleStore.applyUpdate(
    await fetchRulePackage(subscription.url),
    key,
  );
  if (result.status === 'updated')
    await ruleSubscriptionItem.setValue({
      url: subscription.url,
      publicKey: subscription.publicKey,
      lastCheckedAt: Date.now(),
    });
  return result.status;
}
