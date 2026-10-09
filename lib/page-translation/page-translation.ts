import type { TranslationUnit } from '@/lib/translation/types';
import type { Logger } from '../logger/logger';
import type { RuleSelectors } from '../rules/rule-resolver';
import {
  accessibleRoots,
  composedClosest,
  composedContains,
  isComposedVisible,
} from './composed-dom';

export type DisplayMode = 'bilingual' | 'translation' | 'original';
export type ContentScope = 'main' | 'main-and-interface';

export type StartSessionOptions = {
  targetLanguage: string;
  restart?: boolean;
  displayMode: DisplayMode;
  contentScope?: ContentScope;
  translateImmediately?: boolean;
};

export type SessionPatch = {
  displayMode: DisplayMode;
  translateImmediately?: boolean;
  retryFailed?: boolean;
};

export type TranslationClientFailure = {
  unitId: string;
  category: string;
  message: string;
};

export type TranslationClientResult =
  | TranslationUnit[]
  | {
      translations: TranslationUnit[];
      failures: TranslationClientFailure[];
    };

export type SessionSnapshot = {
  status: 'idle' | 'translating' | 'translated' | 'failed';
  displayMode: DisplayMode;
  translatedUnitCount: number;
  failedUnitCount: number;
  totalUnitCount: number;
  pageRevision: number;
  failure?: {
    category: string;
    message: string;
  };
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
  onProgress?: (translations: TranslationUnit[]) => void,
) => Promise<TranslationClientResult>;

type PageTranslationDependencies = {
  document: Document;
  translate: TranslationClient;
  cancel?: () => void;
  getRuleSelectors?: () => Promise<RuleSelectors>;
  watchNavigation?: (listener: () => void) => () => void;
  logger?: Logger;
  shadowStyle?: string;
};

type Candidate = {
  element: HTMLElement;
  id: string;
  number: number;
  encodedText: string;
  signature: string;
  inlineElements: Map<string, HTMLElement>;
  preservedElements: Map<string, HTMLElement>;
  translatedText?: string;
};

const OBSERVATION_OPTIONS: MutationObserverInit = {
  childList: true,
  characterData: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    'translate',
    'contenteditable',
    'hidden',
    'aria-hidden',
    'class',
    'id',
    'style',
    'data-lingo-content',
    'href',
    'title',
    'aria-label',
    'slot',
    'name',
  ],
};

