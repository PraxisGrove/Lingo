import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATION_APPEARANCE,
  resolveTranslationAppearance,
  TRANSLATION_APPEARANCE_PRESETS,
  translationAppearancePreset,
} from './appearance';

describe('translation appearance preferences', () => {
  it('keeps the source page typography by default', () => {
    expect(resolveTranslationAppearance(undefined)).toEqual(
      DEFAULT_TRANSLATION_APPEARANCE,
    );
    expect(DEFAULT_TRANSLATION_APPEARANCE).toMatchObject({
      color: null,
      fontFamily: 'inherit',
      fontScale: 1,
      lineHeight: null,
      separator: 'none',
    });
  });

  it('bounds imported numbers and only accepts a literal hex color', () => {
    expect(
      resolveTranslationAppearance({
        fontScale: 20,
        lineHeight: 0,
        paragraphGap: -4,
        color: 'url(https://example.com/tracking)',
        fontFamily: 'custom-font; display:none',
        separator: 'custom-css',
      }),
    ).toEqual({
      ...DEFAULT_TRANSLATION_APPEARANCE,
      fontScale: 1.4,
      lineHeight: 1.2,
      paragraphGap: 0,
    });
    expect(resolveTranslationAppearance({ color: '#AbC123' }).color).toBe(
      '#abc123',
    );
    expect(
      resolveTranslationAppearance({
        fontScale: Number.NaN,
        lineHeight: Number.POSITIVE_INFINITY,
        paragraphGap: '1',
      }),
    ).toEqual(DEFAULT_TRANSLATION_APPEARANCE);
  });

  it('recognizes presets after a round-trip and detects custom values', () => {
    for (const [name, preset] of Object.entries(TRANSLATION_APPEARANCE_PRESETS))
      expect(
        translationAppearancePreset(resolveTranslationAppearance(preset)),
      ).toBe(name);
    expect(
      translationAppearancePreset({
        ...DEFAULT_TRANSLATION_APPEARANCE,
        color: '#315742',
      }),
    ).toBe('custom');
  });
});
