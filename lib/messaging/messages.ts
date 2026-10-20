import type { TranslationCacheStats } from '@/lib/cache/translation-cache';
import type { DiagnosticReport } from '@/lib/diagnostics/diagnostics';
import type {
  DisplayMode,
  SessionSnapshot as PageTranslationSnapshot,
} from '@/lib/page-translation/page-translation';
import type { ProviderModelResult } from '@/lib/providers/model-discovery';
import { isProviderIconPreference } from '@/lib/providers/provider-icon-model';
import {
  MAX_CUSTOM_HEADERS,
  resolveCustomHeaders,
  validHeaderValue,
} from '@/lib/providers/request-options';
import {
  PROVIDER_TUNING_LIMITS,
  type ProviderProfile,
} from '@/lib/storage/settings-model';
import type { SubtitleSnapshot } from '@/lib/subtitles/controller';
import type { TextAction } from '@/lib/ui/text-tools';
import type { RankedWord } from '@/lib/vocabulary/word-ranks';

export type MessageSource = 'popup' | 'options' | 'content';

export type ExtensionMessages = {
  updateCommunityRules: {
    request: { url: string; publicKey: string };
    response: {
      status: 'updated' | 'rejected' | 'disabled' | 'unconfigured' | 'current';
    };
  };

  openSettings: { request: Record<string, never>; response: { ok: true } };
  runTextAction: { request: { action: TextAction }; response: { ok: true } };

  pageNavigation: {
    request: Record<string, never>;
    response: PageTranslationSnapshot;
  };
  ping: {
    request: {
      source: MessageSource;
    };
    response: {
      ok: true;
      timestamp: number;
      extensionId: string;
    };
  };
  getPageTranslation: {
    request: Record<string, never>;
    response: PageTranslationSnapshot;
  };
  startPageTranslation: {
    request: {
      targetLanguage: string;
      restart?: boolean;
      displayMode: DisplayMode;
      contentScope?: 'main' | 'main-and-interface';
      translateImmediately?: boolean;
    };
    response: PageTranslationSnapshot;
  };
  updatePageTranslation: {
    request: {
      displayMode: DisplayMode;
      translateImmediately?: boolean;
      retryFailed?: boolean;
    };
    response: PageTranslationSnapshot;
  };
  stopPageTranslation: {
    request: Record<string, never>;
    response: PageTranslationSnapshot;
  };
  saveProviderProfile: {
    request: ProviderDraftRequest;
    response: { ok: true };
  };
  testProviderConnection: {
    request: ProviderDraftRequest;
    response: { ok: true } | { ok: false; category: string; message: string };
  };
  listProviderModels: {
    request: ProviderDraftRequest;
    response: ProviderModelResult;
  };
  deleteProviderProfile: {
    request: { profileId: string };
    response: { ok: true };
  };
  clearTranslationCache: {
    request: Record<string, never>;
    response: { ok: true };
  };
  getExtensionStatus: {
    request: Record<string, never>;
    response: {
      hostPermissionGranted: boolean;
      cache: TranslationCacheStats;
    };
  };
  exportDiagnostics: {
    request: Record<string, never>;
    response: DiagnosticReport;
  };
  getSubtitleState: {
    request: Record<string, never>;
    response: SubtitleSnapshot;
  };
  startSubtitles: {
    request: Record<string, never>;
    response: SubtitleSnapshot;
  };
  stopSubtitles: {
    request: Record<string, never>;
    response: SubtitleSnapshot;
  };
  fetchCaptionFile: {
    request: { url: string };
    response: { ok: true; text: string } | { ok: false };
  };
  classifyWords: {
    request: { words: string[] };
    response: { ranks: Record<string, RankedWord | null> };
  };
};

export const MAX_CLASSIFIED_WORDS = 2000;

export type ProviderDraftRequest = {
  profile: ProviderProfile;
  credential: string;
  /** Secret header values by header name; never stored in settings. */
  headerSecrets?: Record<string, string>;
};

export type MessageName = keyof ExtensionMessages;

export type ExtensionMessage<TName extends MessageName = MessageName> = {
  [Name in MessageName]: {
    type: Name;
    payload: ExtensionMessages[Name]['request'];
  };
}[TName];

export function createMessage<TName extends MessageName>(
  type: TName,
  payload: ExtensionMessages[TName]['request'],
): ExtensionMessage<TName> {
  return { type, payload } as ExtensionMessage<TName>;
}

