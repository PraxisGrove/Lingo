import {
  accessibleRoots,
  composedClosest,
  isComposedVisible,
} from '../page-translation/composed-dom';
import {
  INTERFACE_SELECTOR,
  PROTECTED_SELECTOR,
} from '../page-translation/page-translation';
import type { RuleSelectors } from '../rules/rule-resolver';
import type { RankedWord } from './word-ranks';
import { tokenize } from './word-ranks';

export const HIGHLIGHT_NAME = 'lingo-word';
const BLOCK_SELECTOR =
  'p, li, blockquote, figcaption, dd, dt, td, th, h1, h2, h3, h4, h5, h6';
const SKIP_SELECTOR = `${PROTECTED_SELECTOR}, [data-lingo-translation], [data-lingo-hidden], [data-lingo-cell-original-hidden], a[href] img`;
const MAX_RANGES = 1500;
const MIN_ENGLISH_RATIO = 0.6;
const MIN_SAMPLE_TOKENS = 40;

export type HighlightedWord = {
  range: Range;
  word: string;
  lemma: string;
  text: Text;
  block: Element;
};

export type HighlighterOptions = {
  document: Document;
  classify(words: string[]): Promise<Record<string, RankedWord | null>>;
  getRuleSelectors?: () => Promise<RuleSelectors>;
  isHard(word: RankedWord): boolean;
  /** Called after highlights change so cards can close stale targets. */
  onChange?: () => void;
};

export type Highlighter = {
  start(): void;
  stop(): void;
  refresh(): void;
  wordAt(x: number, y: number): HighlightedWord | undefined;
  isActive(): boolean;
};

type HighlightWindow = Window &
  typeof globalThis & {
    CSS: typeof CSS & { highlights?: HighlightRegistry };
  };

export function supportsHighlights(view: Window | null): boolean {
  const scope = view as HighlightWindow | null;
  return Boolean(scope?.CSS?.highlights && 'Highlight' in scope);
}

/**
 * Marks rare English words with the CSS Custom Highlight API. The page DOM is
 * never changed, so page translation, selections, and restoration behave as
 * if Lingo's vocabulary layer were absent.
 */
