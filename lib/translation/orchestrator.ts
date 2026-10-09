import type { TranslationCache } from '../cache/translation-cache';
import type { Logger } from '../logger/logger';
import { preservesInlineMarkers } from './inline-markers';
import { joinLongUnit, splitLongUnit } from './long-text';
import { resolveTranslationQuality, type TranslationQuality } from './quality';
import { createRequestControl } from './request-control';
import type {
  TranslationEvent,
  TranslationOrchestrator,
  TranslationRequest,
  TranslationUnit,
} from './types';

export type ProviderBatchInput = {
  signal?: AbortSignal;
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
  maxBatchCharacters?: number;
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
  sourceLanguage?: () => Promise<string>;
  cache?: TranslationCache;
  fallbackProviders?: TranslationProvider[];
  maxConcurrentBatches?: number;
  minRequestIntervalMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
  quality?: (request: TranslationRequest) => Promise<TranslationQuality>;
  logger?: Logger;
};

export type TranslationProviderResolver = () => Promise<TranslationProvider[]>;

export function createTranslationOrchestrator(
  provider: TranslationProvider | TranslationProviderResolver,
  options: TranslationOrchestratorOptions = {},
): TranslationOrchestrator {
  const activeSessions = new Map<string, AbortController>();
  const execute = createRequestControl(
    Math.max(1, options.maxConcurrentBatches ?? 2),
    Math.max(0, options.minRequestIntervalMs ?? 125),
  );
  const maxConcurrentBatches = Math.max(1, options.maxConcurrentBatches ?? 2);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 20_000);
  const wait = options.wait ?? ((milliseconds) => delay(milliseconds));

  return {
    async *translate(request: TranslationRequest) {
      const controller = new AbortController();
      activeSessions.set(request.sessionId, controller);
      try {
        if (options.sourceLanguage) {
          request = {
            ...request,
            sourceLanguage: await options.sourceLanguage(),
          };
        }
        if (controller.signal.aborted) return;

        for (const unit of request.units) {
          yield eventForUnit(request, unit.id, 'queued');
        }
        const quality = options.quality
          ? await options.quality(request)
          : resolveTranslationQuality();

        const ready: Outcome[] = [];
        let wake: (() => void) | undefined;
        let finished = false;
        let failure: unknown;
        let outcomes: Outcome[] = [];
        const work = translateUnits(
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
          controller.signal,
          (outcome) => {
            ready.push(outcome);
            wake?.();
          },
          options.logger,
          execute,
        )
          .then(
            (result) => {
              outcomes = result;
            },
            (error: unknown) => {
              failure = error;
            },
          )
          .finally(() => {
            finished = true;
            wake?.();
          });

        while (!finished || ready.length > 0) {
          if (controller.signal.aborted) return;
          const outcome = ready.shift();
          if (!outcome) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
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
        await work;
        if (failure) throw failure;
        if (controller.signal.aborted) return;

        yield {
          type: 'completed',
          sessionId: request.sessionId,
          pageRevision: request.pageRevision,
          unitId: null,
        };
        options.logger?.debug('Translation session completed.', {
          sessionId: request.sessionId,
          pageRevision: request.pageRevision,
          requestedUnitCount: request.units.length,
          translatedUnitCount: outcomes.filter(
            (outcome) => outcome.type === 'translated',
          ).length,
          failedUnitCount: outcomes.filter(
            (outcome) => outcome.type === 'failed',
          ).length,
        });
      } finally {
        controller.abort();
        if (activeSessions.get(request.sessionId) === controller) {
          activeSessions.delete(request.sessionId);
        }
      }
    },
    async cancel(sessionId) {
      activeSessions.get(sessionId)?.abort();
      options.logger?.info('Translation session cancelled.', { sessionId });
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
  signal: AbortSignal,
  emit: (outcome: Outcome) => void,
  logger: Logger | undefined,
  execute: ReturnType<typeof createRequestControl>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let pending = request.units;
  for (const [providerIndex, provider] of providers.entries()) {
    if (signal.aborted || pending.length === 0) break;
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
      if (cached === undefined || !preservesInlineMarkers(unit.text, cached))
        unresolved.push(unit);
      else {
        const outcome: Outcome = {
          type: 'translated',
          unitId: unit.id,
          text: cached,
        };
        outcomes.push(outcome);
        emit(outcome);
      }
    }
    if (unresolved.length === 0) return outcomes;

    const batches = split(
      unresolved,
      normalizedBatchSize(provider.capabilities.maxBatchSize),
      provider.capabilities.maxBatchCharacters ?? Number.POSITIVE_INFINITY,
    );
    let blockingFailure: unknown;
    const batchOutcomes = await mapConcurrent(
      batches,
      maxConcurrentBatches,
      async (units) => {
        if (blockingFailure) {
          if (
            isFallbackError(blockingFailure) &&
            providerIndex < providers.length - 1
          )
            return [];
          return failedOutcomes(units, blockingFailure);
        }
        try {
          const results = await attemptBatch(
            provider,
            request,
            units,
            quality,
            maxAttempts,
            timeoutMs,
            wait,
            signal,
            logger,
            providerIndex,
            execute,
          );
          const resultsById = validatedResults(units, results);
          if (resultsById.size !== units.length) {
            logger?.warn('Translation provider returned incomplete results.', {
              providerIndex,
              requestedUnitCount: units.length,
              returnedResultCount: results.length,
              validResultCount: resultsById.size,
            });
          }
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
          if (signal.aborted) return [];
          if (
            ['authentication', 'quota', 'rate-limit'].includes(
              category(error) ?? '',
            )
          )
            blockingFailure = error;
          const willUseFallback =
            isFallbackError(error) && providerIndex < providers.length - 1;
          if (willUseFallback) {
            logger?.warn('Translation provider failed; switching fallback.', {
              providerIndex,
              category: category(error) ?? 'unknown',
              unitCount: units.length,
              error,
            });
            return [];
          }
          logger?.error('Translation provider batch failed.', {
            providerIndex,
            category: category(error) ?? 'unknown',
            unitCount: units.length,
            error,
          });
          return failedOutcomes(units, error);
        }
      },
      (found) => {
        for (const outcome of found) emit(outcome);
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
      const outcome: Outcome = {
        type: 'paused',
        unitId: null,
        reason: 'Switching to an explicitly configured fallback service.',
      };
      outcomes.push(outcome);
      emit(outcome);
    }
  }
  return outcomes;
}

function failedOutcomes(units: TranslationUnit[], error: unknown): Outcome[] {
  return units.map((unit) => ({
    type: 'failed',
    unitId: unit.id,
    category: category(error) ?? 'unknown',
    message: errorMessage(error),
  }));
}

function validatedResults(
  units: TranslationUnit[],
  results: ProviderBatchResult,
): Map<string, string> {
  const requestedIds = new Set(units.map((unit) => unit.id));
  const sources = new Map(units.map((unit) => [unit.id, unit.text]));
  const valid = new Map<string, string>();
  const invalidIds = new Set<string>();
  for (const result of results) {
    if (
      !requestedIds.has(result.id) ||
      typeof result.text !== 'string' ||
      result.text.trim().length === 0 ||
      !preservesInlineMarkers(sources.get(result.id) ?? '', result.text) ||
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
  signal: AbortSignal,
  logger: Logger | undefined,
  providerIndex: number | undefined,
  execute: ReturnType<typeof createRequestControl>,
): Promise<ProviderBatchResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    signal.throwIfAborted();
    const attemptController = new AbortController();
    const onAbort = () => attemptController.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const budget =
        provider.capabilities.maxBatchCharacters ?? Number.POSITIVE_INFINITY;
      const pieces = units.map((unit) => splitLongUnit(unit, budget));
      const allParts = pieces.flatMap((parts) =>
        parts.map((part) => part.unit),
      );
      const batches = split(
        allParts.filter((part) => part.text.trim()),
        normalizedBatchSize(provider.capabilities.maxBatchSize),
        budget,
      );
      const found = new Map(
        allParts
          .filter((part) => !part.text.trim())
          .map((part) => [part.id, part.text]),
      );
      for (const batch of batches) {
        const input: ProviderBatchInput = {
          signal: attemptController.signal,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          units: batch,
          quality,
          ...(provider.capabilities.supportsContext
            ? { context: contextFor(request, units) }
            : {}),
        };
        const results = await execute(provider, input, async (sharedSignal) => {
          const network = new AbortController();
          const abort = () => network.abort(sharedSignal.reason);
          sharedSignal.addEventListener('abort', abort, { once: true });
          try {
            return await withTimeout(
              provider.translateBatch({ ...input, signal: network.signal }),
              timeoutMs,
              sharedSignal,
              () => network.abort(new Error('Translation request timed out.')),
            );
          } finally {
            sharedSignal.removeEventListener('abort', abort);
            network.abort();
          }
        });
        for (const [id, text] of validatedResults(batch, results))
          found.set(id, text);
      }
      return units.flatMap((unit, index) => {
        const text = joinLongUnit(pieces[index], found);
        return text === undefined ? [] : [{ id: unit.id, text }];
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === maxAttempts) break;
      logger?.warn('Translation provider attempt failed; retrying.', {
        providerIndex,
        attempt,
        maxAttempts,
        category: category(error) ?? 'unknown',
        unitCount: units.length,
        error,
      });
      await wait(250 * 2 ** (attempt - 1));
    } finally {
      signal.removeEventListener('abort', onAbort);
      attemptController.abort();
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

function split(
  items: TranslationUnit[],
  size: number,
  characterBudget: number,
): TranslationUnit[][] {
  const batches: TranslationUnit[][] = [];
  let batch: TranslationUnit[] = [];
  let characters = 0;
  for (const unit of items) {
    if (
      batch.length > 0 &&
      (batch.length >= size || characters + unit.text.length > characterBudget)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(unit);
    characters += unit.text.length;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function mapConcurrent<T, TResult>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<TResult>,
  onResult: (result: TResult) => void,
): Promise<TResult[]> {
  const results: TResult[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const itemIndex = index++;
        results[itemIndex] = await map(items[itemIndex]);
        onResult(results[itemIndex]);
      }
    }),
  );
  return results;
}

function withTimeout<T>(
  value: Promise<T>,
  milliseconds: number,
  signal: AbortSignal,
  onTimeout: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Translation request timed out.'));
      onTimeout();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void value.then(
      (result) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
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
