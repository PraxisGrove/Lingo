import type { MessageKey } from '../i18n/resources';
import type { TranslationPortClient } from '../messaging/translation-port';
import type { RuleSelectors } from '../rules/rule-resolver';
import type { ExtensionSettings } from '../storage/settings-model';
import { createHighlighter, supportsHighlights } from './highlighter';
import type { VocabularySettings } from './vocabulary-model';
import { createWordCard } from './word-card';
import type { RankedWord } from './word-ranks';

export type VocabularyLayerDependencies = {
  document: Document;
  client: TranslationPortClient;
  classify(words: string[]): Promise<Record<string, RankedWord | null>>;
  getRuleSelectors?: () => Promise<RuleSelectors>;
  t(key: MessageKey): string;
  markKnown(lemma: string): Promise<void>;
  save(entry: { word: string; gloss: string; context: string }): Promise<void>;
};

/** Connects highlighting and the word card to the reader's preferences. */
export function createVocabularyLayer(
  dependencies: VocabularyLayerDependencies,
) {
  const { document } = dependencies;
  let vocabulary: VocabularySettings | undefined;
  let settings: ExtensionSettings | undefined;
  let known = new Set<string>();
  const highlighter = createHighlighter({
    document,
    classify: dependencies.classify,
    getRuleSelectors: dependencies.getRuleSelectors,
    isHard: (word) =>
      word.rank > (vocabulary?.vocabularySize ?? Number.POSITIVE_INFINITY) &&
      !known.has(word.lemma),
    onChange: () => card?.sync(),
  });
  const card = supportsHighlights(document.defaultView)
    ? createWordCard({
        document,
        highlighter,
        translate: dependencies.client.translate,
        t: dependencies.t,
        markKnown: dependencies.markKnown,
        save: dependencies.save,
      })
    : undefined;

  function active() {
    return Boolean(
      vocabulary?.enabled &&
        settings?.enabled &&
        settings.activeProviderProfileId &&
        !settings.targetLanguage.toLowerCase().startsWith('en'),
    );
  }

  function apply(previous?: {
    vocabulary?: VocabularySettings;
    settings?: ExtensionSettings;
  }) {
    if (settings) card?.update(settings);
    if (!active()) {
      highlighter.stop();
      card?.hide();
      return;
    }
    const changed =
      previous?.vocabulary?.vocabularySize !== vocabulary?.vocabularySize ||
      previous?.vocabulary?.knownWords !== vocabulary?.knownWords ||
      previous?.settings?.targetLanguage !== settings?.targetLanguage;
    if (highlighter.isActive() && changed) highlighter.refresh();
    else highlighter.start();
  }

  return {
    updateVocabulary(next: VocabularySettings) {
      const previous = { vocabulary, settings };
      vocabulary = next;
      known = new Set(next.knownWords);
      apply(previous);
    },
    updateSettings(next: ExtensionSettings) {
      const previous = { vocabulary, settings };
      settings = next;
      apply(previous);
    },
    /** Page content was replaced or retranslated; scan it again. */
    refresh() {
      card?.hide();
      highlighter.refresh();
    },
    dispose() {
      highlighter.stop();
      card?.dispose();
      dependencies.client.disconnect();
    },
  };
}
