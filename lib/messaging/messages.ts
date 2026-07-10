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
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string'
  );
}
