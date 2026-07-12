import { describe, expect, it } from 'vitest';
import type { RuleSet } from './rule-resolver';
import { createUserRuleStore } from './user-rules';

describe('user rule store', () => {
  it('validates imports before replacing saved user rules and exports normalized JSON', async () => {
    let value: RuleSet = { schemaVersion: 1, rules: [] };
    const store = createUserRuleStore({
      getValue: async () => value,
      setValue: async (next) => {
        value = next;
      },
    });

    const rules = await store.import(
      JSON.stringify({
        schemaVersion: 1,
        rules: [
          {
            id: 'docs',
            domain: 'docs.example.com',
            translationPolicy: 'never',
          },
        ],
      }),
    );

    expect(rules.rules).toHaveLength(1);
    expect(await store.export()).toContain('"translationPolicy":"never"');
    await expect(store.import('{"rules":[]}')).rejects.toThrow(
      'unsupported rule schema',
    );
    expect((await store.get()).rules).toHaveLength(1);
  });
});
