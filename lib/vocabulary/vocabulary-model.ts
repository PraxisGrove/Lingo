export type SavedWord = {
  word: string;
  gloss: string;
  context: string;
  addedAt: number;
};

export type VocabularySettings = {
  enabled: boolean;
  vocabularySize: number;
  knownWords: string[];
  savedWords: SavedWord[];
};

export const VOCABULARY_SIZES = [2000, 3000, 5000, 8000, 12000, 20000] as const;

export const DEFAULT_VOCABULARY: VocabularySettings = {
  enabled: false,
  vocabularySize: 5000,
  knownWords: [],
  savedWords: [],
};

const MAX_WORDS = 20_000;
const MAX_CONTEXT = 300;

export function resolveVocabulary(value: unknown): VocabularySettings {
  if (!value || typeof value !== 'object') return DEFAULT_VOCABULARY;
  const candidate = value as Record<string, unknown>;
  const knownWords = Array.isArray(candidate.knownWords)
    ? [
        ...new Set(
          candidate.knownWords
            .filter((word): word is string => typeof word === 'string')
            .map(normalizeWord)
            .filter(Boolean),
        ),
      ].slice(0, MAX_WORDS)
    : [];
  const savedWords = new Map<string, SavedWord>();
  if (Array.isArray(candidate.savedWords))
    for (const item of candidate.savedWords) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const word =
        typeof entry.word === 'string' ? normalizeWord(entry.word) : '';
      if (!word || savedWords.has(word)) continue;
      savedWords.set(word, {
        word,
        gloss: typeof entry.gloss === 'string' ? entry.gloss.slice(0, 200) : '',
        context:
          typeof entry.context === 'string'
            ? entry.context.slice(0, MAX_CONTEXT)
            : '',
        addedAt:
          typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt)
            ? entry.addedAt
            : 0,
      });
      if (savedWords.size >= MAX_WORDS) break;
    }
  return {
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : DEFAULT_VOCABULARY.enabled,
    vocabularySize: VOCABULARY_SIZES.includes(
      candidate.vocabularySize as (typeof VOCABULARY_SIZES)[number],
    )
      ? (candidate.vocabularySize as number)
      : DEFAULT_VOCABULARY.vocabularySize,
    knownWords,
    savedWords: [...savedWords.values()],
  };
}

export function normalizeWord(word: string): string {
  const normalized = word.trim().toLowerCase();
  return /^[a-z]+(?:-[a-z]+)*$/.test(normalized) && normalized.length <= 64
    ? normalized
    : '';
}

export function contextSnippet(text: string, word: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_CONTEXT) return clean;
  const index = clean.toLowerCase().indexOf(word.toLowerCase());
  const start = Math.max(0, Math.min(index - 120, clean.length - MAX_CONTEXT));
  return clean.slice(start, start + MAX_CONTEXT).trim();
}

/** Tab-separated front/back/context rows that Anki imports as Basic notes. */
export function exportWordbook(words: SavedWord[]): string {
  const cell = (value: string) => value.replace(/[\t\r\n]+/g, ' ').trim();
  return words
    .map((item) => [item.word, item.gloss, item.context].map(cell).join('\t'))
    .join('\n');
}
