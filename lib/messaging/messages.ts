import type {
  DisplayMode,
  SessionSnapshot as PageTranslationSnapshot,
} from '@/lib/page-translation/page-translation';
import type { ProviderProfile } from '@/lib/storage/settings-model';

export type MessageSource = 'popup' | 'options' | 'content';

export type ExtensionMessages = {
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
      displayMode: DisplayMode;
    };
    response: PageTranslationSnapshot;
  };
  stopPageTranslation: {
    request: Record<string, never>;
    response: PageTranslationSnapshot;
  };
  saveProviderProfile: {
    request: { profile: ProviderProfile; credential: string };
    response: { ok: true };
  };
  testProviderConnection: {
    request: { profile: ProviderProfile; credential: string };
    response: { ok: true } | { ok: false; category: string; message: string };
  };
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
    case 'ping':
      return (
        isRecordWithKeys(message.payload, ['source']) &&
        ['popup', 'options', 'content'].includes(
          message.payload.source as string,
        )
      );
    case 'getPageTranslation':
    case 'stopPageTranslation':
      return isRecordWithKeys(message.payload, []);
    case 'startPageTranslation':
      return (
        isRecordWithKeys(message.payload, ['targetLanguage', 'displayMode']) &&
        typeof message.payload.targetLanguage === 'string' &&
        isDisplayMode(message.payload.displayMode)
      );
    case 'saveProviderProfile':
      return (
        isRecordWithKeys(message.payload, ['profile', 'credential']) &&
        isProviderProfile(message.payload.profile) &&
        typeof message.payload.credential === 'string'
      );
    case 'testProviderConnection':
      return (
        isRecordWithKeys(message.payload, ['profile', 'credential']) &&
        isProviderProfile(message.payload.profile) &&
        typeof message.payload.credential === 'string'
      );
    default:
      return false;
  }
}

function isProviderProfile(value: unknown): value is ProviderProfile {
  if (value == null || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  const optionalKeys = ['endpoint', 'model', 'region'].filter((key) => key in profile);
  return (
    isRecordWithKeys(profile, ['id', 'name', 'provider', ...optionalKeys]) &&
    typeof profile.id === 'string' &&
    typeof profile.name === 'string' &&
    ['openai-compatible', 'deepl', 'google-cloud', 'azure-translator'].includes(profile.provider as string) &&
    optionalKeys.every((key) => typeof profile[key] === 'string')
  );
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return value === 'bilingual';
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
