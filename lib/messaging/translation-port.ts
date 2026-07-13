import type {
  TranslationEvent,
  TranslationOrchestrator,
  TranslationRequest,
  TranslationUnit,
} from '@/lib/translation/types';

export const TRANSLATION_PORT_NAME = 'lingo-translation-v2';

export type TranslationPortRequest = {
  type: 'translate';
  request: TranslationRequest;
};

export type TranslationPortResponse = {
  type: 'translation-event';
  event: TranslationEvent;
};

export function isTranslationPortRequest(
  value: unknown,
): value is TranslationPortRequest {
  if (
    !isRecordWithKeys(value, ['type', 'request']) ||
    value.type !== 'translate'
  ) {
    return false;
  }

  const request = value.request;
  return (
    isRecordWithOptionalKeys(
      request,
      [
        'sessionId',
        'pageRevision',
        'sourceLanguage',
        'targetLanguage',
        'units',
      ],
      ['pageTitle'],
    ) &&
    typeof request.sessionId === 'string' &&
    Number.isInteger(request.pageRevision) &&
    typeof request.sourceLanguage === 'string' &&
    typeof request.targetLanguage === 'string' &&
    (request.pageTitle === undefined ||
      typeof request.pageTitle === 'string') &&
    Array.isArray(request.units) &&
    request.units.every(isTranslationUnit)
  );
}

export function isTranslationPortResponse(
  value: unknown,
): value is TranslationPortResponse {
  if (
    !isRecordWithKeys(value, ['type', 'event']) ||
    value.type !== 'translation-event'
  ) {
    return false;
  }

  return isTranslationEvent(value.event);
}

function isTranslationEvent(value: unknown): value is TranslationEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const event = value as Record<string, unknown>;
  const commonKeys = ['type', 'sessionId', 'pageRevision'];
  const hasCommonFields =
    typeof event.sessionId === 'string' && Number.isInteger(event.pageRevision);
  if (!hasCommonFields) return false;

  switch (event.type) {
    case 'queued':
      return (
        isRecordWithKeys(event, [...commonKeys, 'unitId']) &&
        typeof event.unitId === 'string'
      );
    case 'translated':
      return (
        isRecordWithKeys(event, [...commonKeys, 'unitId', 'text']) &&
        typeof event.unitId === 'string' &&
        typeof event.text === 'string'
      );
    case 'failed':
      return (
        isRecordWithKeys(event, [...commonKeys, 'unitId', 'message']) &&
        typeof event.unitId === 'string' &&
        typeof event.message === 'string'
      );
    case 'paused':
      return (
        isRecordWithKeys(event, [...commonKeys, 'unitId', 'reason']) &&
        event.unitId === null &&
        typeof event.reason === 'string'
      );
    case 'completed':
      return (
        isRecordWithKeys(event, [...commonKeys, 'unitId']) &&
        event.unitId === null
      );
    default:
      return false;
  }
}

function isTranslationUnit(value: unknown): value is TranslationUnit {
  return (
    isRecordWithKeys(value, ['id', 'number', 'text']) &&
    typeof value.id === 'string' &&
    Number.isInteger(value.number) &&
    (value.number as number) > 0 &&
    typeof value.text === 'string'
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

function isRecordWithOptionalKeys(
  value: unknown,
  requiredKeys: string[],
  optionalKeys: string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).every((key) =>
      [...requiredKeys, ...optionalKeys].includes(key),
    ) &&
    requiredKeys.every((key) => key in value)
  );
}

export type TranslationPortClient = {
  translate(
    units: TranslationUnit[],
    targetLanguage: string,
  ): Promise<TranslationUnit[]>;
  disconnect(): void;
};

export type TranslationRuntimePort = {
  name: string;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
  postMessage(message: unknown): void;
  disconnect(): void;
};

export function createTranslationPortClient(
  connect: () => TranslationRuntimePort = () =>
    browser.runtime.connect({ name: TRANSLATION_PORT_NAME }),
  createSessionId: () => string = () => crypto.randomUUID(),
  getDisconnectError: () => string | undefined = () =>
    browser.runtime.lastError?.message,
  getPageTitle: () => string = () =>
    typeof document === 'undefined' ? '' : document.title,
): TranslationPortClient {
  let port: TranslationRuntimePort | undefined;
  let disconnected = false;
  let disconnectReason: string | undefined;
  let closed = false;

  const ensurePort = () => {
    if (port && !disconnected) return port;
    port = connect();
    disconnected = false;
    disconnectReason = undefined;
    return port;
  };

  return {
    translate(units, targetLanguage) {
      if (closed) {
        return Promise.reject(
          disconnectError('The translation client was closed.'),
        );
      }
      const activePort = ensurePort();
      const sessionId = createSessionId();

      return new Promise((resolve, reject) => {
        const translations: TranslationUnit[] = [];
        let reconnectAttempts = 0;
        let listenerPort = activePort;

        const cleanup = () => {
          listenerPort.onMessage.removeListener(onMessage);
          listenerPort.onDisconnect.removeListener(onDisconnect);
        };

        const onDisconnect = () => {
          disconnected = true;
          const reason = getDisconnectError();
          disconnectReason = reason ?? 'The extension port disconnected.';
          cleanup();
          if (!closed && reconnectAttempts < 1) {
            reconnectAttempts += 1;
            start(ensurePort());
            return;
          }
          reject(disconnectError(disconnectReason));
        };

        const onMessage = (message: unknown) => {
          if (!isTranslationPortResponse(message)) return;
          const { event } = message;
          if (event.sessionId !== sessionId || event.pageRevision !== 0) return;

          if (event.type === 'translated') {
            const unit = units.find((item) => item.id === event.unitId);
            if (unit) translations.push({ ...unit, text: event.text });
          } else if (event.type === 'completed') {
            cleanup();
            resolve(translations);
          } else if (event.type === 'paused') {
            cleanup();
            reject(new Error(event.reason));
          }
        };

        const start = (requestPort: TranslationRuntimePort) => {
          listenerPort = requestPort;
          requestPort.onMessage.addListener(onMessage);
          requestPort.onDisconnect.addListener(onDisconnect);
          requestPort.postMessage({
            type: 'translate',
            request: {
              sessionId,
              pageRevision: 0,
              sourceLanguage: 'auto',
              targetLanguage,
              pageTitle: getPageTitle(),
              units,
            },
          } satisfies TranslationPortRequest);
        };

        start(activePort);
      });
    },
    disconnect() {
      closed = true;
      port?.disconnect();
      port = undefined;
      disconnected = true;
    },
  };
}

function disconnectError(reason: string): Error {
  return new Error(`Translation connection closed: ${reason}`);
}

export function serveTranslationPort(
  port: TranslationRuntimePort,
  orchestrator: TranslationOrchestrator,
  onError: (error: unknown) => void,
): void {
  const activeSessions = new Set<string>();
  port.onDisconnect.addListener(() => {
    for (const sessionId of activeSessions) {
      void orchestrator.cancel(sessionId);
    }
    activeSessions.clear();
  });

  port.onMessage.addListener((message) => {
    if (!isTranslationPortRequest(message)) return;
    activeSessions.add(message.request.sessionId);

    void (async () => {
      try {
        for await (const event of orchestrator.translate(message.request)) {
          port.postMessage({
            type: 'translation-event',
            event,
          } satisfies TranslationPortResponse);
        }
      } finally {
        activeSessions.delete(message.request.sessionId);
      }
    })().catch(onError);
  });
}
