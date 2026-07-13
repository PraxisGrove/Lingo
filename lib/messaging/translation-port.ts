import type {
  TranslationClientFailure,
  TranslationClientResult,
} from '@/lib/page-translation/page-translation';
import type {
  TranslationEvent,
  TranslationOrchestrator,
  TranslationRequest,
  TranslationUnit,
} from '@/lib/translation/types';

export const TRANSLATION_PORT_NAME = 'lingo-translation-v3';

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
      ['pageTitle', 'siteHostname'],
    ) &&
    typeof request.sessionId === 'string' &&
    Number.isInteger(request.pageRevision) &&
    typeof request.sourceLanguage === 'string' &&
    typeof request.targetLanguage === 'string' &&
    (request.pageTitle === undefined ||
      typeof request.pageTitle === 'string') &&
    (request.siteHostname === undefined ||
      typeof request.siteHostname === 'string') &&
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
        isRecordWithKeys(event, [
          ...commonKeys,
          'unitId',
          'category',
          'message',
        ]) &&
        typeof event.unitId === 'string' &&
        typeof event.category === 'string' &&
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
  ): Promise<TranslationClientResult>;
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
  getSiteHostname: () => string = () =>
    typeof location === 'undefined' ? '' : location.hostname,
): TranslationPortClient {
  let port: TranslationRuntimePort | undefined;
  let closed = false;

  const ensurePort = () => {
    if (port) return port;
    port = connect();
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
        const failures: TranslationClientFailure[] = [];
        let reconnectAttempts = 0;
        let listenerPort = activePort;

        const cleanup = () => {
          listenerPort.onMessage.removeListener(onMessage);
          listenerPort.onDisconnect.removeListener(onDisconnect);
        };

        const onDisconnect = () => {
          const reason = getDisconnectError();
          const disconnectReason = reason ?? 'The extension port disconnected.';
          cleanup();
          if (port === listenerPort) port = undefined;
          if (!closed && reconnectAttempts < 1) {
            reconnectAttempts += 1;
            try {
              start(ensurePort());
            } catch (error) {
              reject(
                disconnectError(
                  error instanceof Error ? error.message : disconnectReason,
                ),
              );
            }
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
            const failure = failures[0];
            if (failure && translations.length === 0) {
              reject(translationError(failure));
            } else if (failure) resolve({ translations, failures });
            else resolve(translations);
          } else if (event.type === 'failed') {
            failures.push({
              unitId: event.unitId,
              category: event.category,
              message: event.message,
            });
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
              siteHostname: getSiteHostname(),
              units,
            },
          } satisfies TranslationPortRequest);
        };

        start(activePort);
      });
    },
    disconnect() {
      closed = true;
      const activePort = port;
      port = undefined;
      activePort?.disconnect();
    },
  };
}

function disconnectError(reason: string): Error {
  return new Error(`Translation connection closed: ${reason}`);
}

function translationError(failure: {
  category: string;
  message: string;
}): Error & { category: string } {
  return Object.assign(new Error(failure.message), {
    category: failure.category,
  });
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
    })().catch((error) => {
      onError(error);
      for (const unit of message.request.units) {
        port.postMessage({
          type: 'translation-event',
          event: {
            type: 'failed',
            sessionId: message.request.sessionId,
            pageRevision: message.request.pageRevision,
            unitId: unit.id,
            category: errorCategory(error),
            message:
              error instanceof Error ? error.message : 'Translation failed.',
          },
        } satisfies TranslationPortResponse);
      }
      port.postMessage({
        type: 'translation-event',
        event: {
          type: 'completed',
          sessionId: message.request.sessionId,
          pageRevision: message.request.pageRevision,
          unitId: null,
        },
      } satisfies TranslationPortResponse);
    });
  });
}

function errorCategory(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    typeof error.category === 'string'
    ? error.category
    : 'unknown';
}