export function createHighlighter(options: HighlighterOptions): Highlighter {
  const { document } = options;
  const view = document.defaultView as HighlightWindow | null;
  const ranks = new Map<string, RankedWord | null>();
  const byText = new WeakMap<Text, HighlightedWord[]>();
  let scanned = new WeakSet<Element>();
  const pending = new Set<Element>();
  const styledRoots = new WeakSet<Document | ShadowRoot>();
  let words: HighlightedWord[] = [];
  let highlight: Highlight | undefined;
  let intersection: IntersectionObserver | undefined;
  let mutation: MutationObserver | undefined;
  let selectors: RuleSelectors = {};
  let running = false;
  let english: boolean | undefined;
  let flushTimer: number | undefined;
  let generation = 0;

  function selector(list: string[] | undefined) {
    return list?.filter(Boolean).join(', ') || '';
  }

  function eligibleBlock(block: Element): boolean {
    const exclude = selector(selectors.exclude);
    const interfaceSelector = [
      INTERFACE_SELECTOR,
      selector(selectors.interface),
    ]
      .filter(Boolean)
      .join(', ');
    const main = selector(selectors.main);
    if (composedClosest(block, SKIP_SELECTOR)) return false;
    if (exclude && composedClosest(block, exclude)) return false;
    if (
      composedClosest(block, interfaceSelector) &&
      !(main && composedClosest(block, main))
    )
      return false;
    return isComposedVisible(block);
  }

  function textNodes(block: Element): Text[] {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        if (parent !== block && parent.closest(BLOCK_SELECTOR) !== block)
          return NodeFilter.FILTER_REJECT;
        return composedClosest(parent, SKIP_SELECTOR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    return nodes;
  }

  // ::highlight rules do not cross shadow boundaries, so each root gets one.
  function ensureStyles(root: Document | ShadowRoot) {
    if (styledRoots.has(root)) return;
    styledRoots.add(root);
    const style = document.createElement('style');
    style.dataset.lingoOwned = 'vocabulary-style';
    style.textContent = HIGHLIGHT_CSS;
    if (root instanceof ShadowRoot) root.append(style);
    else (root.head ?? root.documentElement).append(style);
  }

  async function detectEnglish(): Promise<boolean> {
    const lang = document.documentElement.lang.toLowerCase();
    if (lang && !lang.startsWith('en')) return false;
    const sample = (document.body?.innerText ?? '').slice(0, 20_000);
    const tokens = [...new Set(tokenize(sample).map((token) => token.word))];
    if (tokens.length < MIN_SAMPLE_TOKENS) return lang.startsWith('en');
    await classifyMissing(tokens.slice(0, 600));
    const sampled = tokens.slice(0, 600);
    const listed = sampled.filter((word) => ranks.get(word)).length;
    return listed / sampled.length >= MIN_ENGLISH_RATIO;
  }

  async function classifyMissing(list: string[]) {
    const missing = [...new Set(list)].filter((word) => !ranks.has(word));
    for (let index = 0; index < missing.length; index += 1000) {
      const result = await options.classify(missing.slice(index, index + 1000));
      for (const word of missing.slice(index, index + 1000))
        ranks.set(word, result[word] ?? null);
    }
  }

  function scheduleFlush() {
    if (flushTimer !== undefined || !view) return;
    const run = () => {
      flushTimer = undefined;
      void flush();
    };
    flushTimer =
      typeof view.requestIdleCallback === 'function'
        ? view.requestIdleCallback(run, { timeout: 400 })
        : view.setTimeout(run, 50);
  }

  async function flush() {
    const current = generation;
    const blocks = [...pending].filter((block) => block.isConnected);
    pending.clear();
    if (blocks.length === 0) return;
    const prepared = blocks.filter(eligibleBlock).map((block) => ({
      block,
      nodes: textNodes(block).map((text, index) => ({
        text,
        tokens: tokenize(
          text.data,
          index === 0 ||
            /[.!?]\s*$/.test(text.previousSibling?.textContent ?? ''),
        ),
      })),
    }));
    await classifyMissing(
      prepared.flatMap((item) =>
        item.nodes.flatMap((node) => node.tokens.map((token) => token.word)),
      ),
    );
    if (current !== generation || !running) return;
    for (const { block, nodes } of prepared) {
      scanned.add(block);
      for (const { text, tokens } of nodes) {
        const entries: HighlightedWord[] = [];
        for (const token of tokens) {
          const ranked = ranks.get(token.word);
          if (!ranked || !options.isHard(ranked)) continue;
          if (words.length + entries.length >= MAX_RANGES) break;
          const range = document.createRange();
          range.setStart(text, token.start);
          range.setEnd(text, token.end);
          entries.push({
            range,
            word: token.word,
            lemma: ranked.lemma,
            text,
            block,
          });
        }
        if (entries.length === 0) continue;
        const root = text.getRootNode();
        if (root instanceof ShadowRoot) ensureStyles(root);
        byText.set(text, entries);
        words.push(...entries);
        for (const entry of entries) highlight?.add(entry.range);
      }
    }
    options.onChange?.();
  }

  function observeBlocks(root: Document | ShadowRoot | Element) {
    for (const scope of accessibleRoots(root)) {
      const blocks =
        scope instanceof Element
          ? [
              ...(scope.matches(BLOCK_SELECTOR) ? [scope] : []),
              ...scope.querySelectorAll(BLOCK_SELECTOR),
            ]
          : [...scope.querySelectorAll(BLOCK_SELECTOR)];
      for (const block of blocks) intersection?.observe(block);
    }
  }

  function removeBlock(block: Element) {
    const kept: HighlightedWord[] = [];
    for (const entry of words) {
      if (entry.block === block) highlight?.delete(entry.range);
      else kept.push(entry);
    }
    words = kept;
    scanned.delete(block);
  }

  function rescan(block: Element) {
    removeBlock(block);
    pending.add(block);
    scheduleFlush();
  }

  function clear() {
    generation += 1;
    highlight?.clear();
    words = [];
    scanned = new WeakSet();
    pending.clear();
    intersection?.disconnect();
    mutation?.disconnect();
    if (flushTimer !== undefined && view) {
      if (typeof view.cancelIdleCallback === 'function')
        view.cancelIdleCallback(flushTimer);
      view.clearTimeout(flushTimer);
    }
    flushTimer = undefined;
  }

  async function begin() {
    const current = generation;
    selectors = (await options.getRuleSelectors?.().catch(() => ({}))) ?? {};
    english ??= await detectEnglish().catch(() => false);
    if (current !== generation || !running || !english || !view) return;
    highlight = new view.Highlight();
    view.CSS.highlights?.set(HIGHLIGHT_NAME, highlight);
    ensureStyles(document);
    intersection = new view.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || scanned.has(entry.target)) continue;
          pending.add(entry.target);
        }
        scheduleFlush();
      },
      { rootMargin: '100% 0px' },
    );
    observeBlocks(document);
    mutation = new view.MutationObserver((records) => {
      const changed = new Set<Element>();
      for (const record of records) {
        const target =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        if (!target || composedClosest(target, '[data-lingo-owned]')) continue;
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (
              node instanceof Element &&
              !node.hasAttribute('data-lingo-owned') &&
              !node.hasAttribute('data-lingo-translation')
            )
              observeBlocks(node);
          }
        }
        const block = target.closest(BLOCK_SELECTOR);
        if (block && scanned.has(block)) changed.add(block);
      }
      for (const block of changed) rescan(block);
      // Ranges collapse when their text is removed; drop them lazily.
      words = words.filter((entry) => {
        if (entry.text.isConnected) return true;
        highlight?.delete(entry.range);
        return false;
      });
    });
    mutation.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  return {
    start() {
      if (running || !supportsHighlights(view)) return;
      running = true;
      void begin();
    },
    stop() {
      if (!running) return;
      running = false;
      clear();
      view?.CSS.highlights?.delete(HIGHLIGHT_NAME);
      options.onChange?.();
    },
    refresh() {
      if (!running) return;
      clear();
      english = undefined;
      void begin();
    },
    wordAt(x, y) {
      if (!running || words.length === 0) return undefined;
      const caret = caretAt(document, x, y);
      if (!caret) return undefined;
      const entries = byText.get(caret.node as Text);
      const entry = entries?.find(
        (item) =>
          words.includes(item) &&
          item.range.startOffset <= caret.offset &&
          caret.offset <= item.range.endOffset,
      );
      if (!entry) return undefined;
      for (const rect of entry.range.getClientRects())
        if (
          x >= rect.left - 1 &&
          x <= rect.right + 1 &&
          y >= rect.top - 1 &&
          y <= rect.bottom + 1
        )
          return entry;
      return undefined;
    },
    isActive: () => running && words.length > 0,
  };
}

function caretAt(
  document: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | undefined {
  const withPosition = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
      options?: { shadowRoots?: ShadowRoot[] },
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (withPosition.caretPositionFromPoint) {
    const position = withPosition.caretPositionFromPoint(x, y);
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : undefined;
  }
  const range = withPosition.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : undefined;
}

const HIGHLIGHT_CSS = `
::highlight(${HIGHLIGHT_NAME}) {
  text-decoration: underline dotted 2px;
  text-decoration-color: #9ab400;
  text-underline-offset: 3px;
}
@media (prefers-color-scheme: dark) {
  ::highlight(${HIGHLIGHT_NAME}) { text-decoration-color: #dfff45; }
}
@media (forced-colors: active) {
  ::highlight(${HIGHLIGHT_NAME}) { text-decoration-color: Highlight; }
}
`;
