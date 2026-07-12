import { describe, expect, it } from 'vitest';
import {
  createCommunityRuleStore,
  type RuleSet,
  resolveRules,
  serializeCommunityRulePayload,
  validateRuleSet,
} from './rule-resolver';

const communityRules: RuleSet = {
  schemaVersion: 1,
  rules: [
    {
      id: 'community-example',
      domain: '*.example.com',
      translationPolicy: 'always',
      selectors: { main: ['article'] },
    },
  ],
};

describe('rule resolver', () => {
  it('merges matching rules from built-in, community, and user layers in priority order', () => {
    expect(
      resolveRules({
        hostname: 'docs.example.com',
        builtIn: {
          schemaVersion: 1,
          rules: [
            {
              id: 'built-in-example',
              domain: '*.example.com',
              selectors: { exclude: ['.advert'] },
            },
          ],
        },
        community: communityRules,
        user: {
          schemaVersion: 1,
          rules: [
            {
              id: 'user-example',
              domain: 'docs.example.com',
              translationPolicy: 'never',
            },
          ],
        },
      }),
    ).toEqual({
      matchedRuleIds: ['built-in-example', 'community-example', 'user-example'],
      selectors: { main: ['article'], exclude: ['.advert'] },
      translationPolicy: 'never',
    });
  });

  it('rejects rules with unknown fields or selector content that could be interpreted as code', () => {
    expect(() =>
      validateRuleSet({
        schemaVersion: 1,
        rules: [
          {
            id: 'unsafe',
            domain: 'example.com',
            script: 'alert(1)',
          },
        ],
      }),
    ).toThrow('unknown field');
    expect(() =>
      validateRuleSet({
        schemaVersion: 1,
        rules: [
          {
            id: 'unsafe-selector',
            domain: 'example.com',
            selectors: { main: ['article; alert(1)'] },
          },
        ],
      }),
    ).toThrow('unsafe selector');
  });

  it('keeps last-known-good community rules when a signed update cannot be verified', async () => {
    let state: { updatesEnabled: boolean; lastKnownGood?: RuleSet } = {
      updatesEnabled: true,
      lastKnownGood: communityRules,
    };
    const store = createCommunityRuleStore({
      getValue: async () => state,
      setValue: async (next) => {
        state = next;
      },
    });
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ]);

    const result = await store.applyUpdate(
      { payload: { schemaVersion: 1, rules: [] }, signature: 'invalid' },
      keyPair.publicKey,
    );

    expect(result).toEqual({ status: 'rejected', rules: communityRules });
    expect(await store.get()).toEqual(state);
  });

  it('accepts a valid signed update and leaves last-known-good unchanged when updates are disabled', async () => {
    let state: { updatesEnabled: boolean; lastKnownGood?: RuleSet } = {
      updatesEnabled: true,
      lastKnownGood: communityRules,
    };
    const store = createCommunityRuleStore({
      getValue: async () => state,
      setValue: async (next) => {
        state = next;
      },
    });
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ]);
    const payload: RuleSet = { schemaVersion: 1, rules: [] };
    const signature = await crypto.subtle.sign(
      'Ed25519',
      keyPair.privateKey,
      new TextEncoder().encode(serializeCommunityRulePayload(payload)),
    );
    const candidate = {
      payload,
      signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
    };

    await expect(
      store.applyUpdate(candidate, keyPair.publicKey),
    ).resolves.toEqual({
      status: 'updated',
      rules: payload,
    });
    await store.setUpdatesEnabled(false);
    await expect(
      store.applyUpdate(candidate, keyPair.publicKey),
    ).resolves.toEqual({
      status: 'disabled',
      rules: payload,
    });
  });
});
