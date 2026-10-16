import { preservesInlineMarkers } from '../translation/inline-markers';
import type {
  ProviderBatchInput,
  ProviderBatchResult,
} from '../translation/orchestrator';
import { ProviderError } from './provider';

/**
 * On-device translation through the browser's Translator and LanguageDetector
 * APIs. Text never leaves the device and no credential is needed. The APIs
 * only exist in window contexts, so the background reaches this module through
 * an offscreen document, while extension pages call it directly to download
 * language packs during a user gesture.
 */

export type BuiltInAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

type DownloadMonitor = {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { loaded: number }) => void,
  ): void;
};

export type LanguagePair = { sourceLanguage: string; targetLanguage: string };

export type BuiltInTranslatorApi = {
  availability(pair: LanguagePair): Promise<BuiltInAvailability>;
  create(
    pair: LanguagePair & {
      monitor?: (monitor: DownloadMonitor) => void;
      signal?: AbortSignal;
    },
  ): Promise<{
    translate(
      text: string,
      options?: { signal?: AbortSignal },
    ): Promise<string>;
    destroy?(): void;
  }>;
};

export type BuiltInLanguageDetectorApi = {
  availability(): Promise<BuiltInAvailability>;
  create(options?: {
    monitor?: (monitor: DownloadMonitor) => void;
    signal?: AbortSignal;
  }): Promise<{
    detect(
      text: string,
      options?: { signal?: AbortSignal },
    ): Promise<Array<{ detectedLanguage?: string; confidence?: number }>>;
  }>;
};

export type BuiltInApis = {
  translator?: BuiltInTranslatorApi;
  detector?: BuiltInLanguageDetectorApi;
};

export function browserBuiltInApis(
  scope: typeof globalThis = globalThis,
): BuiltInApis {
  const candidate = scope as unknown as {
    Translator?: BuiltInTranslatorApi;
    LanguageDetector?: BuiltInLanguageDetectorApi;
  };
  return {
    translator: candidate.Translator,
    detector: candidate.LanguageDetector,
  };
}

export function hasBuiltInTranslator(
  apis: BuiltInApis = browserBuiltInApis(),
): boolean {
  return typeof apis.translator?.create === 'function';
}

/** Map Lingo's BCP 47 settings values to the tags the browser models use. */
export function builtInLanguage(code: string): string {
  const lower = code.trim().toLowerCase();
  if (
    lower === 'zh-tw' ||
    lower === 'zh-hk' ||
    lower === 'zh-mo' ||
    lower.startsWith('zh-hant')
  )
    return 'zh-Hant';
  return lower.split('-')[0] || lower;
}

const MARKER_PATTERN = /⟦(?:\/?\d+|KEEP:\d+)⟧/g;
const DETECTION_SAMPLE_LENGTH = 400;
const MIN_DETECTION_CONFIDENCE = 0.35;

export class LanguagePackError extends ProviderError {
  constructor(
    public readonly sourceLanguage: string,
    public readonly targetLanguage: string,
  ) {
    super(
      'language-pack',
      `The ${sourceLanguage} → ${targetLanguage} language pack is not downloaded yet.`,
    );
  }
}

export type BuiltInTranslationEngine = {
  availability(pair: LanguagePair): Promise<BuiltInAvailability>;
  translate(input: ProviderBatchInput): Promise<ProviderBatchResult>;
};

