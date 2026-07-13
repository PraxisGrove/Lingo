import type { TranslationCache } from '../cache/translation-cache';
import { resolveTranslationQuality, type TranslationQuality } from './quality';
import type {
  TranslationEvent,
  TranslationOrchestrator,
  TranslationRequest,
  TranslationUnit,
} from './types';

export type ProviderBatchInput = {
  sourceLanguage: string;
  targetLanguage: string;
  units: TranslationUnit[];
  quality: TranslationQuality;
  context?: {
    pageTitle?: string;
    units: TranslationUnit[];
  };
};

export type ProviderBatchResult = Array<{
  id: string;
  text: string;
}>;

export type ProviderCapabilities = {
  maxBatchSize: number;
  supportsContext: boolean;
  supportsNativeGlossary: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
};

export type TranslationProvider = {
  id?: string;
  capabilities: ProviderCapabilities;
  translateBatch(input: ProviderBatchInput): Promise<ProviderBatchResult>;
};

export type TranslationOrchestratorOptions = {
  cache?: TranslationCache;
  fallbackProviders?: TranslationProvider[];
  maxConcurrentBatches?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
  quality?: (request: TranslationRequest) => Promise<TranslationQuality>;
};

export type TranslationProviderResolver = () => Promise<TranslationProvider[]>;

export function createTranslationOrchestrator(
  provider: TranslationProvider | TranslationProviderResolver,
  options: TranslationOrchestratorOptions = {},
): TranslationOrchestrator {
  const cancelledSessions = new Set<string>();
  const maxConcurrentBatches = Math.max(1, options.maxConcurrentBatches ?? 2);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 20_000);
  const wait = options.wait ?? ((milliseconds) => delay(milliseconds));

  return {
    async *translate(request: TranslationRequest) {
      cancelledSessions.delete(request.sessionId);

      for (const unit of request.units) {
        yield eventForUnit(request, unit.id, 'queued');
      }
      const quality = options.quality
        ? await options.quality(request)
        : resolveTranslationQuality();

      const outcomes = await translateUnits(
        request,
        [
          ...(typeof provider === 'function' ? await provider() : [provider]),
          ...(options.fallbackProviders ?? []),
        ],
        options.cache,
        quality,
        maxConcurrentBatches,
        maxAttempts,
        timeoutMs,
        wait,
        () => cancelledSessions.has(request.sessionId),
      );

      for (const outcome of outcomes) {
        if (cancelledSessions.has(request.sessionId)) return;
        if (outcome.type === 'paused') {
          yield {
            ...outcome,
            sessionId: request.sessionId,
            pageRevision: request.pageRevision,
          };
        } else if (outcome.type === 'translated') {
          yield {
            ...eventForUnit(request, outcome.unitId, 'translated'),
            text: outcome.text,
          };
        } else {
          yield {
            ...eventForUnit(request, outcome.unitId, 'failed'),
            category: outcome.category,
            message: outcome.message,
          };
        }
      }

      yield {
        type: 'completed',
        sessionId: request.sessionId,
        pageRevision: request.pageRevision,
        unitId: null,
      };
    },
    async cancel(sessionId) {
      cancelledSessions.add(sessionId);
    },
  };
}

type Outcome =
  | { type: 'translated'; unitId: string; text: string }
  | { type: 'failed'; unitId: string; category: string; message: string }
  | { type: 'paused'; unitId: null; reason: string };

const MAX_CONTEXT_UNIT_CHARACTERS = 600;

async function translateUnits(
  request: TranslationRequest,
  providers: TranslationProvider[],
  cache: TranslationCache | undefined,
  quality: TranslationQuality,
  maxConcurrentBatches: number,
  maxAttempts: number,
  timeoutMs: number,
  wait: (milliseconds: number) => Promise<void>,
  cancelled: () => boolean,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let pending = request.units;
  for (const [providerIndex, provider] of providers.entries()) {
    if (cancelled() || pending.length === 0) break;
    const providerId = provider.id ?? `provider-${providerIndex}`;
    const unresolved: TranslationUnit[] = [];
    for (const unit of pending) {
      const cached = await cache?.get({
        providerId,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        qualityVersion: quality.version,
        text: unit.text,
      });
      if (cached === undefined) unresolved.push(unit);
      else outcomes.push({ type: 'translated', unitId: unit.id, text: cached });
    }
    if (unresolved.length === 0) return outcomes;

    const batches = split(
      unresolved,
      normalizedBatchSize(provider.capabilities.maxBatchSize),
    );
    const batchOutcomes = await mapConcurrent(
      batches,
      maxConcurrentBatches,
      async (units) => {
        try {
          const results = await attemptBatch(
            provider,
            request,
            units,
            quality,
            maxAttempts,
            timeoutMs,
            wait,
            cancelled,
          );
          const resultsById = validatedResults(units, results);
          const found: Outcome[] = [];
          for (const unit of units) {
            const text = resultsById.get(unit.id);
            if (text === undefined) {
              found.push({
                type: 'failed',
                unitId: unit.id,
                category: 'invalid-response',
                message: 'The translation provider did not return this unit.',
              });
            } else {
              await cache?.set(
                {
                  providerId,
                  sourceLanguage: request.sourceLanguage,
                  targetLanguage: request.targetLanguage,
                  qualityVersion: quality.version,
                  text: unit.text,
                },
                text,
              );
              found.push({ type: 'translated', unitId: unit.id, text });
            }
          }
          return found;
        } catch (error) {
          if (isFallbackError(error) && providerIndex < providers.length - 1)
            return [];
          return units.map((unit) => ({
            type: 'failed' as const,
            unitId: unit.id,
            category: category(error) ?? 'unknown',
            message: errorMessage(error),
          }));
        }
      },
    );
    const flattened = batchOutcomes.flat();
    outcomes.push(...flattened);
    const resolvedIds = new Set(
      flattened
        .filter((outcome) => outcome.type === 'translated')
        .map((outcome) => outcome.unitId),
    );
    const failedIds = new Set(
      flattened
        .filter((outcome) => outcome.type === 'failed')
        .map((outcome) => outcome.unitId),
    );
    pending = unresolved.filter(
      (unit) => !resolvedIds.has(unit.id) && !failedIds.has(unit.id),
    );
    if (pending.length > 0 && providerIndex < providers.length - 1) {
      outcomes.push({
        type: 'paused',
        unitId: null,
        reason: 'Switching to an explicitly configured fallback service.',
      });
    }
  }
  return outcomes;
}

