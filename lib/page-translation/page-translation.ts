import type { TranslationUnit } from '@/lib/translation/types';

export type DisplayMode = 'bilingual';

export type StartSessionOptions = {
  targetLanguage: string;
  displayMode: DisplayMode;
};

export type SessionPatch = {
  displayMode: DisplayMode;
};

export type SessionSnapshot = {
  status: 'idle' | 'translating' | 'translated';
  displayMode: DisplayMode;
  translatedUnitCount: number;
};

export type PageTranslationEvent = {
  snapshot: SessionSnapshot;
};

export type PageTranslation = {
  start(options: StartSessionOptions): Promise<SessionSnapshot>;
  update(patch: SessionPatch): Promise<SessionSnapshot>;
  stop(): Promise<void>;
  subscribe(listener: (event: PageTranslationEvent) => void): () => void;
  snapshot(): SessionSnapshot;
};

type TranslationClient = (
  units: TranslationUnit[],
  targetLanguage: string,
) => Promise<TranslationUnit[]>;

type PageTranslationDependencies = {
  document: Document;
  translate: TranslationClient;
};

const TRANSLATION_ATTRIBUTE = 'data-lingo-translation';
const PROTECTED_SELECTOR = [
  '[translate="no"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[hidden]',
  '[aria-hidden="true"]',
  'form',
  'script',
  'style',
  'code',
  'pre',
  'input',
  'textarea',
  'select',
].join(',');

export function createPageTranslation({
  document,
  translate,
}: PageTranslationDependencies): PageTranslation {
  const listeners = new Set<(event: PageTranslationEvent) => void>();
  const unitIds = new WeakMap<HTMLParagraphElement, string>();
  const insertedTranslations = new Set<HTMLElement>();
  let nextUnitId = 1;
  let current: SessionSnapshot = {
    status: 'idle',
    displayMode: 'bilingual',
    translatedUnitCount: 0,
  };

  function publish(snapshot: SessionSnapshot) {
    current = snapshot;
    for (const listener of listeners) {
      listener({ snapshot });
    }
    return snapshot;
  }

  return {
    async start(options) {
      if (current.status !== 'idle') {
        return this.update({ displayMode: options.displayMode });
      }

      publish({ ...current, status: 'translating' });
      const paragraphs = findParagraphs(document);
      const units = paragraphs.map((paragraph) => {
        let id = unitIds.get(paragraph);
        if (!id) {
          id = `paragraph-${nextUnitId}`;
          nextUnitId += 1;
          unitIds.set(paragraph, id);
        }
        return { id, text: paragraph.textContent?.trim() ?? '' };
      });
      const translations = await translate(units, options.targetLanguage);
      const translationsById = new Map(
        translations.map((translation) => [translation.id, translation]),
      );

      for (const [index, paragraph] of paragraphs.entries()) {
        const translation = translationsById.get(units[index].id);
        if (!translation) continue;

        const translatedParagraph = document.createElement('p');
        translatedParagraph.setAttribute(
          TRANSLATION_ATTRIBUTE,
          units[index].id,
        );
        translatedParagraph.lang = options.targetLanguage;
        translatedParagraph.textContent = translation.text;
        paragraph.after(translatedParagraph);
        insertedTranslations.add(translatedParagraph);
      }

      return publish({
        status: 'translated',
        displayMode: options.displayMode,
        translatedUnitCount: translations.length,
      });
    },
    async update(patch) {
      return publish({ ...current, displayMode: patch.displayMode });
    },
    async stop() {
      for (const translation of insertedTranslations) {
        translation.remove();
      }
      insertedTranslations.clear();
      publish({
        status: 'idle',
        displayMode: 'bilingual',
        translatedUnitCount: 0,
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot() {
      return current;
    },
  };
}

function findParagraphs(document: Document): HTMLParagraphElement[] {
  return [...document.querySelectorAll('article p, main p')].filter(
    (paragraph): paragraph is HTMLParagraphElement =>
      !paragraph.closest(`[${TRANSLATION_ATTRIBUTE}]`) &&
      !paragraph.closest(PROTECTED_SELECTOR) &&
      Boolean(paragraph.textContent?.trim()),
  );
}
