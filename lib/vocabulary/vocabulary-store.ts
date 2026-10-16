import { storage } from '@wxt-dev/storage';
import {
  DEFAULT_VOCABULARY,
  resolveVocabulary,
  type VocabularySettings,
} from './vocabulary-model';

export const vocabularyItem = storage.defineItem<VocabularySettings>(
  'local:vocabulary',
  { fallback: DEFAULT_VOCABULARY },
);

export async function getVocabulary(): Promise<VocabularySettings> {
  return resolveVocabulary(await vocabularyItem.getValue());
}

export async function updateVocabulary(
  update: (current: VocabularySettings) => Partial<VocabularySettings>,
): Promise<VocabularySettings> {
  const current = await getVocabulary();
  const next = resolveVocabulary({ ...current, ...update(current) });
  await vocabularyItem.setValue(next);
  return next;
}

export function watchVocabulary(
  callback: (vocabulary: VocabularySettings) => void,
): () => void {
  return vocabularyItem.watch((value) => callback(resolveVocabulary(value)));
}
