import { parseWordRanks, type RankedWord, rankedForm } from './word-ranks';

/** Loads the bundled list once per worker lifetime and ranks words. */
export function createRankService(load: () => Promise<string>) {
  let ranks: ReturnType<typeof loadRanks> | undefined;
  const loadRanks = () =>
    load()
      .then(parseWordRanks)
      .catch((error) => {
        ranks = undefined;
        throw error;
      });
  return async (
    words: string[],
  ): Promise<Record<string, RankedWord | null>> => {
    ranks ??= loadRanks();
    const loaded = await ranks;
    const result: Record<string, RankedWord | null> = {};
    for (const word of words) result[word] = rankedForm(loaded, word) ?? null;
    return result;
  };
}
