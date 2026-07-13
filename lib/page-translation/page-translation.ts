import type { TranslationUnit } from '@/lib/translation/types';

export type DisplayMode = 'bilingual' | 'translation' | 'original';
export type ContentScope = 'main' | 'main-and-interface';

export type StartSessionOptions = {
  targetLanguage: string;
  displayMode: DisplayMode;
  contentScope?: ContentScope;
  translateImmediately?: boolean;
};

export type SessionPatch = {
  displayMode: DisplayMode;
  translateImmediately?: boolean;
};

export type SessionSnapshot = {
  status: 'idle' | 'translating' | 'translated';
  displayMode: DisplayMode;
  translatedUnitCount: number;
  pageRevision: number;
};

export type PageTranslationEvent = { snapshot: SessionSnapshot };

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

type Candidate = {
  element: HTMLElement;
  id: string;
  number: number;
  encodedText: string;
  inlineElements: Map<string, HTMLElement>;
};

const TRANSLATION_ATTRIBUTE = 'data-lingo-translation';
const HIDDEN_ATTRIBUTE = 'data-lingo-hidden';
const PROTECTED_SELECTOR = [
  '[data-lingo-content="exclude"]',
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
  '[role="textbox"]',
  '[class*="payment" i]',
  '[id*="payment" i]',
  '[class*="advert" i]',
  '[class~="ad" i]',
].join(',');
const INTERFACE_SELECTOR =
  '[data-lingo-content="interface"], nav, header, footer, [role="navigation"]';
const INLINE_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'CITE',
  'DEL',
  'EM',
  'I',
  'INS',
  'KBD',
  'MARK',
  'Q',
  'S',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
]);

