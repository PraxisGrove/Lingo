import type {
  DisplayMode,
  SessionSnapshot as PageTranslationSnapshot,
} from '@/lib/page-translation/page-translation';

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
    default:
      return false;
  }
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
