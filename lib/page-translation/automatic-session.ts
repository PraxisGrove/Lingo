import { resolvePreferences } from '../preferences/preference-resolver';
import {
  BUILT_IN_RULES,
  type CommunityRuleState,
  type RuleSet,
  resolveRules,
} from '../rules/rule-resolver';
import type { ExtensionSettings } from '../storage/settings-model';
import type { PageTranslation } from './page-translation';

type AutomaticTranslationDocument = {
  location: Pick<Location, 'hostname'>;
  documentElement: Pick<HTMLElement, 'lang'>;
};

type AutomaticTranslationDependencies = {
  getSettings(): Promise<ExtensionSettings>;
  getUserRules(): Promise<RuleSet>;
  getCommunityRules(): Promise<CommunityRuleState>;
};

export function createAutomaticTranslationStarter(
  dependencies: AutomaticTranslationDependencies,
) {
  return async function startAutomaticTranslation(
    pageTranslation: PageTranslation,
    document: AutomaticTranslationDocument,
  ): Promise<void> {
    const settings = await dependencies.getSettings();
    if (!settings.enabled || !settings.activeProviderProfileId) return;

    const hostname = document.location.hostname;
    const builtIn = resolveRules({ hostname, builtIn: BUILT_IN_RULES });
    const community = (await dependencies.getCommunityRules()).lastKnownGood;
    const rules = resolveRules({
      hostname,
      builtIn: BUILT_IN_RULES,
      community,
      user: await dependencies.getUserRules(),
    });
    const preferences = resolvePreferences({
      hostname,
      sourceLanguage: document.documentElement.lang || undefined,
      global: settings.autoTranslation,
      site: rules,
      isDefaultAutoSite: builtIn.matchedRuleIds.length > 0,
    });
    if (!preferences.autoTranslate) return;

    await pageTranslation.start({
      targetLanguage: settings.targetLanguage,
      displayMode: 'bilingual',
      translateImmediately: false,
    });
  };
}

export async function startAutomaticTranslation(
  pageTranslation: PageTranslation,
  document: AutomaticTranslationDocument,
): Promise<void> {
  const [{ getSettings }, { communityRuleStore }, { userRuleStore }] =
    await Promise.all([
      import('../storage/settings'),
      import('../rules/community-rules'),
      import('../rules/user-rules'),
    ]);
  return createAutomaticTranslationStarter({
    getSettings,
    getUserRules: () => userRuleStore.get(),
    getCommunityRules: () => communityRuleStore.get(),
  })(pageTranslation, document);
}
