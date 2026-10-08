import { describe, expect, it } from 'vitest';
import { preservesInlineMarkers } from './inline-markers';

describe('translation inline marker integrity', () => {
  it.each([
    [
      'Read ⟦1⟧the guide⟦/1⟧ and ⟦KEEP:2⟧.',
      '阅读 ⟦KEEP:2⟧ 与 ⟦1⟧指南⟦/1⟧。',
      true,
    ],
    ['Use ⟦KEEP:1⟧.', '使用。', false],
    ['Use ⟦KEEP:1⟧.', '⟦KEEP:1⟧ ⟦KEEP:1⟧', false],
    ['⟦1⟧⟦2⟧Text⟦/2⟧⟦/1⟧', '⟦1⟧⟦2⟧文本⟦/1⟧⟦/2⟧', false],
    ['Hello.', '你好。', true],
  ])('validates marker preservation: %s', (source, translated, expected) => {
    expect(preservesInlineMarkers(String(source), String(translated))).toBe(
      expected,
    );
  });
});
