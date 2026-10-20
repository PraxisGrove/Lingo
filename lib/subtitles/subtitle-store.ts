import { storage } from '@wxt-dev/storage';
import {
  DEFAULT_SUBTITLES,
  resolveSubtitles,
  type SubtitlePreferences,
} from './subtitle-model';

export const subtitleItem = storage.defineItem<SubtitlePreferences>(
  'local:subtitles',
  { fallback: DEFAULT_SUBTITLES },
);

export async function getSubtitlePreferences(): Promise<SubtitlePreferences> {
  return resolveSubtitles(await subtitleItem.getValue());
}

export async function updateSubtitlePreferences(
  update: (current: SubtitlePreferences) => Partial<SubtitlePreferences>,
): Promise<SubtitlePreferences> {
  const current = await getSubtitlePreferences();
  const next = resolveSubtitles({ ...current, ...update(current) });
  await subtitleItem.setValue(next);
  return next;
}

export function watchSubtitlePreferences(
  callback: (preferences: SubtitlePreferences) => void,
): () => void {
  return subtitleItem.watch((value) => callback(resolveSubtitles(value)));
}