export function createBuiltInTranslationEngine(
  apis: BuiltInApis,
): BuiltInTranslationEngine {
  const translators = new Map<
    string,
    ReturnType<BuiltInTranslatorApi['create']>
  >();
  let detector: ReturnType<BuiltInLanguageDetectorApi['create']> | undefined;

  function requireTranslator(): BuiltInTranslatorApi {
    if (!apis.translator)
      throw new ProviderError(
        'unsupported',
        'This browser does not provide on-device translation.',
      );
    return apis.translator;
  }

  async function translatorFor(pair: LanguagePair) {
    const key = `${pair.sourceLanguage}>${pair.targetLanguage}`;
    let pending = translators.get(key);
    if (!pending) {
      const api = requireTranslator();
      const availability = await api.availability(pair);
      if (availability === 'unavailable')
        throw new ProviderError(
          'invalid-request',
          `On-device translation does not support ${pair.sourceLanguage} → ${pair.targetLanguage}.`,
        );
      if (availability !== 'available')
        throw new LanguagePackError(pair.sourceLanguage, pair.targetLanguage);
      pending = api.create(pair);
      translators.set(key, pending);
      pending.catch(() => translators.delete(key));
    }
    return pending;
  }

  async function detect(text: string, signal?: AbortSignal) {
    if (!apis.detector) return undefined;
    if (!detector) {
      if ((await apis.detector.availability()) !== 'available')
        return undefined;
      detector = apis.detector.create();
      detector.catch(() => {
        detector = undefined;
      });
    }
    const sample = text
      .replace(MARKER_PATTERN, ' ')
      .slice(0, DETECTION_SAMPLE_LENGTH);
    const [best] = await (await detector).detect(sample, { signal });
    if (
      !best?.detectedLanguage ||
      best.detectedLanguage === 'und' ||
      (best.confidence ?? 1) < MIN_DETECTION_CONFIDENCE
    )
      return undefined;
    return builtInLanguage(best.detectedLanguage);
  }

  return {
    availability(pair) {
      return requireTranslator().availability({
        sourceLanguage: builtInLanguage(pair.sourceLanguage),
        targetLanguage: builtInLanguage(pair.targetLanguage),
      });
    },
    async translate(input) {
      const targetLanguage = builtInLanguage(input.targetLanguage);
      const configuredSource =
        input.sourceLanguage && input.sourceLanguage !== 'auto'
          ? builtInLanguage(input.sourceLanguage)
          : undefined;
      const results: ProviderBatchResult = [];
      for (const unit of input.units) {
        input.signal?.throwIfAborted();
        const sourceLanguage =
          configuredSource ?? (await detect(unit.text, input.signal));
        if (!sourceLanguage || sourceLanguage === targetLanguage) {
          // Already in the reader's language, or too short to identify.
          results.push({ id: unit.id, text: unit.text });
          continue;
        }
        const translator = await translatorFor({
          sourceLanguage,
          targetLanguage,
        });
        results.push({
          id: unit.id,
          text: await translatePreservingMarkers(
            (text) => translator.translate(text, { signal: input.signal }),
            unit.text,
          ),
        });
      }
      return results;
    },
  };
}

/**
 * Translate the whole paragraph first for the best fluency. On-device models
 * sometimes drop or damage Lingo's formatting markers; in that case translate
 * the text between markers piece by piece so links, emphasis, and protected
 * inline code still reassemble exactly.
 */
export async function translatePreservingMarkers(
  translate: (text: string) => Promise<string>,
  text: string,
): Promise<string> {
  if (!text.match(MARKER_PATTERN)) return translate(text);
  const whole = await translate(text);
  if (preservesInlineMarkers(text, whole)) return whole;
  const pieces = text.split(/(⟦(?:\/?\d+|KEEP:\d+)⟧)/);
  const translated = await Promise.all(
    pieces.map(async (piece) => {
      if (/^⟦(?:\/?\d+|KEEP:\d+)⟧$/.test(piece) || !/\p{L}/u.test(piece))
        return piece;
      const leading = piece.match(/^\s*/)?.[0] ?? '';
      const trailing = piece.match(/\s*$/)?.[0] ?? '';
      return `${leading}${(await translate(piece.trim())).trim()}${trailing}`;
    }),
  );
  return translated.join('');
}

/**
 * Download the packs needed for everyday reading. Must run in an extension
 * page during a user gesture: browsers only start model downloads then.
 */
export async function prepareBuiltInTranslation(
  targetLanguage: string,
  options: {
    apis?: BuiltInApis;
    sourceLanguages?: string[];
    onProgress?: (loaded: number) => void;
  } = {},
): Promise<{ ready: string[]; unsupported: string[] }> {
  const apis = options.apis ?? browserBuiltInApis();
  if (!apis.translator)
    throw new ProviderError(
      'unsupported',
      'This browser does not provide on-device translation.',
    );
  const target = builtInLanguage(targetLanguage);
  const sources = [
    ...new Set(
      (options.sourceLanguages ?? ['en'])
        .map(builtInLanguage)
        .filter((source) => source !== target),
    ),
  ];
  const monitor = (handle: DownloadMonitor) =>
    handle.addEventListener('downloadprogress', (event) =>
      options.onProgress?.(event.loaded),
    );
  // Start every download inside the same gesture before awaiting any of them.
  const detector =
    apis.detector?.create({ monitor }).catch(() => undefined) ??
    Promise.resolve(undefined);
  const settled = await Promise.allSettled(
    sources.map((sourceLanguage) =>
      apis.translator?.create({
        sourceLanguage,
        targetLanguage: target,
        monitor,
      }),
    ),
  );
  await detector;
  return {
    ready: sources.filter((_, index) => settled[index].status === 'fulfilled'),
    unsupported: sources.filter(
      (_, index) => settled[index].status === 'rejected',
    ),
  };
}