export function isExtensionMessage(
  message: unknown,
): message is ExtensionMessage {
  if (!isRecordWithKeys(message, ['type', 'payload'])) return false;

  switch (message.type) {
    case 'updateCommunityRules':
      return (
        isRecordWithKeys(message.payload, ['url', 'publicKey']) &&
        typeof message.payload.url === 'string' &&
        typeof message.payload.publicKey === 'string'
      );
    case 'runTextAction':
      return (
        isRecordWithKeys(message.payload, ['action']) &&
        ['selection', 'paragraph', 'input', 'open', 'undo'].includes(
          message.payload.action as string,
        )
      );
    case 'ping':
      return (
        isRecordWithKeys(message.payload, ['source']) &&
        ['popup', 'options', 'content'].includes(
          message.payload.source as string,
        )
      );
    case 'openSettings':
    case 'getSubtitleState':
    case 'startSubtitles':
    case 'stopSubtitles':
    case 'getPageTranslation':
    case 'pageNavigation':
    case 'stopPageTranslation':
    case 'clearTranslationCache':
    case 'getExtensionStatus':
    case 'exportDiagnostics':
      return isRecordWithKeys(message.payload, []);
    case 'startPageTranslation':
      return (
        isRecordWithRequiredAndOptionalKeys(
          message.payload,
          ['targetLanguage', 'displayMode'],
          ['contentScope', 'translateImmediately', 'restart'],
        ) &&
        typeof message.payload.targetLanguage === 'string' &&
        (message.payload.restart === undefined ||
          typeof message.payload.restart === 'boolean') &&
        isDisplayMode(message.payload.displayMode) &&
        (message.payload.contentScope === undefined ||
          ['main', 'main-and-interface'].includes(
            message.payload.contentScope as string,
          )) &&
        (message.payload.translateImmediately === undefined ||
          typeof message.payload.translateImmediately === 'boolean')
      );
    case 'updatePageTranslation':
      return (
        isRecordWithRequiredAndOptionalKeys(
          message.payload,
          ['displayMode'],
          ['translateImmediately', 'retryFailed'],
        ) &&
        isDisplayMode(message.payload.displayMode) &&
        (message.payload.translateImmediately === undefined ||
          typeof message.payload.translateImmediately === 'boolean') &&
        (message.payload.retryFailed === undefined ||
          typeof message.payload.retryFailed === 'boolean')
      );
    case 'saveProviderProfile':
    case 'testProviderConnection':
    case 'listProviderModels':
      return (
        isRecordWithRequiredAndOptionalKeys(
          message.payload,
          ['profile', 'credential'],
          ['headerSecrets'],
        ) &&
        isProviderProfile(message.payload.profile) &&
        typeof message.payload.credential === 'string' &&
        (message.payload.headerSecrets === undefined ||
          isHeaderSecrets(message.payload.headerSecrets))
      );
    case 'fetchCaptionFile':
      return (
        isRecordWithKeys(message.payload, ['url']) &&
        typeof message.payload.url === 'string' &&
        message.payload.url.length <= 4096 &&
        /^https?:\/\//.test(message.payload.url)
      );
    case 'classifyWords':
      return (
        isRecordWithKeys(message.payload, ['words']) &&
        Array.isArray(message.payload.words) &&
        message.payload.words.length <= MAX_CLASSIFIED_WORDS &&
        message.payload.words.every(
          (word) => typeof word === 'string' && /^[a-z-]{1,64}$/.test(word),
        )
      );
    case 'deleteProviderProfile':
      return (
        isRecordWithKeys(message.payload, ['profileId']) &&
        typeof message.payload.profileId === 'string'
      );
    default:
      return false;
  }
}

function isHeaderSecrets(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_CUSTOM_HEADERS &&
    entries.every(
      ([name, secret]) =>
        resolveCustomHeaders([{ name }]).length === 1 &&
        typeof secret === 'string' &&
        validHeaderValue(secret),
    )
  );
}

function isProviderProfile(value: unknown): value is ProviderProfile {
  if (value == null || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  const optionalKeys = [
    'endpoint',
    'model',
    'region',
    'nativeGlossaryId',
    'models',
    'modelSelection',
    'icon',
    'tuning',
    'headers',
    'credentialHeader',
  ].filter((key) => key in profile);
  return (
    isRecordWithKeys(profile, ['id', 'name', 'provider', ...optionalKeys]) &&
    typeof profile.id === 'string' &&
    typeof profile.name === 'string' &&
    [
      'openai-compatible',
      'openai-responses',
      'anthropic',
      'gemini',
      'deepl',
      'google-cloud',
      'azure-translator',
      'built-in',
    ].includes(profile.provider as string) &&
    optionalKeys.every((key) => {
      if (key === 'headers')
        return (
          Array.isArray(profile.headers) &&
          resolveCustomHeaders(profile.headers).length ===
            profile.headers.length
        );
      if (key === 'credentialHeader')
        return profile.credentialHeader === 'api-key';
      if (key === 'tuning')
        return (
          typeof profile.tuning === 'object' &&
          profile.tuning !== null &&
          !Array.isArray(profile.tuning) &&
          Object.entries(profile.tuning).every(
            ([name, value]) =>
              name in PROVIDER_TUNING_LIMITS &&
              typeof value === 'number' &&
              Number.isFinite(value),
          )
        );
      if (key === 'icon')
        return (
          profile.icon === undefined || isProviderIconPreference(profile.icon)
        );
      if (key === 'models')
        return (
          Array.isArray(profile.models) &&
          profile.models.length <= 1000 &&
          profile.models.every(
            (model) =>
              isRecordWithRequiredAndOptionalKeys(
                model,
                ['id', 'name'],
                ['protocols'],
              ) &&
              typeof model.id === 'string' &&
              typeof model.name === 'string' &&
              (model.protocols === undefined ||
                (Array.isArray(model.protocols) &&
                  model.protocols.every((protocol) =>
                    [
                      'openai-compatible',
                      'openai-responses',
                      'anthropic',
                    ].includes(protocol as string),
                  ))),
          )
        );
      if (key === 'modelSelection')
        return ['recommended', 'manual'].includes(
          profile.modelSelection as string,
        );
      return typeof profile[key] === 'string';
    })
  );
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return ['bilingual', 'translation', 'original'].includes(value as string);
}

function isRecordWithRequiredAndOptionalKeys(
  value: unknown,
  required: string[],
  optional: string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value);
  return (
    required.every((key) => key in value) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isRecordWithKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
