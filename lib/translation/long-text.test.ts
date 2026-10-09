import { describe, expect, it } from 'vitest';
import { preservesInlineMarkers } from './inline-markers';
import { joinLongUnit, splitLongUnit } from './long-text';

describe('long paragraph splitting', () => {
  it.each([
    'Plain prose. '.repeat(50),
    `Before ⟦1⟧${'A formatted sentence. '.repeat(60)}⟦/1⟧ after ⟦KEEP:2⟧.`,
    `⟦1⟧⟦2⟧${'中文😀没有空格'.repeat(90)}⟦/2⟧⟦/1⟧`,
  ])('preserves text, Unicode, formatting, and opaque code across bounded chunks', (text) => {
    const parts = splitLongUnit({ id: 'p', number: 1, text }, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.unit.text.length).toBeLessThanOrEqual(100);
      expect(preservesInlineMarkers(part.unit.text, part.unit.text)).toBe(true);
      expect(part.unit.text).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
      );
    }
    expect(
      joinLongUnit(
        parts,
        new Map(parts.map((part) => [part.unit.id, part.unit.text])),
      ),
    ).toBe(text);
  });

  it('does not present a partial paragraph or malformed formatting', () => {
    const parts = splitLongUnit(
      { id: 'p', number: 1, text: `⟦1⟧${'Sentence. '.repeat(50)}⟦/1⟧` },
      100,
    );
    const results = new Map(
      parts.map((part) => [part.unit.id, part.unit.text]),
    );
    results.delete(parts[1].unit.id);
    expect(joinLongUnit(parts, results)).toBeUndefined();
    results.set(parts[1].unit.id, 'Marker removed.');
    expect(joinLongUnit(parts, results)).toBeUndefined();
  });
});
