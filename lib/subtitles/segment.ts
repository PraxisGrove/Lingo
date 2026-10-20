import type { Cue } from './cues';

/** A translation unit spanning one or more source cues. */
export type Sentence = {
  id: string;
  start: number;
  end: number;
  text: string;
};

export type SegmentOptions = {
  /** Longer pauses always end a sentence. */
  maxGapSeconds?: number;
  maxDurationSeconds?: number;
  maxCharacters?: number;
};

const SENTENCE_END = /[.!?。！？…]["'”’)\]]*$/;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/**
 * Merge caption fragments into sentences so translation sees whole
 * thoughts. Auto-generated captions split mid-sentence across lines; manual
 * captions usually already end with punctuation and pass through intact.
 */
export function segmentCues(
  cues: Cue[],
  {
    maxGapSeconds = 1.2,
    maxDurationSeconds = 8,
    maxCharacters = 220,
  }: SegmentOptions = {},
): Sentence[] {
  const sentences: Sentence[] = [];
  let current: Sentence | undefined;
  const flush = () => {
    if (current?.text) sentences.push(current);
    current = undefined;
  };
  for (const cue of cues) {
    const text = cue.text.replace(/\s*\n\s*/g, ' ').trim();
    if (!text) continue;
    if (
      current &&
      (cue.start - current.end > maxGapSeconds ||
        cue.end - current.start > maxDurationSeconds ||
        current.text.length + text.length > maxCharacters)
    )
      flush();
    if (current) {
      const joiner =
        CJK.test(current.text.at(-1) ?? '') && CJK.test(text[0]) ? '' : ' ';
      current.text = `${current.text}${joiner}${text}`;
      current.end = Math.max(current.end, cue.end);
    } else {
      current = { id: '', start: cue.start, end: cue.end, text };
    }
    if (SENTENCE_END.test(current.text)) flush();
  }
  flush();
  return sentences.map((sentence, index) => ({
    ...sentence,
    id: `s${index}-${Math.round(sentence.start * 1000)}`,
  }));
}

/** The sentence on screen at `time`, using a binary search over start times. */
export function sentenceAt(
  sentences: Sentence[],
  time: number,
): Sentence | undefined {
  let low = 0;
  let high = sentences.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sentences[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const sentence = sentences[found];
  return sentence && time < sentence.end ? sentence : undefined;
}
