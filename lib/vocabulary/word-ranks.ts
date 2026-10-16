export type WordRanks = ReadonlyMap<string, number>;

export function parseWordRanks(text: string): WordRanks {
  const ranks = new Map<string, number>();
  for (const [index, line] of text.split('\n').entries()) {
    const word = line.trim();
    if (word && !ranks.has(word)) ranks.set(word, index + 1);
  }
  return ranks;
}

/** Candidate base forms for common English inflections, most specific first. */
export function baseForms(word: string): string[] {
  const forms = [word];
  const add = (form: string) => {
    if (form.length >= 3 && !forms.includes(form)) forms.push(form);
  };
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1));
  for (const suffix of ['ed', 'ing', 'er', 'est']) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    add(stem);
    add(`${stem}e`);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
    if (stem.endsWith('i')) add(`${stem.slice(0, -1)}y`);
  }
  if (word.endsWith('ily')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('ly')) add(word.slice(0, -2));
  return forms;
}

/**
 * The rank of a word's most frequent known form. Unknown words get
 * `Infinity`, so names and typos are treated as hard only when the caller
 * decides to; see `isHardWord`.
 */
export function wordRank(ranks: WordRanks, word: string): number {
  return rankedForm(ranks, word)?.rank ?? Number.POSITIVE_INFINITY;
}

export type RankedWord = { rank: number; lemma: string };

/** The listed form of a word with the lowest rank, used as its lemma. */
export function rankedForm(
  ranks: WordRanks,
  word: string,
): RankedWord | undefined {
  let best: RankedWord | undefined;
  for (const form of baseForms(word.toLowerCase())) {
    const rank = ranks.get(form);
    if (rank !== undefined && (!best || rank < best.rank))
      best = { rank, lemma: form };
  }
  return best;
}

/**
 * Hard words are listed but rarer than the reader's vocabulary size. Words
 * missing from the list are usually names, brands, or misspellings, so they
 * are never highlighted.
 */
export function isHardWord(rank: number, vocabularySize: number): boolean {
  return Number.isFinite(rank) && rank > vocabularySize;
}

export const WORD_PATTERN = /\b[A-Za-z][a-z]{2,}(?:-[a-z]+)*\b/g;

export type WordToken = { start: number; end: number; word: string };

/**
 * Lowercase word tokens of a text node. Capitalized words count only at the
 * start of a sentence; elsewhere they are usually names. Words joined to
 * digits, URLs, or apostrophes are skipped.
 */
export function tokenize(text: string, startsSentence = true): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text[start - 1] ?? '';
    const after = text[end] ?? '';
    // Part of a URL, email, path, contraction, or alphanumeric code.
    if (/[\w@/.'’]/.test(before)) continue;
    if (
      /[\w@/'’]/.test(after) ||
      (after === '.' && /\w/.test(text[end + 1] ?? ''))
    )
      continue;
    if (/^[A-Z]/.test(match[0])) {
      const preceding = text.slice(0, start).trimEnd();
      const sentenceStart =
        preceding === '' ? startsSentence : /[.!?:"“]$/.test(preceding);
      if (!sentenceStart) continue;
    }
    tokens.push({ start, end, word: match[0].toLowerCase() });
  }
  return tokens;
}
