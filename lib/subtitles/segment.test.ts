import { describe, expect, it } from 'vitest';
import { segmentCues, sentenceAt } from './segment';

const cue = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

describe('subtitle sentences', () => {
  it('joins auto-caption fragments until punctuation and keeps the full time span', () => {
    expect(
      segmentCues([
        cue(0, 1, 'so today we'),
        cue(1, 2, 'are going to learn'),
        cue(2, 3, 'about neural networks.'),
        cue(3.2, 4, 'Ready?'),
      ]).map(({ start, end, text }) => ({ start, end, text })),
    ).toEqual([
      {
        start: 0,
        end: 3,
        text: 'so today we are going to learn about neural networks.',
      },
      { start: 3.2, end: 4, text: 'Ready?' },
    ]);
  });

  it('splits unpunctuated speech on long pauses, duration, and length', () => {
    expect(
      segmentCues([cue(0, 1, 'one'), cue(3, 4, 'two')]).map((s) => s.text),
    ).toEqual(['one', 'two']);
    expect(
      segmentCues([cue(0, 4, 'first part'), cue(4, 9, 'runs too long')], {
        maxDurationSeconds: 8,
      }).map((s) => s.text),
    ).toEqual(['first part', 'runs too long']);
    expect(
      segmentCues([cue(0, 1, 'aaaa'), cue(1, 2, 'bbbb')], {
        maxCharacters: 6,
      }).map((s) => s.text),
    ).toEqual(['aaaa', 'bbbb']);
  });

  it('joins CJK fragments without spaces and flattens multi-line cues', () => {
    expect(
      segmentCues([
        cue(0, 1, '我们今天'),
        cue(1, 2, '学习字幕。'),
        cue(2, 3, 'two\nlines.'),
      ]).map((s) => s.text),
    ).toEqual(['我们今天学习字幕。', 'two lines.']);
  });

  it('gives stable ids and finds the sentence on screen', () => {
    const sentences = segmentCues([cue(1, 2, 'A.'), cue(3, 4, 'B.')]);
    expect(sentences.map((s) => s.id)).toEqual(['s0-1000', 's1-3000']);
    expect(sentenceAt(sentences, 1.5)?.text).toBe('A.');
    expect(sentenceAt(sentences, 2.5)).toBeUndefined();
    expect(sentenceAt(sentences, 3)?.text).toBe('B.');
    expect(sentenceAt(sentences, 0)).toBeUndefined();
  });
});
