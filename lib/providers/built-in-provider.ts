import type {
  ProviderBatchInput,
  ProviderBatchResult,
} from '../translation/orchestrator';
import type {
  BuiltInAvailability,
  BuiltInTranslationEngine,
  LanguagePair,
} from './built-in-translator';
import { type ConfiguredTranslationProvider, ProviderError } from './provider';

export function createBuiltInProvider(
  engine: BuiltInTranslationEngine,
): ConfiguredTranslationProvider {
  return {
    capabilities: {
      maxBatchSize: 20,
      maxBatchCharacters: 6_000,
      supportsContext: false,
      supportsNativeGlossary: false,
      supportsStructuredOutput: false,
      supportsStreaming: false,
    },
    translateBatch: (input) => engine.translate(input),
    async testConnection() {
      const availability = await engine.availability({
        sourceLanguage: 'en',
        targetLanguage: 'es',
      });
      if (availability === 'unavailable')
        throw new ProviderError(
          'unsupported',
          'This browser does not provide on-device translation.',
        );
    },
  };
}

export type BuiltInRequest =
  | { kind: 'translate'; requestId: string; input: SerializableBatchInput }
  | { kind: 'availability'; pair: LanguagePair }
  | { kind: 'cancel'; requestId: string };

export type BuiltInResponse =
  | { ok: true; result: ProviderBatchResult | BuiltInAvailability }
  | { ok: false; category: string; message: string };

type SerializableBatchInput = Omit<ProviderBatchInput, 'signal'>;

export const BUILT_IN_MESSAGE_TARGET = 'lingo-built-in-translation';

/**
 * Routes on-device translation through the offscreen document, the only
 * extension context besides visible pages where the browser exposes the
 * Translator API.
 */
export function createOffscreenBuiltInEngine(
  send: (request: BuiltInRequest) => Promise<BuiltInResponse | undefined>,
): BuiltInTranslationEngine {
  async function call(request: BuiltInRequest) {
    const response = await send(request);
    if (!response)
      throw new ProviderError(
        'unavailable',
        'On-device translation did not respond.',
      );
    if (!response.ok)
      throw new ProviderError(
        isProviderErrorCategory(response.category)
          ? response.category
          : 'unavailable',
        response.message,
      );
    return response.result;
  }

  return {
    availability: (pair) =>
      call({ kind: 'availability', pair }) as Promise<BuiltInAvailability>,
    async translate(input) {
      const { signal, ...serializable } = input;
      signal?.throwIfAborted();
      const requestId = crypto.randomUUID();
      const cancel = () => void send({ kind: 'cancel', requestId });
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        return (await call({
          kind: 'translate',
          requestId,
          input: serializable,
        })) as ProviderBatchResult;
      } catch (error) {
        signal?.throwIfAborted();
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

export function serveBuiltInRequests(engine: BuiltInTranslationEngine) {
  const running = new Map<string, AbortController>();
  return async (request: BuiltInRequest): Promise<BuiltInResponse> => {
    if (request.kind === 'cancel') {
      running.get(request.requestId)?.abort();
      return { ok: true, result: [] };
    }
    try {
      if (request.kind === 'availability')
        return { ok: true, result: await engine.availability(request.pair) };
      const controller = new AbortController();
      running.set(request.requestId, controller);
      try {
        return {
          ok: true,
          result: await engine.translate({
            ...request.input,
            signal: controller.signal,
          }),
        };
      } finally {
        running.delete(request.requestId);
      }
    } catch (error) {
      return error instanceof ProviderError
        ? { ok: false, category: error.category, message: error.message }
        : {
            ok: false,
            category: 'unavailable',
            message: 'On-device translation failed.',
          };
    }
  };
}

const CATEGORIES = [
  'authentication',
  'quota',
  'rate-limit',
  'invalid-request',
  'unavailable',
  'network',
  'invalid-response',
  'unsupported',
  'language-pack',
] as const;

function isProviderErrorCategory(
  value: string,
): value is (typeof CATEGORIES)[number] {
  return (CATEGORIES as readonly string[]).includes(value);
}
