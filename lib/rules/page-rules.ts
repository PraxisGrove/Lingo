import { BUILT_IN_RULES, resolveRules } from './rule-resolver';

export async function getPageRules(hostname: string) {
  const [{ userRuleStore }, { communityRuleStore }] = await Promise.all([
    import('./user-rules'),
    import('./community-rules'),
  ]);
  const [user, community] = await Promise.all([
    userRuleStore.get(),
    communityRuleStore.get(),
  ]);
  return resolveRules({
    hostname,
    builtIn: BUILT_IN_RULES,
    user,
    community: community.lastKnownGood,
  });
}
