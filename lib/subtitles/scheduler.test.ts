import { describe, expect, it, vi } from 'vitest';
import type { TranslationUnit } from '../translation/types';
import { createSubtitleScheduler } from './scheduler';
import type { Sentence } from './segment';

const sentences: Sentence[] = Array.from({ length: 40 }, (_, index) => ({
  id: `s${index}`,
  start: index * 5,
  end: index * 5 + 4,
  text: `Line ${index}.`,
}));

function setup() {
  const calls: TranslationUnit[][] = [];
  const pending: Array<(value: TranslationUnit[]) => void> = [];
  const translate = vi.fn(
    async (units: TranslationUnit[], ..._rest: unknown[]) => {
      calls.push(units);
      return new Promise<TranslationUnit[]>((resolve) => {
        pending.push(() =>
          resolve(units.map((unit) => ({ ...unit, text: `译 ${unit.text}` }))),
        );
      });
    },
  );
  const cancel = vi.fn();
  const translated = new Map<string, string>();
  const scheduler = createSubtitleScheduler({
    sentences,
    translate,
    cancel,
    targetLanguage: 'zh-CN',
    sourceLanguage: 'en',
    onTranslated: (id, text) => translated.set(id, text),
  });
  const settle = async () => {
    while (pending.length) pending.shift()?.([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { scheduler, calls, cancel, translated, settle, translate };
}

describe('subtitle scheduler', () => {
  it('translates a small first window, then rolls ahead without re-requesting', async () => {
    const { scheduler, calls, translated, settle, translate } = setup();
    scheduler.update(0);
    expect(calls[0].map((unit) => unit.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(translate.mock.calls[0][3]).toEqual({ sourceLanguage: 'en' });
    await settle();
    expect(translated.get('s0')).toBe('译 Line 0.');
    // The follow-up window starts after the first and includes s3 as context.
    expect(calls[1][0].id).toBe('s3');
    expect(calls[1].at(-1)?.id).toBe('s18');
    await settle();
    scheduler.update(40);
    expect(calls).toHaveLength(2);
    scheduler.update(70);
    expect(calls).toHaveLength(3);
    expect(calls[2].map((unit) => unit.id)).not.toContain('s15');
  });

  it('cancels outstanding work when the viewer seeks far away, and ignores late results', async () => {
    const { scheduler, calls, cancel, translated, settle } = setup();
    scheduler.update(0);
    scheduler.seek(150);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(calls[1][0].id).toBe('s30');
    await settle();
    expect(translated.has('s0')).toBe(false);
    expect(translated.get('s30')).toBe('译 Line 30.');
  });

  it('does not cancel when seeking within the translated range', async () => {
    const { scheduler, cancel, settle } = setup();
    scheduler.update(0);
    await settle();
    scheduler.seek(10);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('retries a failed window on the next update', async () => {
    const failing = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (units: TranslationUnit[]) => units);
    const onFailure = vi.fn();
    const scheduler = createSubtitleScheduler({
      sentences,
      translate: failing,
      cancel: vi.fn(),
      targetLanguage: 'zh-CN',
      onTranslated: vi.fn(),
      onFailure,
    });
    scheduler.update(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onFailure).toHaveBeenCalledTimes(1);
    scheduler.update(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing.mock.calls.at(-1)?.[0][0].id).toBe('s0');
  });
});