const TRANSLATION_ATTRIBUTE = 'data-lingo-translation';
const HIDDEN_ATTRIBUTE = 'data-lingo-hidden';
const TABLE_CELL_HIDDEN_ATTRIBUTE = 'data-lingo-cell-original-hidden';
const PROTECTED_SELECTOR = [
  '[data-lingo-owned]',
  '[data-lingo-floating-control]',
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
const CONTENT_CANDIDATE_SELECTOR =
  'h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, td, th';
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
  cancel,
  getRuleSelectors,
  watchNavigation,
  logger,
  shadowStyle,
}: PageTranslationDependencies): PageTranslation {
  const listeners = new Set<(event: PageTranslationEvent) => void>();
  const unitIds = new WeakMap<HTMLElement, string>();
  const unitNumbers = new WeakMap<HTMLElement, number>();
  const processed = new Map<HTMLElement, Candidate>();
  const knownCandidates = new Set<HTMLElement>();
  const insertedTranslations = new Map<HTMLElement, HTMLElement>();
  const failedElements = new Set<HTMLElement>();
  const pausedVisibleElements = new Set<HTMLElement>();
  const pending = new Set<HTMLElement>();
  const activeRequests = new Set<symbol>();
  let nextUnitId = 1;
  let observer: MutationObserver | undefined;
  const observedRoots = new Set<ShadowRoot>();
  const shadowStyles = new Set<HTMLStyleElement>();
  let shadowDiscoveryTimer: ReturnType<typeof setInterval> | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let mutationScheduled = false;
  const mutationRoots = new Set<Element>();
  const invalidatedRoots = new Set<Element>();
  let activeOptions: StartSessionOptions | undefined;
  let selectors: RuleSelectors = {};
  let restoreHistory: (() => void) | undefined;
  let sessionToken = 0;
  let pageUrl = document.location.href;
  let current: SessionSnapshot = {
    status: 'idle',
    displayMode: 'bilingual',
    translatedUnitCount: 0,
    failedUnitCount: 0,
    totalUnitCount: 0,
    pageRevision: 0,
  };

  function publish(snapshot: SessionSnapshot) {
    current = snapshot;
    for (const listener of listeners) listener({ snapshot });
    return snapshot;
  }

  function applyDisplayMode(mode: DisplayMode) {
    for (const [original, translation] of insertedTranslations) {
      applyUnitDisplayMode(original, translation, mode);
    }
  }

  function applyUnitDisplayMode(
    original: HTMLElement,
    translation: HTMLElement,
    mode: DisplayMode,
  ) {
    const hiddenAttribute = isTableCell(original)
      ? TABLE_CELL_HIDDEN_ATTRIBUTE
      : HIDDEN_ATTRIBUTE;
    if (mode === 'translation') original.setAttribute(hiddenAttribute, '');
    else original.removeAttribute(hiddenAttribute);
    translation.hidden = mode === 'original';
  }

  function removeTranslations() {
    for (const translation of insertedTranslations.values())
      translation.remove();
    for (const original of insertedTranslations.keys()) {
      original.removeAttribute(HIDDEN_ATTRIBUTE);
      original.removeAttribute(TABLE_CELL_HIDDEN_ATTRIBUTE);
    }
    insertedTranslations.clear();
  }

  function removeTranslation(original: HTMLElement) {
    insertedTranslations.get(original)?.remove();
    insertedTranslations.delete(original);
    original.removeAttribute(HIDDEN_ATTRIBUTE);
    original.removeAttribute(TABLE_CELL_HIDDEN_ATTRIBUTE);
  }

  function refreshChangedContent(roots: Element[], rechecked: Element[] = []) {
    for (const element of knownCandidates) {
      const candidate = processed.get(element);
      const detached = !element.isConnected;
      if (
        !detached &&
        !roots.some(
          (root) =>
            composedContains(root, element) || composedContains(element, root),
        )
      )
        continue;
      const checkEligibility =
        detached ||
        rechecked.some(
          (root) =>
            composedContains(root, element) || composedContains(element, root),
        );
      let eligible = !detached;
      let cellFontSize: string | undefined;
      if (eligible && checkEligibility) {
        // Temporarily remove our display flag while evaluating the page's own
        // visibility. Restore it synchronously, without repainting or replacing DOM.
        const hidden = element.hasAttribute(HIDDEN_ATTRIBUTE);
        const cellHidden = element.hasAttribute(TABLE_CELL_HIDDEN_ATTRIBUTE);
        if (hidden) element.removeAttribute(HIDDEN_ATTRIBUTE);
        if (cellHidden) element.removeAttribute(TABLE_CELL_HIDDEN_ATTRIBUTE);
        eligible =
          canTranslateContent(element) && !excludedByRules(element, selectors);
        if (eligible && isTableCell(element))
          cellFontSize =
            document.defaultView?.getComputedStyle(element).fontSize;
        if (hidden) element.setAttribute(HIDDEN_ATTRIBUTE, '');
        if (cellHidden) element.setAttribute(TABLE_CELL_HIDDEN_ATTRIBUTE, '');
      }
      const encoded = detached ? undefined : encodeInlineContent(element);
      if (eligible && (!candidate || encoded?.text === candidate.encodedText)) {
        if (candidate && encoded) {
          const changed = encoded.signature !== candidate.signature;
          candidate.signature = encoded.signature;
          candidate.inlineElements = encoded.inlineElements;
          candidate.preservedElements = encoded.preservedElements;
          const translation = insertedTranslations.get(element);
          if (translation) {
            if (cellFontSize) translation.style.fontSize = cellFontSize;
            if (changed && candidate.translatedText) {
              translation.replaceChildren();
              renderTranslatedContent(
                translation,
                candidate.translatedText,
                encoded.inlineElements,
                encoded.preservedElements,
              );
            }
            if (checkEligibility && !isTableCell(element)) {
              const shell = cloneTranslationShell(element);
              for (const attribute of [...translation.attributes]) {
                if (
                  ![TRANSLATION_ATTRIBUTE, 'lang', 'hidden'].includes(
                    attribute.name,
                  )
                )
                  translation.removeAttribute(attribute.name);
              }
              for (const attribute of [...shell.attributes]) {
                if (!['lang', 'hidden'].includes(attribute.name))
                  translation.setAttribute(attribute.name, attribute.value);
              }
            }
          }
        }
        continue;
      }
      processed.delete(element);
      failedElements.delete(element);
      removeTranslation(element);
      if (
        detached ||
        !eligible ||
        !canTranslateContent(element) ||
        excludedByRules(element, selectors)
      ) {
        knownCandidates.delete(element);
        pending.delete(element);
        pausedVisibleElements.delete(element);
        intersectionObserver?.unobserve(element);
      }
    }
    publish({
      ...current,
      translatedUnitCount: insertedTranslations.size,
      failedUnitCount: failedElements.size,
      totalUnitCount: knownCandidates.size,
    });
  }

  function isCurrentCandidate(candidate: Candidate) {
    return (
      processed.get(candidate.element) === candidate &&
      candidate.element.isConnected &&
      encodeInlineContent(candidate.element).signature === candidate.signature
    );
  }

  async function translateElements(elements: HTMLElement[]) {
    const options = activeOptions;
    if (!options) return;
    if (isGloballyPaused(current)) {
      for (const element of elements) pausedVisibleElements.add(element);
      return;
    }
    const revision = current.pageRevision;
    const token = sessionToken;
    const fresh = elements.filter(
      (element) =>
        !processed.has(element) &&
        element.isConnected &&
        canTranslateContent(element) &&
        !excludedByRules(element, selectors),
    );
    registerCandidates(fresh);
    const candidates = fresh.map(createCandidate);
    if (candidates.length === 0) {
      if (
        current.status === 'translating' &&
        activeRequests.size === 0 &&
        pending.size === 0
      ) {
        publish({ ...current, status: 'translated' });
      }
      return;
    }
    for (const candidate of candidates) {
      processed.set(candidate.element, candidate);
      pending.delete(candidate.element);
      intersectionObserver?.unobserve(candidate.element);
    }
    let inserted = 0;
    const candidatesById = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    const renderResults = (translations: TranslationUnit[]) => {
      if (
        token !== sessionToken ||
        revision !== current.pageRevision ||
        !activeOptions
      )
        return;
      for (const unit of translations) {
        const candidate = candidatesById.get(unit.id);
        if (!candidate) continue;
        if (
          insertedTranslations.has(candidate.element) ||
          !isCurrentCandidate(candidate)
        )
          continue;
        const text = unit.text;
        if (
          !candidate.element.isConnected ||
          !canTranslateContent(candidate.element) ||
          excludedByRules(candidate.element, selectors)
        ) {
          continue;
        }
        const tableCell = isTableCell(candidate.element);
        const translation = tableCell
          ? document.createElement('div')
          : cloneTranslationShell(candidate.element);
        if (tableCell) {
          translation.style.fontSize =
            document.defaultView?.getComputedStyle(candidate.element)
              .fontSize || '1rem';
        }
        translation.setAttribute(TRANSLATION_ATTRIBUTE, candidate.id);
        translation.lang = options.targetLanguage;
        renderTranslatedContent(
          translation,
          text,
          candidate.inlineElements,
          candidate.preservedElements,
        );
        if (tableCell) {
          candidate.element.append(translation);
        } else {
          candidate.element.after(translation);
        }
        candidate.translatedText = text;
        insertedTranslations.set(candidate.element, translation);
        applyUnitDisplayMode(
          candidate.element,
          translation,
          current.displayMode,
        );
        failedElements.delete(candidate.element);
        inserted += 1;
      }
      publish({
        ...current,
        translatedUnitCount: insertedTranslations.size,
        failedUnitCount: failedElements.size,
      });
    };
    const requestId = Symbol();
    activeRequests.add(requestId);
    publish({ ...current, status: 'translating' });
    let result: TranslationClientResult;
    logger?.debug('Page translation request started.', {
      pageRevision: revision,
      sessionToken: token,
      unitCount: candidates.length,
      targetLanguage: options.targetLanguage,
    });
    try {
      result = await translate(
        candidates.map(({ id, number, encodedText }) => ({
          id,
          number,
          text: encodedText,
        })),
        options.targetLanguage,
        renderResults,
      ).finally(() => activeRequests.delete(requestId));
    } catch (error) {
      activeRequests.delete(requestId);
      if (
        token !== sessionToken ||
        revision !== current.pageRevision ||
        !activeOptions
      ) {
        return;
      }
      logger?.error('Page translation request failed.', {
        pageRevision: revision,
        sessionToken: token,
        unitCount: candidates.length,
        category: errorCategory(error),
        error,
      });
      const currentCandidates = candidates.filter(
        (candidate) =>
          isCurrentCandidate(candidate) &&
          !insertedTranslations.has(candidate.element),
      );
      if (currentCandidates.length === 0) {
        if (
          activeRequests.size === 0 &&
          pending.size === 0 &&
          !isGloballyPaused(current)
        )
          publish({ ...current, status: 'translated' });
        return;
      }
      for (const candidate of currentCandidates)
        failedElements.add(candidate.element);
      publish({
        ...current,
        status: 'failed',
        failedUnitCount: failedElements.size,
        failure: {
          category: errorCategory(error),
          message:
            error instanceof Error ? error.message : 'Translation failed.',
        },
      });
      return;
    }
    const translations = Array.isArray(result) ? result : result.translations;
    const failures = Array.isArray(result) ? [] : result.failures;
    if (
      token !== sessionToken ||
      revision !== current.pageRevision ||
      !activeOptions
    ) {
      return;
    }
    if (!candidates.some(isCurrentCandidate)) {
      if (
        activeRequests.size === 0 &&
        pending.size === 0 &&
        !isGloballyPaused(current)
      )
        publish({ ...current, status: 'translated' });
      return;
    }
    renderResults(translations);
    for (const candidate of candidates) {
      if (
        isCurrentCandidate(candidate) &&
        !insertedTranslations.has(candidate.element)
      ) {
        failedElements.add(candidate.element);
      }
    }
    if (failedElements.size > 0) {
      logger?.warn('Page translation completed with missing results.', {
        pageRevision: revision,
        sessionToken: token,
        requestedUnitCount: candidates.length,
        translatedUnitCount: inserted,
        failedUnitCount: failedElements.size,
        failureCategories: [
          ...new Set(failures.map((failure) => failure.category)),
        ],
      });
    } else {
      logger?.debug('Page translation request completed.', {
        pageRevision: revision,
        sessionToken: token,
        requestedUnitCount: candidates.length,
        translatedUnitCount: inserted,
      });
    }
    publish({
      ...current,
      status: failures.some((failure) => isBlockingCategory(failure.category))
        ? 'failed'
        : activeRequests.size > 0 || pending.size > 0
          ? 'translating'
          : 'translated',
      translatedUnitCount: insertedTranslations.size,
      failedUnitCount: failedElements.size,
      failure:
        failures[0] ??
        (failedElements.size > 0
          ? {
              category: 'invalid-response',
              message: 'Some paragraphs did not return a translation.',
            }
          : undefined),
    });
  }

  function registerCandidates(elements: HTMLElement[]) {
    let added = 0;
    for (const element of elements) {
      if (knownCandidates.has(element)) continue;
      knownCandidates.add(element);
      added += 1;
    }
    if (added > 0) {
      publish({ ...current, totalUnitCount: current.totalUnitCount + added });
    }
  }

  function createCandidate(element: HTMLElement): Candidate {
    const { id, number } = assignUnitIdentity(element);
    const { text, signature, inlineElements, preservedElements } =
      encodeInlineContent(element);
    return {
      element,
      id,
      number,
      encodedText: text,
      signature,
      inlineElements,
      preservedElements,
    };
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
    registerCandidates(fresh);
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
    const nextUrl = document.location.href;
    if (nextUrl === pageUrl) return;
    pageUrl = nextUrl;
    sessionToken += 1;
    cancel?.();
    activeRequests.clear();
    removeTranslations();
    pending.clear();
    failedElements.clear();
    pausedVisibleElements.clear();
    processed.clear();
    knownCandidates.clear();
    publish({
      ...current,
      status: 'translating',
      translatedUnitCount: 0,
      failedUnitCount: 0,
      totalUnitCount: 0,
      pageRevision: current.pageRevision + 1,
    });
    schedule(
      findCandidates(document, activeOptions.contentScope ?? 'main', selectors),
    );
  }

  function observeShadowRoots(
    scopes: Element[] = [document.documentElement],
  ): Element[] {
    const added: Element[] = [];
    const detached = [...observedRoots].filter(
      (root) => !root.host.isConnected,
    );
    if (detached.length > 0) {
      for (const root of detached) observedRoots.delete(root);
      for (const style of shadowStyles) {
        if (!style.isConnected) {
          style.remove();
          shadowStyles.delete(style);
        }
      }
      // MutationObserver cannot unobserve one root. Reconnect the live roots.
      observer?.disconnect();
      observer?.observe(document.documentElement, OBSERVATION_OPTIONS);
      for (const root of observedRoots)
        observer?.observe(root, OBSERVATION_OPTIONS);
    }
    for (const scope of scopes) {
      for (const root of accessibleRoots(scope)) {
        if (!(root instanceof ShadowRoot) || observedRoots.has(root)) continue;
        observedRoots.add(root);
        observer?.observe(root, OBSERVATION_OPTIONS);
        if (shadowStyle) {
          const style = document.createElement('style');
          style.dataset.lingoOwned = '';
          style.textContent = shadowStyle;
          root.append(style);
          shadowStyles.add(style);
        }
        added.push(root.host);
      }
    }
    return added;
  }

  function observePage() {
    observer = new MutationObserver((records) => {
      const changes = records.filter((record) => {
        const target =
          record.target instanceof Element
            ? record.target
            : record.target instanceof ShadowRoot
              ? record.target.host
              : record.target.parentElement;
        if (
          target &&
          composedClosest(
            target,
            `[${TRANSLATION_ATTRIBUTE}], [data-lingo-owned]`,
          )
        )
          return false;
        if (record.type === 'characterData' || record.type === 'attributes')
          return true;
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            !(
              node instanceof Element &&
              (node.hasAttribute(TRANSLATION_ATTRIBUTE) ||
                node.hasAttribute('data-lingo-owned'))
            ),
        );
      });
      if (changes.length === 0) return;
      for (const record of changes) {
        const target =
          record.target instanceof Element
            ? record.target
            : record.target instanceof ShadowRoot
              ? record.target.host
              : record.target.parentElement;
        if (
          target &&
          !composedClosest(
            target,
            `[${TRANSLATION_ATTRIBUTE}], [data-lingo-owned]`,
          )
        ) {
          mutationRoots.add(
            target.closest(CONTENT_CANDIDATE_SELECTOR) ?? target,
          );
          if (record.type === 'attributes' || record.type === 'childList')
            invalidatedRoots.add(target);
        }
      }
      if (mutationScheduled || !activeOptions) return;
      mutationScheduled = true;
      queueMicrotask(() => {
        mutationScheduled = false;
        const roots = [...mutationRoots];
        mutationRoots.clear();
        if (activeOptions) {
          observeShadowRoots(roots);
          refreshChangedContent(roots, [...invalidatedRoots]);
          invalidatedRoots.clear();
          schedule(
            findCandidates(
              document,
              activeOptions.contentScope ?? 'main',
              selectors,
              roots,
            ),
          );
        }
      });
    });
    observer.observe(document.documentElement, OBSERVATION_OPTIONS);
    observeShadowRoots();
    // attachShadow on an existing host emits no document mutation.
    shadowDiscoveryTimer = setInterval(() => {
      const added = observeShadowRoots();
      if (activeOptions && added.length > 0)
        schedule(
          findCandidates(
            document,
            activeOptions.contentScope ?? 'main',
            selectors,
            added,
          ),
        );
    }, 2000);
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
    if (watchNavigation) {
      restoreHistory = watchNavigation(handleNavigation);
    } else if (view) {
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
        const next = { ...activeOptions, ...options };
        if (
          !options.restart &&
          next.targetLanguage === activeOptions?.targetLanguage &&
          next.contentScope === activeOptions?.contentScope
        ) {
          return this.update({
            displayMode: options.displayMode,
            translateImmediately: options.translateImmediately,
          });
        }
        await this.stop();
        options = next;
      }
      activeOptions = options;
      pageUrl = document.location.href;
      sessionToken += 1;
      const token = sessionToken;
      publish({
        ...current,
        status: 'translating',
        displayMode: options.displayMode,
        failedUnitCount: 0,
        totalUnitCount: 0,
        failure: undefined,
      });
      if (getRuleSelectors) {
        try {
          const resolved = await getRuleSelectors();
          for (const group of Object.values(resolved)) {
            for (const selector of group) document.querySelector(selector);
          }
          if (token !== sessionToken || !activeOptions) return current;
          selectors = resolved;
        } catch {
          if (token !== sessionToken || !activeOptions) return current;
          return publish({
            ...current,
            status: 'failed',
            failure: {
              category: 'invalid-request',
              message: 'Could not load valid site rules.',
            },
          });
        }
      }
      observePage();
      const candidates = findCandidates(
        document,
        options.contentScope ?? 'main',
        selectors,
      );
      if (options.translateImmediately !== false || !intersectionObserver) {
        await translateElements(candidates);
      } else {
        schedule(candidates);
      }
      return current;
    },
    async update(patch) {
      if (
        activeOptions &&
        patch.retryFailed &&
        knownCandidates.size === 0 &&
        current.failure?.category === 'invalid-request'
      ) {
        const retryOptions = { ...activeOptions, ...patch };
        await this.stop();
        return this.start(retryOptions);
      }
      if (activeOptions) {
        activeOptions = { ...activeOptions, ...patch };
        if (patch.retryFailed) {
          const retry = [...failedElements].filter(
            (element) => element.isConnected,
          );
          failedElements.clear();
          for (const element of retry) processed.delete(element);
          publish({
            ...current,
            status: 'translating',
            failedUnitCount: 0,
            failure: undefined,
          });
          await translateElements(retry);
          if (!isGloballyPaused(current) && pausedVisibleElements.size > 0) {
            const visible = [...pausedVisibleElements];
            pausedVisibleElements.clear();
            await translateElements(visible);
          }
        }
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
      cancel?.();
      activeRequests.clear();
      mutationRoots.clear();
      invalidatedRoots.clear();
      observer?.disconnect();
      clearInterval(shadowDiscoveryTimer);
      observedRoots.clear();
      for (const style of shadowStyles) style.remove();
      shadowStyles.clear();
      intersectionObserver?.disconnect();
      observer = undefined;
      intersectionObserver = undefined;
      document.defaultView?.removeEventListener('popstate', handleNavigation);
      restoreHistory?.();
      restoreHistory = undefined;
      removeTranslations();
      pending.clear();
      failedElements.clear();
      pausedVisibleElements.clear();
      processed.clear();
      knownCandidates.clear();
      publish({
        status: 'idle',
        displayMode: 'bilingual',
        translatedUnitCount: 0,
        failedUnitCount: 0,
        totalUnitCount: 0,
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

function errorCategory(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    typeof error.category === 'string'
    ? error.category
    : 'unknown';
}

function isBlockingCategory(category: string): boolean {
  return ['authentication', 'quota', 'rate-limit'].includes(category);
}

function isGloballyPaused(snapshot: SessionSnapshot): boolean {
  return (
    snapshot.status === 'failed' &&
    snapshot.failure !== undefined &&
    isBlockingCategory(snapshot.failure.category)
  );
}

function findCandidates(
  document: Document,
  scope: ContentScope,
  selectors: RuleSelectors,
  changedRoots?: Element[],
): HTMLElement[] {
  const documentRoots = accessibleRoots(document);
  const roots = [
    ...(selectors.main ?? []),
    ...(scope === 'main-and-interface' ? (selectors.interface ?? []) : []),
  ].flatMap((selector) => [
    ...documentRoots.flatMap((root) => [
      ...root.querySelectorAll<HTMLElement>(selector),
    ]),
  ]);
  return [
    ...new Set([
      ...(changedRoots ?? [document.documentElement])
        .flatMap((scopeRoot) => accessibleRoots(scopeRoot))
        .flatMap((root) => [
          ...(root instanceof HTMLElement &&
          root.matches(CONTENT_CANDIDATE_SELECTOR)
            ? [root as HTMLElement]
            : []),
          ...root.querySelectorAll<HTMLElement>(CONTENT_CANDIDATE_SELECTOR),
        ]),
      ...roots.filter(
        (root) =>
          !changedRoots ||
          changedRoots.some(
            (changed) =>
              composedContains(changed, root) ||
              composedContains(root, changed),
          ),
      ),
    ]),
  ].filter(
    (element) =>
      !composedClosest(
        element,
        `[${TRANSLATION_ATTRIBUTE}], [data-lingo-owned]`,
      ) &&
      canTranslateContent(element) &&
      !(selectors.exclude ?? []).some(
        (selector) =>
          composedClosest(element, selector) || element.querySelector(selector),
      ) &&
      ((selectors.main?.length ?? 0) === 0 ||
        selectors.main?.some((selector) =>
          composedClosest(element, selector),
        ) ||
        (scope === 'main-and-interface' &&
          selectors.interface?.some((selector) =>
            composedClosest(element, selector),
          ))) &&
      (scope === 'main-and-interface' ||
        !composedClosest(element, INTERFACE_SELECTOR)) &&
      !element.querySelector(CONTENT_CANDIDATE_SELECTOR) &&
      ![element, ...element.querySelectorAll('*')].some(
        (child) => child.shadowRoot || child.tagName === 'SLOT',
      ) &&
      (roots.some((root) => composedContains(root, element)) ||
        isContentCandidate(element, scope)),
  );
}

function excludedByRules(
  element: HTMLElement,
  selectors: RuleSelectors,
): boolean {
  return (selectors.exclude ?? []).some(
    (selector) =>
      composedClosest(element, selector) || element.querySelector(selector),
  );
}

function canTranslateContent(element: HTMLElement): boolean {
  // A paragraph is sent as one unit. Keep mixed protected/public paragraphs
  // intact so textContent cannot carry private descendants into the request.
  return (
    !composedClosest(element, PROTECTED_SELECTOR) &&
    [...element.querySelectorAll(PROTECTED_SELECTOR)]
      .filter((child) => !composedClosest(child, `[${TRANSLATION_ATTRIBUTE}]`))
      .every((child) => child.tagName === 'CODE' && !child.closest('pre')) &&
    isComposedVisible(element) &&
    [...element.querySelectorAll<HTMLElement>('*')]
      .filter((child) => !composedClosest(child, `[${TRANSLATION_ATTRIBUTE}]`))
      .every(isComposedVisible)
  );
}

function isTableCell(element: HTMLElement): boolean {
  return element.tagName === 'TD' || element.tagName === 'TH';
}

function isContentCandidate(
  element: HTMLElement,
  scope: ContentScope,
): boolean {
  const text = element.textContent?.trim() ?? '';
  if (!text) return false;
  if (composedClosest(element, '[data-lingo-content="main"], article, main'))
    return true;
  if (composedClosest(element, INTERFACE_SELECTOR))
    return scope === 'main-and-interface';
  if (composedClosest(element, 'aside')) return false;
  const linkTextLength = [...element.querySelectorAll('a')].reduce(
    (length, link) => length + (link.textContent?.trim().length ?? 0),
    0,
  );
  return text.length >= 40 && linkTextLength / text.length < 0.5;
}

function encodeInlineContent(element: HTMLElement): {
  text: string;
  signature: string;
  inlineElements: Map<string, HTMLElement>;
  preservedElements: Map<string, HTMLElement>;
} {
  let nextMarker = 1;
  const inlineElements = new Map<string, HTMLElement>();
  const preservedElements = new Map<string, HTMLElement>();
  function encode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').replace(
        /⟦(?:\/?\d+|KEEP:\d+)⟧/g,
        (literal) => {
          const marker = String(nextMarker++);
          const span = element.ownerDocument.createElement('span');
          span.textContent = literal;
          preservedElements.set(marker, span);
          return `⟦KEEP:${marker}⟧`;
        },
      );
    }
    if (node instanceof Element && node.hasAttribute(TRANSLATION_ATTRIBUTE))
      return '';
    if (node instanceof HTMLElement && node.tagName === 'CODE') {
      const marker = String(nextMarker++);
      preservedElements.set(marker, node);
      return `⟦KEEP:${marker}⟧`;
    }
    if (!(node instanceof HTMLElement) || !INLINE_TAGS.has(node.tagName)) {
      return [...node.childNodes].map(encode).join('');
    }
    const marker = String(nextMarker++);
    inlineElements.set(marker, node);
    return `⟦${marker}⟧${[...node.childNodes].map(encode).join('')}⟦/${marker}⟧`;
  }
  const text = [...element.childNodes].map(encode).join('').trim();
  return {
    text,
    signature: JSON.stringify([
      text,
      [...preservedElements.values()].map((node) => node.outerHTML),
      [...inlineElements.values()].map((node) =>
        [...node.attributes]
          .filter((attribute) => !attribute.name.startsWith('data-lingo-'))
          .map((attribute) => [attribute.name, attribute.value]),
      ),
    ]),
    inlineElements,
    preservedElements,
  };
}

function renderTranslatedContent(
  target: HTMLElement,
  text: string,
  inlineElements: Map<string, HTMLElement>,
  preservedElements: Map<string, HTMLElement>,
) {
  const stack: Array<{ element: HTMLElement; marker?: string }> = [
    { element: target },
  ];
  const markerPattern = /⟦(?:(\/)?(\d+)|KEEP:(\d+))⟧/g;
  let cursor = 0;
  for (const match of text.matchAll(markerPattern)) {
    stack
      .at(-1)
      ?.element.append(
        target.ownerDocument.createTextNode(text.slice(cursor, match.index)),
      );
    const [, closing, marker, kept] = match;
    if (kept) {
      const source = preservedElements.get(kept);
      if (source) {
        const clone = source.cloneNode(true) as HTMLElement;
        for (const node of [clone, ...clone.querySelectorAll('*')]) {
          for (const attribute of [...node.attributes]) {
            if (attribute.name.startsWith('on') || attribute.name === 'id')
              node.removeAttribute(attribute.name);
          }
        }
        stack.at(-1)?.element.append(clone);
      }
    } else if (closing) {
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

function cloneTranslationShell(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(false) as HTMLElement;
  for (const attribute of [...clone.attributes]) {
    if (
      attribute.name === 'id' ||
      attribute.name === 'hidden' ||
      attribute.name === HIDDEN_ATTRIBUTE ||
      attribute.name === TRANSLATION_ATTRIBUTE ||
      attribute.name.startsWith('on')
    ) {
      clone.removeAttribute(attribute.name);
    }
  }
  return clone;
}

/** Used by explicitly triggered paragraph translation, with the same protection rules. */
export function readParagraph(element: Element) {
  const paragraph = composedClosest(element, CONTENT_CANDIDATE_SELECTOR);
  if (
    !(paragraph instanceof HTMLElement) ||
    !canTranslateContent(paragraph) ||
    paragraph.querySelector(CONTENT_CANDIDATE_SELECTOR) ||
    [paragraph, ...paragraph.querySelectorAll('*')].some(
      (child) => child.shadowRoot || child.tagName === 'SLOT',
    )
  )
    return;
  const encoded = encodeInlineContent(paragraph);
  if (!encoded.text) return;
  return {
    element: paragraph,
    text: encoded.text,
    render(target: HTMLElement, text: string) {
      renderTranslatedContent(
        target,
        text,
        encoded.inlineElements,
        encoded.preservedElements,
      );
    },
  };
}

export function captureReadableSelection(
  document: Document,
): { text: string; range: Range } | undefined {
  const selection = document.getSelection();
  if (selection?.rangeCount !== 1 || selection.isCollapsed) return;
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement)
    focused = focused.shadowRoot.activeElement;
  if (
    focused &&
    composedClosest(
      focused,
      'input, textarea, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return;
  let range: Range;
  if (typeof selection.getComposedRanges === 'function') {
    const roots = accessibleRoots(document).filter(
      (root): root is ShadowRoot => root instanceof ShadowRoot,
    );
    const composed = selection.getComposedRanges({ shadowRoots: roots })[0];
    if (
      !composed ||
      composed.startContainer.getRootNode() !==
        composed.endContainer.getRootNode()
    )
      return;
    range = document.createRange();
    range.setStart(composed.startContainer, composed.startOffset);
    range.setEnd(composed.endContainer, composed.endOffset);
  } else range = selection.getRangeAt(0).cloneRange();
  const root = range.startContainer.getRootNode();
  if (root instanceof ShadowRoot && root.mode !== 'open') return;
  const text = readableRange(range);
  if (!text || text !== selection.toString().trim()) return;
  return { text, range };
}

export function readableSelection(document: Document): string | undefined {
  return captureReadableSelection(document)?.text;
}

export function readableRange(range: Range): string | undefined {
  if (range.collapsed) return;
  const ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (
    !ancestor ||
    !isComposedVisible(ancestor as HTMLElement) ||
    composedClosest(ancestor, `${PROTECTED_SELECTOR}, [data-lingo-translation]`)
  )
    return;
  for (const child of ancestor.querySelectorAll<HTMLElement>('*')) {
    if (
      range.intersectsNode(child) &&
      (!isComposedVisible(child) || child.shadowRoot)
    )
      return;
  }
  const fragment = range.cloneContents();
  if (fragment.querySelector(`${PROTECTED_SELECTOR}, [data-lingo-translation]`))
    return;
  const text = range.toString().trim();
  return text || undefined;
}
