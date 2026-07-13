import type { TranslationCacheStats } from '../cache/translation-cache';
import type {
  ExtensionSettings,
  ProviderKind,
} from '../storage/settings-model';

export type DiagnosticReport = {
  extensionVersion: string;
  generatedAt: string;
  hostPermissionGranted: boolean;
  enabled: boolean;
  theme: ExtensionSettings['theme'];
  sourceLanguage: string;
  targetLanguage: string;
  setupCompleted: boolean;
  configuredProviderCount: number;
  configuredProviderKinds: ProviderKind[];
  fallbackProviderCount: number;
  automaticTranslationEnabled: boolean;
  floatingButtonEnabled: boolean;
  cache: TranslationCacheStats & { enabled: boolean };
};

type DiagnosticInput = {
  extensionVersion: string;
  generatedAt: string;
  hostPermissionGranted: boolean;
  cache: TranslationCacheStats;
  settings: ExtensionSettings;
};

export function createDiagnosticReport({
  extensionVersion,
  generatedAt,
  hostPermissionGranted,
  cache,
  settings,
}: DiagnosticInput): DiagnosticReport {
  return {
    extensionVersion,
    generatedAt,
    hostPermissionGranted,
    enabled: settings.enabled,
    theme: settings.theme,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    setupCompleted: settings.setupCompleted,
    configuredProviderCount: settings.providerProfiles.length,
    configuredProviderKinds: [
      ...new Set(settings.providerProfiles.map((profile) => profile.provider)),
    ],
    fallbackProviderCount: settings.fallbackProviderProfileIds.length,
    automaticTranslationEnabled: settings.autoTranslation.enabled,
    floatingButtonEnabled: settings.floatingButtonEnabled,
    cache: {
      enabled: settings.translationCacheEnabled,
      ...cache,
    },
  };
}
