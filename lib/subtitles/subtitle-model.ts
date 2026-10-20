import type { SubtitleDisplayMode } from './overlay';

export type SubtitlePreferences = {
  displayMode: SubtitleDisplayMode;
  fontScale: number;
  /** Sites where subtitles start with the video without a click. */
  autoStartHosts: string[];
  /** Show the in-player start button. */
  playerButton: boolean;
};

export const FONT_SCALES = [0.8, 1, 1.2, 1.4] as const;

export const DEFAULT_SUBTITLES: SubtitlePreferences = {
  displayMode: 'bilingual',
  fontScale: 1,
  autoStartHosts: [],
  playerButton: true,
};

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export function resolveSubtitles(value: unknown): SubtitlePreferences {
  if (!value || typeof value !== 'object') return DEFAULT_SUBTITLES;
  const candidate = value as Record<string, unknown>;
  return {
    displayMode:
      candidate.displayMode === 'translation' ? 'translation' : 'bilingual',
    fontScale: FONT_SCALES.includes(
      candidate.fontScale as (typeof FONT_SCALES)[number],
    )
      ? (candidate.fontScale as number)
      : DEFAULT_SUBTITLES.fontScale,
    autoStartHosts: Array.isArray(candidate.autoStartHosts)
      ? [
          ...new Set(
            candidate.autoStartHosts
              .filter((host): host is string => typeof host === 'string')
              .map((host) => host.trim().toLowerCase())
              .filter((host) => HOSTNAME.test(host)),
          ),
        ].slice(0, 500)
      : [],
    playerButton:
      typeof candidate.playerButton === 'boolean'
        ? candidate.playerButton
        : DEFAULT_SUBTITLES.playerButton,
  };
}
