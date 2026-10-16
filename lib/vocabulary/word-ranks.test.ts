import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  baseForms,
  isHardWord,
  parseWordRanks,
  tokenize,
  WORD_PATTERN,
  wordRank,
} from './word-ranks';

const ranks = parseWordRanks(
  readFileSync('public/vocabulary/en-ranks.txt', 'utf8'),
);

describe('English word ranks', () => {
  it('uses the line number as rank and keeps the first duplicate', () => {
    const small = parseWordRanks('the\nof\nthe\n\n');
    expect(small.get('the')).toBe(1);
    expect(small.get('of')).toBe(2);
    expect(small.size).toBe(2);
  });

  it.each([
    ['nephews', 'nephew'],
    ['studies', 'study'],
    ['carried', 'carry'],
    ['stopped', 'stop'],
    ['making', 'make'],
    ['happily', 'happy'],
    ['boxes', 'box'],
  ])('maps %s to its base form %s', (word, base) => {
    expect(baseForms(word)).toContain(base);
  });

  it('ranks an inflection by its most frequent form', () => {
    expect(wordRank(ranks, 'Nephews')).toBe(wordRank(ranks, 'nephew'));
    expect(wordRank(ranks, 'the')).toBe(1);
  });

  it('never highlights unknown words such as names or typos', () => {
    expect(isHardWord(wordRank(ranks, 'zxqvplorg'), 3000)).toBe(false);
    expect(isHardWord(wordRank(ranks, 'mutiny'), 3000)).toBe(true);
    expect(isHardWord(wordRank(ranks, 'house'), 3000)).toBe(false);
  });

  it('finds lowercase and capitalized words but skips acronyms and short words', () => {
    expect(
      'An NASA mutiny, well-known Ships at sea.'.match(WORD_PATTERN),
    ).toEqual(['mutiny', 'well-known', 'Ships', 'sea']);
  });
});

describe('word tokens', () => {
  const words = (text: string, startsSentence?: boolean) =>
    tokenize(text, startsSentence).map((token) => token.word);

  it('treats mid-sentence capitalized words as names', () => {
    expect(words('Ships met Maria near the harbour. Mutiny began.')).toEqual([
      'ships',
      'met',
      'near',
      'the',
      'harbour',
      'mutiny',
      'began',
    ]);
    expect(words('Ships sail', false)).toEqual(['sail']);
  });

  it('skips URLs, emails, contractions, and words fused with digits', () => {
    expect(
      words('see example.com/path or user@mail.net, don’t abc123 fine'),
    ).toEqual(['see', 'fine']);
  });

  it('reports offsets that slice back to the original word', () => {
    const text = '(mutiny) and “rebellion”';
    for (const token of tokenize(text))
      expect(text.slice(token.start, token.end).toLowerCase()).toBe(token.word);
    expect(words(text)).toEqual(['mutiny', 'and', 'rebellion']);
  });
});