function validatedResults(
  units: TranslationUnit[],
  results: ProviderBatchResult,
): Map<string, string> {
  const requestedIds = new Set(units.map((unit) => unit.id));
  const valid = new Map<string, string>();
  const invalidIds = new Set<string>();
  for (const result of results) {
    if (
      !requestedIds.has(result.id) ||
      typeof result.text !== 'string' ||
      result.text.trim().length === 0 ||
      valid.has(result.id) ||
      invalidIds.has(result.id)
    ) {
      invalidIds.add(result.id);
      valid.delete(result.id);
      continue;
    }
    valid.set(result.id, result.text);
  }
  return valid;
}

async function attemptBatch(
  provider: TranslationProvider,
  request: TranslationRequest,
  units: TranslationUnit[],
  quality: TranslationQuality,
  maxAttempts: number,
  timeoutMs: number,
  wait: (milliseconds: number) => Promise<void>,
  cancelled: () => boolean,
): Promise<ProviderBatchResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (cancelled()) throw new Error('Translation cancelled.');
    try {
      return await withTimeout(
        provider.translateBatch({
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          units,
          quality,
          ...(provider.capabilities.supportsContext
            ? { context: contextFor(request, units) }
            : {}),
        }),
        timeoutMs,
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === maxAttempts) break;
      await wait(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function contextFor(
  request: TranslationRequest,
  units: TranslationUnit[],
): { pageTitle?: string; units: TranslationUnit[] } {
  const orderedUnits = [...request.units].sort(
    (left, right) => left.number - right.number,
  );
  const requestedIds = new Set(units.map((unit) => unit.id));
  const positions = units
    .map((unit) => orderedUnits.findIndex((item) => item.id === unit.id))
    .filter((index) => index >= 0);
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const context = [orderedUnits[first - 1], orderedUnits[last + 1]]
    .filter(
      (unit): unit is TranslationUnit =>
        unit !== undefined && !requestedIds.has(unit.id),
    )
    .map((unit) => ({
      ...unit,
      text: unit.text.slice(0, MAX_CONTEXT_UNIT_CHARACTERS),
    }));
  return {
    ...(request.pageTitle?.trim()
      ? { pageTitle: request.pageTitle.trim().slice(0, 200) }
      : {}),
    units: context,
  };
}

function split<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    batches.push(items.slice(index, index + size));
  return batches;
}

async function mapConcurrent<T, TResult>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const itemIndex = index++;
        results[itemIndex] = await map(items[itemIndex]);
      }
    }),
  );
  return results;
}

function withTimeout<T>(value: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Translation request timed out.')),
      milliseconds,
    );
    void value.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function category(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    typeof error.category === 'string'
    ? error.category
    : undefined;
}

function isRetryableError(error: unknown): boolean {
  return (
    ['rate-limit', 'unavailable', 'network'].includes(category(error) ?? '') ||
    errorMessage(error) === 'Translation request timed out.'
  );
}

function isFallbackError(error: unknown): boolean {
  return ['authentication', 'quota'].includes(category(error) ?? '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Translation failed.';
}

function normalizedBatchSize(maxBatchSize: number): number {
  if (!Number.isFinite(maxBatchSize)) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.floor(maxBatchSize));
}

function eventForUnit(
  request: TranslationRequest,
  unitId: string,
  type: 'queued' | 'translated' | 'failed',
): TranslationEvent {
  return {
    type,
    sessionId: request.sessionId,
    pageRevision: request.pageRevision,
    unitId,
  } as TranslationEvent;
}

export type {
  TranslationEvent,
  TranslationOrchestrator,
  TranslationRequest,
  TranslationUnit,
} from './types';
