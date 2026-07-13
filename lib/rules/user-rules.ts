import { storage } from '@wxt-dev/storage';
import type { SiteTranslationPolicy } from '../preferences/preference-resolver';
import {
  exportUserRules,
  importUserRules,
  type RuleSet,
  validateRuleSet,
} from './rule-resolver';

const EMPTY_RULE_SET: RuleSet = { schemaVersion: 1, rules: [] };

type RuleItem = {
  getValue(): Promise<RuleSet>;
  setValue(value: RuleSet): Promise<void>;
};

let ruleItem: RuleItem | undefined;

export function createUserRuleStore(item?: RuleItem) {
  const getItem = () => item ?? getRuleItem();
  return {
    async get(): Promise<RuleSet> {
      return validateRuleSet(await getItem().getValue());
    },
    async set(rules: RuleSet): Promise<RuleSet> {
      const normalized = validateRuleSet(rules);
      await getItem().setValue(normalized);
      return normalized;
    },
    async import(serialized: string): Promise<RuleSet> {
      const rules = importUserRules(serialized);
      await getItem().setValue(rules);
      return rules;
    },
    async export(): Promise<string> {
      return exportUserRules(await this.get());
    },
    async translationPolicyFor(
      hostname: string,
    ): Promise<SiteTranslationPolicy> {
      return (
        (await this.get()).rules.find(
          (rule) => rule.domain === hostname.toLowerCase(),
        )?.translationPolicy ?? 'default'
      );
    },
    async setTranslationPolicy(
      hostname: string,
      translationPolicy: SiteTranslationPolicy,
    ): Promise<RuleSet> {
      const current = await this.get();
      const domain = hostname.toLowerCase();
      const existing = current.rules.find((rule) => rule.domain === domain);
      const rules = existing
        ? current.rules.map((rule) =>
            rule === existing ? { ...rule, translationPolicy } : rule,
          )
        : [
            ...current.rules,
            {
              id: siteRuleId(domain),
              domain,
              translationPolicy,
            },
          ];
      return this.set({ schemaVersion: 1, rules });
    },
  };
}

function siteRuleId(domain: string): string {
  const slug = domain.replace(/[^a-z0-9]+/g, '-').slice(0, 44);
  let hash = 2166136261;
  for (const character of domain) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `site-${slug}-${(hash >>> 0).toString(16)}`;
}

function getRuleItem(): RuleItem {
  ruleItem ??= storage.defineItem<RuleSet>('local:userRules', {
    fallback: EMPTY_RULE_SET,
  });
  return ruleItem;
}

export const userRuleStore = createUserRuleStore();
