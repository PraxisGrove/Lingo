import type { TranslationProvider } from '@/lib/translation/orchestrator';

export function createInMemoryProvider(): TranslationProvider {
  return {
    capabilities: {
      maxBatchSize: Number.POSITIVE_INFINITY,
      supportsContext: false,
      supportsNativeGlossary: false,
      supportsStructuredOutput: false,
      supportsStreaming: false,
    },
    async translateBatch(input) {
      return input.units.map((unit) => ({
        id: unit.id,
        text: `[${input.targetLanguage}] ${unit.text}`,
      }));
    },
  };
}
