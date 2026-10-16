import { describe, expect, it, vi } from 'vitest';
import { createRankService } from './rank-service';

describe('rank service', () => {
  it('loads the list once and returns each word with its lemma', async () => {
    const load = vi.fn().mockResolvedValue('the\nship\nnephew\n');
    const classify = createRankService(load);
    await expect(classify(['ships', 'nephews', 'zzz'])).resolves.toEqual({
      ships: { rank: 2, lemma: 'ship' },
      nephews: { rank: 3, lemma: 'nephew' },
      zzz: null,
    });
    await classify(['the']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries loading after a failure', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('the\n');
    const classify = createRankService(load);
    await expect(classify(['the'])).rejects.toThrow('offline');
    await expect(classify(['the'])).resolves.toEqual({
      the: { rank: 1, lemma: 'the' },
    });
  });
});
