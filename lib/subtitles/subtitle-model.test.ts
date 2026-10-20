import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLES, resolveSubtitles } from './subtitle-model';

describe('subtitle preferences', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(resolveSubtitles(undefined)).toEqual(DEFAULT_SUBTITLES);
    expect(
      resolveSubtitles({
        displayMode: 'karaoke',
        fontScale: 9,
        playerButton: 'no',
      }),
    ).toEqual(DEFAULT_SUBTITLES);
  });

  it('keeps valid choices and normalizes auto-start sites', () => {
    expect(
      resolveSubtitles({
        displayMode: 'translation',
        fontScale: 1.2,
        playerButton: false,
        autoStartHosts: ['WWW.YouTube.com', 'www.youtube.com', 'bad host', 42],
      }),
    ).toEqual({
      displayMode: 'translation',
      fontScale: 1.2,
      playerButton: false,
      autoStartHosts: ['www.youtube.com'],
    });
  });
});
