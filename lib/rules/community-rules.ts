import { storage } from '@wxt-dev/storage';
import {
  type CommunityRuleState,
  createCommunityRuleStore,
} from './rule-resolver';

const communityRuleItem = storage.defineItem<CommunityRuleState>(
  'local:communityRules',
  { fallback: { updatesEnabled: true } },
);

export const communityRuleStore = createCommunityRuleStore(communityRuleItem);