export function createPageTranslation({
  document,
  translate,
}: PageTranslationDependencies): PageTranslation {
  const listeners = new Set<(event: PageTranslationEvent) => void>();
  const unitIds = new WeakMap<HTMLElement, string>();
  const unitNumbers = new WeakMap<HTMLElement, number>();
  let processed = new WeakSet<HTMLElement>();
  const insertedTranslations = new Map<HTMLElement, HTMLElement>();
  const pending = new Set<HTMLElement>();
  let nextUnitId = 1;
  let observer: MutationObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let mutationScheduled = false;
  let activeOptions: StartSessionOptions | undefined;
  let restoreHistory: (() => void) | undefined;
  let sessionToken = 0;
  let current: SessionSnapshot = {
    status: 'idle',
    displayMode: 'bilingual',
    translatedUnitCount: 0,
    pageRevision: 0,
  };

  function publish(snapshot: SessionSnapshot) {
    current = snapshot;
    for (const listener of listeners) listener({ snapshot });
    return snapshot;
  }

  function applyDisplayMode(mode: DisplayMode) {
    for (const [original, translation] of insertedTranslations) {
      if (mode === 'translation') original.setAttribute(HIDDEN_ATTRIBUTE, '');
      else original.removeAttribute(HIDDEN_ATTRIBUTE);
      translation.hidden = mode === 'original';
    }
  }

  async function translateElements(elements: HTMLElement[]) {
    const options = activeOptions;
    if (!options) return;
    const revision = current.pageRevision;
    const token = sessionToken;
    const candidates = elements
      .filter((element) => !processed.has(element) && element.isConnected)
      .map(createCandidate);
    if (candidates.length === 0) return;
    for (const candidate of candidates) {
      processed.add(candidate.element);
      pending.delete(candidate.element);
      intersectionObserver?.unobserve(candidate.element);
    }
    const translations = await translate(
      candidates.map(({ id, number, encodedText }) => ({
        id,
        number,
        text: encodedText,
      })),
      options.targetLanguage,
    );
    if (
      token !== sessionToken ||
      revision !== current.pageRevision ||
      !activeOptions
    ) {
      return;
    }
    const byId = new Map(translations.map((unit) => [unit.id, unit.text]));
    let inserted = 0;
    for (const candidate of candidates) {
      const text = byId.get(candidate.id);
      if (text === undefined || !candidate.element.isConnected) continue;
      const translation = document.createElement(candidate.element.tagName);
      translation.setAttribute(TRANSLATION_ATTRIBUTE, candidate.id);
      translation.lang = options.targetLanguage;
      renderTranslatedContent(translation, text, candidate.inlineElements);
      candidate.element.after(translation);
      insertedTranslations.set(candidate.element, translation);
      inserted += 1;
    }
    applyDisplayMode(current.displayMode);
    publish({
      ...current,
      status: 'translated',
      translatedUnitCount: current.translatedUnitCount + inserted,
    });
  }

  function createCandidate(element: HTMLElement): Candidate {
    const { id, number } = assignUnitIdentity(element);
    const { text, inlineElements } = encodeInlineContent(element);
    return { element, id, number, encodedText: text, inlineElements };
  }

  function assignUnitIdentity(element: HTMLElement): {
    id: string;
    number: number;
  } {
    let id = unitIds.get(element);
    let number = unitNumbers.get(element);
    if (!id || number === undefined) {
      id = `paragraph-${nextUnitId}`;
      number = nextUnitId;
      nextUnitId += 1;
      unitIds.set(element, id);
      unitNumbers.set(element, number);
    }
    return { id, number };
  }

  function schedule(elements: HTMLElement[]) {
    for (const element of elements) assignUnitIdentity(element);
    const fresh = elements.filter((element) => !processed.has(element));
    if (
      activeOptions?.translateImmediately !== false ||
      !intersectionObserver
    ) {
      void translateElements(fresh);
      return;
    }
    for (const element of fresh) {
      pending.add(element);
      intersectionObserver.observe(element);
    }
  }

  function handleNavigation() {
    if (!activeOptions) return;
    sessionToken += 1;
    for (const translation of insertedTranslations.values())
      translation.remove();
    for (const original of insertedTranslations.keys())
      original.removeAttribute(HIDDEN_ATTRIBUTE);
    insertedTranslations.clear();
    pending.clear();
    processed = new WeakSet<HTMLElement>();
    publish({
      ...current,
      status: 'translating',
      translatedUnitCount: 0,
      pageRevision: current.pageRevision + 1,
    });
    schedule(findCandidates(document, activeOptions.contentScope ?? 'main'));
  }

  function observePage() {
    observer = new MutationObserver(() => {
      if (mutationScheduled || !activeOptions) return;
      mutationScheduled = true;
      queueMicrotask(() => {
        mutationScheduled = false;
        if (activeOptions) {
          schedule(
            findCandidates(document, activeOptions.contentScope ?? 'main'),
          );
        }
      });
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .map((entry) => entry.target)
            .filter(
              (target): target is HTMLElement => target instanceof HTMLElement,
            );
          void translateElements(visible);
        },
        { rootMargin: '75% 0px' },
      );
    }
    document.defaultView?.addEventListener('popstate', handleNavigation);
    const view = document.defaultView;
    if (view) {
      const { history } = view;
      const originalPushState = history.pushState.bind(history);
      const originalReplaceState = history.replaceState.bind(history);
      history.pushState = (...args) => {
        originalPushState(...args);
        handleNavigation();
      };
      history.replaceState = (...args) => {
        originalReplaceState(...args);
        handleNavigation();
      };
      restoreHistory = () => {
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
      };
    }
  }

  return {
    async start(options) {
      if (current.status !== 'idle') {
        return this.update({
          displayMode: options.displayMode,
          translateImmediately: options.translateImmediately,
        });
      }
      activeOptions = options;
      sessionToken += 1;
      publish({
        ...current,
        status: 'translating',
        displayMode: options.displayMode,
      });
      observePage();
      const candidates = findCandidates(
        document,
        options.contentScope ?? 'main',
      );
      if (options.translateImmediately !== false || !intersectionObserver) {
        await translateElements(candidates);
      } else {
        schedule(candidates);
      }
      return current;
    },
    async update(patch) {
      if (activeOptions) {
        activeOptions = { ...activeOptions, ...patch };
        if (patch.translateImmediately) {
          intersectionObserver?.disconnect();
          intersectionObserver = undefined;
          await translateElements([...pending]);
        }
      }
      applyDisplayMode(patch.displayMode);
      return publish({ ...current, displayMode: patch.displayMode });
    },
    async stop() {
      sessionToken += 1;
      activeOptions = undefined;
      observer?.disconnect();
      intersectionObserver?.disconnect();
      observer = undefined;
      intersectionObserver = undefined;
      document.defaultView?.removeEventListener('popstate', handleNavigation);
      restoreHistory?.();
      restoreHistory = undefined;
      for (const translation of insertedTranslations.values())
        translation.remove();
      for (const original of insertedTranslations.keys())
        original.removeAttribute(HIDDEN_ATTRIBUTE);
      insertedTranslations.clear();
      pending.clear();
      processed = new WeakSet<HTMLElement>();
      publish({
        status: 'idle',
        displayMode: 'bilingual',
        translatedUnitCount: 0,
        pageRevision: current.pageRevision,
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

function findCandidates(
  document: Document,
  scope: ContentScope,
): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('p, li, blockquote'),
  ].filter(
    (element) =>
      !element.closest(`[${TRANSLATION_ATTRIBUTE}]`) &&
      !element.closest(PROTECTED_SELECTOR) &&
      (scope === 'main-and-interface' ||
        !element.closest(INTERFACE_SELECTOR)) &&
      isVisible(element) &&
      isContentCandidate(element, scope),
  );
}

function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function isContentCandidate(
  element: HTMLElement,
  scope: ContentScope,
): boolean {
  const text = element.textContent?.trim() ?? '';
  if (!text) return false;
  if (element.closest('[data-lingo-content="main"], article, main'))
    return true;
  if (element.closest(INTERFACE_SELECTOR))
    return scope === 'main-and-interface';
  if (element.closest('aside')) return false;
  const linkTextLength = [...element.querySelectorAll('a')].reduce(
    (length, link) => length + (link.textContent?.trim().length ?? 0),
    0,
  );
  return text.length >= 40 && linkTextLength / text.length < 0.5;
}

function encodeInlineContent(element: HTMLElement): {
  text: string;
  inlineElements: Map<string, HTMLElement>;
} {
  let nextMarker = 1;
  const inlineElements = new Map<string, HTMLElement>();
  function encode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof HTMLElement) || !INLINE_TAGS.has(node.tagName)) {
      return node.textContent ?? '';
    }
    const marker = String(nextMarker++);
    inlineElements.set(marker, node);
    return `⟦${marker}⟧${[...node.childNodes].map(encode).join('')}⟦/${marker}⟧`;
  }
  return {
    text: [...element.childNodes].map(encode).join('').trim(),
    inlineElements,
  };
}

function renderTranslatedContent(
  target: HTMLElement,
  text: string,
  inlineElements: Map<string, HTMLElement>,
) {
  const stack: Array<{ element: HTMLElement; marker?: string }> = [
    { element: target },
  ];
  const markerPattern = /⟦(\/)?(\d+)⟧/g;
  let cursor = 0;
  for (const match of text.matchAll(markerPattern)) {
    stack
      .at(-1)
      ?.element.append(
        target.ownerDocument.createTextNode(text.slice(cursor, match.index)),
      );
    const [, closing, marker] = match;
    if (closing) {
      if (stack.at(-1)?.marker === marker) stack.pop();
    } else {
      const source = inlineElements.get(marker);
      if (source) {
        const clone = source.cloneNode(false) as HTMLElement;
        for (const attribute of [...clone.attributes]) {
          if (attribute.name.startsWith('on') || attribute.name === 'id') {
            clone.removeAttribute(attribute.name);
          }
        }
        stack.at(-1)?.element.append(clone);
        stack.push({ element: clone, marker });
      }
    }
    cursor = (match.index ?? 0) + match[0].length;
  }
  stack
    .at(-1)
    ?.element.append(target.ownerDocument.createTextNode(text.slice(cursor)));
}
