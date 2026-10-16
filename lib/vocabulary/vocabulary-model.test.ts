import { describe, expect, it } from 'vitest';
import {
  contextSnippet,
  DEFAULT_VOCABULARY,
  exportWordbook,
  resolveVocabulary,
} from './vocabulary-model';

describe('vocabulary settings', () => {
  it('falls back to safe defaults for missing or malformed values', () => {
    expect(resolveVocabulary(undefined)).toEqual(DEFAULT_VOCABULARY);
    expect(resolveVocabulary({ enabled: 'yes', vocabularySize: 4321 })).toEqual(
      DEFAULT_VOCABULARY,
    );
  });

  it('normalizes and deduplicates known and saved words', () => {
    const vocabulary = resolveVocabulary({
      enabled: true,
      vocabularySize: 8000,
      knownWords: ['Mutiny', 'mutiny', '<script>', 42],
      savedWords: [
        { word: 'Nephew', gloss: '侄子', context: 'His nephew', addedAt: 5 },
        { word: 'nephew', gloss: 'duplicate' },
        { word: 'a b' },
      ],
    });
    expect(vocabulary).toEqual({
      enabled: true,
      vocabularySize: 8000,
      knownWords: ['mutiny'],
      savedWords: [
        { word: 'nephew', gloss: '侄子', context: 'His nephew', addedAt: 5 },
      ],
    });
  });

  it('keeps a bounded sentence around the saved word', () => {
    const text = `${'a '.repeat(300)}rare word here ${'b '.repeat(300)}`;
    const snippet = contextSnippet(text, 'rare');
    expect(snippet.length).toBeLessThanOrEqual(300);
    expect(snippet).toContain('rare word here');
  });

  it('exports Anki-compatible rows without breaking on tabs or newlines', () => {
    expect(
      exportWordbook([
        {
          word: 'mutiny',
          gloss: '兵变\t叛乱',
          context: 'A\nmutiny',
          addedAt: 1,
        },
      ]),
    ).toBe('mutiny\t兵变 叛乱\tA mutiny');
  });
});
