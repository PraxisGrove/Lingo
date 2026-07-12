import type {
  TranslationEvent,
  TranslationOrchestrator,
  TranslationRequest,
  TranslationUnit,
} from './types';

export type ProviderBatchInput = {
  sourceLanguage: 'auto';
  targetLanguage: string;
  units: TranslationUnit[];
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
  capabilities: ProviderCapabilities;
  translateBatch(input: ProviderBatchInput): Promise<ProviderBatchResult>;
};

export function createTranslationOrchestrator(
  provider: TranslationProvider,
): TranslationOrchestrator {
  const cancelledSessions = new Set<string>();

  return {
    async *translate(request: TranslationRequest) {
      cancelledSessions.delete(request.sessionId);

      for (const unit of request.units) {
        yield eventForUnit(request, unit.id, 'queued');
      }

      const batchSize = normalizedBatchSize(provider.capabilities.maxBatchSize);
      for (let index = 0; index < request.units.length; index += batchSize) {
        if (cancelledSessions.has(request.sessionId)) return;
        const units = request.units.slice(index, index + batchSize);
        const results = await provider.translateBatch({
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          units,
        });

        if (cancelledSessions.has(request.sessionId)) return;

        const resultsById = new Map(
          results.map((result) => [result.id, result]),
        );
        for (const unit of units) {
          const result = resultsById.get(unit.id);
          if (result) {
            yield {
              ...eventForUnit(request, unit.id, 'translated'),
              text: result.text,
            };
          } else {
            yield {
              ...eventForUnit(request, unit.id, 'failed'),
              message: 'The translation provider did not return this unit.',
            };
          }
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
