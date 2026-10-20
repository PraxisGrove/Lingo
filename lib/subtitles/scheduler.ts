import type { TranslationClientResult } from '../page-translation/page-translation';
import type { TranslationUnit } from '../translation/types';
import type { Sentence } from './segment';

export type SubtitleTranslate = (
  units: TranslationUnit[],
  targetLanguage: string,
  onProgress?: (translations: TranslationUnit[]) => void,
  options?: { sourceLanguage?: string },
) => Promise<TranslationClientResult>;

export type SchedulerOptions = {
  sentences: Sentence[];
  translate: SubtitleTranslate;
  cancel(): void;
  targetLanguage: string;
  sourceLanguage?: string;
  onTranslated(id: string, text: string): void;
  onFailure?(error: unknown): void;
  /** First request is small so the opening line appears quickly. */
  firstWindowSeconds?: number;
  lookAheadSeconds?: number;
  /** Request more when fewer than this many seconds are covered. */
  refillSeconds?: number;
};

/**
 * Translates subtitle sentences just ahead of the playhead. Translation
 * never runs for the whole track up front, which bounds cost and how much
 * of the video's dialogue leaves the device.
 */
export function createSubtitleScheduler({
  sentences,
  translate,
  cancel,
  targetLanguage,
  sourceLanguage,
  onTranslated,
  onFailure,
  firstWindowSeconds = 15,
  lookAheadSeconds = 90,
  refillSeconds = 30,
}: SchedulerOptions) {
  const done = new Map<string, string>();
  const requested = new Set<string>();
  let coveredUntil = Number.NEGATIVE_INFINITY;
  let coveredFrom = Number.POSITIVE_INFINITY;
  let inFlight = 0;
  let generation = 0;
  let stopped = false;

  function indexAt(time: number): number {
    const index = sentences.findIndex((sentence) => sentence.end > time);
    return index < 0 ? sentences.length : index;
  }

  async function request(from: number, until: number) {
    const first = indexAt(from);
    const window: Sentence[] = [];
    for (let index = first; index < sentences.length; index += 1) {
      const sentence = sentences[index];
      if (sentence.start > until) break;
      if (!requested.has(sentence.id)) window.push(sentence);
    }
    coveredFrom = Math.min(coveredFrom, from);
    coveredUntil = Math.max(coveredUntil, until);
    if (window.length === 0) return;
    for (const sentence of window) requested.add(sentence.id);
    // One translated sentence before the window gives AI providers context;
    // it is answered from the cache.
    const previous = sentences[sentences.indexOf(window[0]) - 1];
    const units = [
      ...(previous && done.has(previous.id) ? [previous] : []),
      ...window,
    ].map((sentence) => ({
      id: sentence.id,
      number: sentences.indexOf(sentence) + 1,
      text: sentence.text,
    }));
    const current = generation;
    inFlight += 1;
    const accept = (translations: TranslationUnit[]) => {
      if (current !== generation || stopped) return;
      for (const unit of translations) {
        if (done.has(unit.id)) continue;
        done.set(unit.id, unit.text);
        onTranslated(unit.id, unit.text);
      }
    };
    try {
      const result = await translate(units, targetLanguage, accept, {
        ...(sourceLanguage ? { sourceLanguage } : {}),
      });
      accept(Array.isArray(result) ? result : result.translations);
    } catch (error) {
      if (current !== generation || stopped) return;
      for (const sentence of window)
        if (!done.has(sentence.id)) requested.delete(sentence.id);
      coveredUntil = Math.min(coveredUntil, from);
      onFailure?.(error);
    } finally {
      inFlight -= 1;
    }
  }

  return {
    /** Call on playback progress; schedules more work when needed. */
    update(time: number) {
      if (stopped) return;
      if (coveredUntil === Number.NEGATIVE_INFINITY) {
        void request(time, time + firstWindowSeconds).then(() =>
          this.update(time),
        );
        return;
      }
      if (inFlight === 0 && coveredUntil - time < refillSeconds)
        void request(Math.max(time, coveredUntil), time + lookAheadSeconds);
    },
    /** A seek outside the covered range cancels work that is now behind. */
    seek(time: number) {
      if (stopped) return;
      if (time >= coveredFrom && time <= coveredUntil) return;
      if (inFlight > 0) {
        generation += 1;
        cancel();
        for (const id of [...requested])
          if (!done.has(id)) requested.delete(id);
        inFlight = 0;
      }
      coveredFrom = Number.POSITIVE_INFINITY;
      coveredUntil = Number.NEGATIVE_INFINITY;
      this.update(time);
    },
    translation: (id: string) => done.get(id),
    stop() {
      stopped = true;
      generation += 1;
      cancel();
    },
  };
}
