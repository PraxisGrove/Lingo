import { storage } from '@wxt-dev/storage';
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
  };
}

function getRuleItem(): RuleItem {
  ruleItem ??= storage.defineItem<RuleSet>('local:userRules', {
    fallback: EMPTY_RULE_SET,
  });
  return ruleItem;
}

export const userRuleStore = createUserRuleStore();
