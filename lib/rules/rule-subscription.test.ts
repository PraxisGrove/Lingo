import { describe, expect, it, vi } from 'vitest';
import { communityRuleStore } from './community-rules';
import { type RuleSet, serializeCommunityRulePayload } from './rule-resolver';
import {
  fetchRulePackage,
  ruleSubscriptionItem,
  updateRuleSubscription,
  validateSubscription,
} from './rule-subscription';

vi.mock('@wxt-dev/storage', () => ({
  storage: {
    defineItem: <T>(_key: string, options: { fallback: T }) => {
      let value = options.fallback;
      return {
        getValue: async () => value,
        setValue: async (next: T) => {
          value = next;
        },
      };
    },
  },
}));

describe('signed rule distribution transport', () => {
  it('keeps verified data on tampering, throttles background checks, and never downloads while disabled', async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ]);
    const publicKey = btoa(
      String.fromCharCode(
        ...new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
      ),
    );
    const payload: RuleSet = {
      schemaVersion: 1,
      rules: [
        { id: 'test', domain: 'reading.test', selectors: { main: ['main'] } },
      ],
    };
    const signature = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.sign(
            'Ed25519',
            pair.privateKey,
            new TextEncoder().encode(serializeCommunityRulePayload(payload)),
          ),
        ),
      ),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ payload, signature })));
    vi.stubGlobal('fetch', fetcher);
    const subscription = { url: 'https://rules.example/lingo.json', publicKey };
    try {
      expect(await updateRuleSubscription(subscription)).toBe('updated');
      expect((await communityRuleStore.get()).lastKnownGood).toEqual(payload);
      expect(await updateRuleSubscription()).toBe('current');
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payload: { schemaVersion: 1, rules: [] },
            signature,
          }),
        ),
      );
      expect(
        await updateRuleSubscription({
          ...subscription,
          url: 'https://other.example/rules.json',
        }),
      ).toBe('rejected');
      expect((await communityRuleStore.get()).lastKnownGood).toEqual(payload);
      expect((await ruleSubscriptionItem.getValue())?.url).toBe(
        subscription.url,
      );
      await communityRuleStore.setUpdatesEnabled(false);
      fetcher.mockClear();
      expect(await updateRuleSubscription(subscription)).toBe('disabled');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await communityRuleStore.setUpdatesEnabled(true);
      await ruleSubscriptionItem.setValue(null);
    }
  });

  it('accepts a trusted HTTPS subscription with a raw public key', async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ]);
    const bytes = new Uint8Array(
      await crypto.subtle.exportKey('raw', pair.publicKey),
    );
    const publicKey = btoa(String.fromCharCode(...bytes));
    expect(
      (
        await validateSubscription({
          url: 'https://rules.example/lingo.json',
          publicKey,
        })
      ).type,
    ).toBe('public');
    await expect(
      validateSubscription({
        url: 'http://rules.example/lingo.json',
        publicKey,
      }),
    ).rejects.toThrow('HTTPS');
    await expect(
      validateSubscription({
        url: 'https://user:secret@rules.example/lingo.json',
        publicKey,
      }),
    ).rejects.toThrow('credentials');
  });

  it('downloads only bounded declarative packages without cookies or redirects', async () => {
    const payload = {
      payload: { schemaVersion: 1, rules: [] },
      signature: 'signature',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(payload)));
    expect(
      await fetchRulePackage('https://rules.example/lingo.json', fetcher),
    ).toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      'https://rules.example/lingo.json',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }),
    );
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(1_048_577)));
    await expect(
      fetchRulePackage('https://rules.example/lingo.json', fetcher),
    ).rejects.toThrow('1 MiB');
    fetcher.mockResolvedValueOnce(new Response('{"script":"remote code"}'));
    await expect(
      fetchRulePackage('https://rules.example/lingo.json', fetcher),
    ).rejects.toThrow('Invalid');
  });
});
