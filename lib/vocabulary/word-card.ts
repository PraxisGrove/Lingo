import type { TranslationClientResult } from '../page-translation/page-translation';
import type { ExtensionSettings } from '../storage/settings-model';
import type { TranslationUnit } from '../translation/types';
import type { HighlightedWord, Highlighter } from './highlighter';
import { contextSnippet } from './vocabulary-model';

type Translate = (
  units: TranslationUnit[],
  targetLanguage: string,
  onProgress?: undefined,
  options?: { sourceLanguage?: string },
) => Promise<TranslationClientResult>;

export type WordCardDependencies = {
  document: Document;
  highlighter: Highlighter;
  translate: Translate;
  t(key: WordCardMessage, options?: Record<string, unknown>): string;
  markKnown(lemma: string): Promise<void>;
  save(entry: { word: string; gloss: string; context: string }): Promise<void>;
};

export type WordCardMessage =
  | 'vocabulary.card.known'
  | 'vocabulary.card.save'
  | 'vocabulary.card.saved'
  | 'vocabulary.card.inContext'
  | 'vocabulary.card.loading'
  | 'vocabulary.card.failed'
  | 'vocabulary.card.label';

const HOVER_DELAY_MS = 220;
const MAX_GLOSS_LENGTH = 60;

/**
 * Hover card for highlighted words. Glosses are requested only when the reader
 * dwells on a word, so page vocabulary is not sent anywhere unprompted.
 */
export function createWordCard(dependencies: WordCardDependencies) {
  const { document, highlighter, t } = dependencies;
  const view = document.defaultView;
  const host = document.createElement('div');
  host.dataset.lingoOwned = 'vocabulary-card';
  host.setAttribute('translate', 'no');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CARD_CSS;
  const card = document.createElement('section');
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  const word = document.createElement('strong');
  const gloss = document.createElement('p');
  const context = document.createElement('p');
  context.className = 'context';
  const actions = document.createElement('div');
  const inContext = button('vocabulary.card.inContext', () => void explain());
  const known = button('vocabulary.card.known', () => void markKnown());
  const save = button('vocabulary.card.save', () => void saveWord());
  actions.append(inContext, save, known);
  card.append(word, gloss, context, actions);
  root.append(style, card);

  const glosses = new Map<string, Promise<string>>();
  let targetLanguage = 'zh-CN';
  let current: HighlightedWord | undefined;
  let hoverTimer: number | undefined;
  let pointer = { x: 0, y: 0 };
  let token = 0;

  function button(key: WordCardMessage, click: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.dataset.key = key;
    element.textContent = t(key);
    element.addEventListener('click', click);
    return element;
  }

  async function translateOne(text: string): Promise<string> {
    const result = await dependencies.translate(
      [{ id: 'vocabulary', number: 1, text }],
      targetLanguage,
      undefined,
      { sourceLanguage: 'en' },
    );
    const translations = Array.isArray(result) ? result : result.translations;
    const translated = translations[0]?.text?.trim();
    if (!translated) throw new Error('No gloss returned.');
    return translated;
  }

  function lookup(lemma: string): Promise<string> {
    const key = `${targetLanguage}\u0000${lemma}`;
    let pending = glosses.get(key);
    if (!pending) {
      pending = translateOne(lemma).then((text) =>
        text.slice(0, MAX_GLOSS_LENGTH),
      );
      glosses.set(key, pending);
      pending.catch(() => glosses.delete(key));
    }
    return pending;
  }

  function position(entry: HighlightedWord) {
    const rect = entry.range.getBoundingClientRect();
    const width = view?.innerWidth ?? 800;
    const height = view?.innerHeight ?? 600;
    card.style.left = `${Math.max(8, Math.min(rect.left, width - 296))}px`;
    const below = rect.bottom + 8;
    card.style.top =
      below + 140 < height
        ? `${below}px`
        : `${Math.max(8, rect.top - 8 - card.offsetHeight)}px`;
  }

  async function show(entry: HighlightedWord) {
    const request = ++token;
    current = entry;
    if (!host.isConnected) document.documentElement.append(host);
    word.textContent =
      entry.lemma === entry.word
        ? entry.word
        : `${entry.word} · ${entry.lemma}`;
    gloss.textContent = t('vocabulary.card.loading');
    context.hidden = true;
    context.textContent = '';
    save.disabled = false;
    save.textContent = t('vocabulary.card.save');
    card.setAttribute('aria-label', t('vocabulary.card.label'));
    card.hidden = false;
    position(entry);
    try {
      const text = await lookup(entry.lemma);
      if (request === token) gloss.textContent = text;
    } catch {
      if (request === token) gloss.textContent = t('vocabulary.card.failed');
    }
    if (request === token) position(entry);
  }

  async function explain() {
    const entry = current;
    if (!entry) return;
    const request = token;
    const sentence = sentenceAround(entry);
    context.hidden = false;
    context.textContent = t('vocabulary.card.loading');
    try {
      const translated = await translateOne(sentence);
      if (request === token) context.textContent = translated;
    } catch {
      if (request === token) context.textContent = t('vocabulary.card.failed');
    }
  }

  async function markKnown() {
    const entry = current;
    if (!entry) return;
    hide();
    await dependencies.markKnown(entry.lemma);
  }

  async function saveWord() {
    const entry = current;
    if (!entry) return;
    const glossText = await lookup(entry.lemma).catch(() => '');
    await dependencies.save({
      word: entry.lemma,
      gloss: glossText,
      context: contextSnippet(entry.block.textContent ?? '', entry.word),
    });
    if (current === entry) {
      save.disabled = true;
      save.textContent = t('vocabulary.card.saved');
    }
  }

  function hide() {
    token += 1;
    current = undefined;
    card.hidden = true;
  }

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    if (event.composedPath().includes(host)) {
      if (hoverTimer !== undefined) view?.clearTimeout(hoverTimer);
      hoverTimer = undefined;
      return;
    }
    if (hoverTimer !== undefined) view?.clearTimeout(hoverTimer);
    hoverTimer = view?.setTimeout(() => {
      hoverTimer = undefined;
      const entry = highlighter.wordAt(pointer.x, pointer.y);
      if (entry && entry !== current) void show(entry);
      else if (!entry && current && !card.matches(':hover')) hide();
    }, HOVER_DELAY_MS);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && current) hide();
  };
  const onScroll = () => {
    if (current) hide();
  };

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('keydown', onKey);
  view?.addEventListener('scroll', onScroll, { passive: true });

  return {
    update(settings: Pick<ExtensionSettings, 'targetLanguage' | 'theme'>) {
      if (settings.targetLanguage !== targetLanguage) glosses.clear();
      targetLanguage = settings.targetLanguage;
      host.dataset.theme = settings.theme;
      for (const element of actions.querySelectorAll('button'))
        element.textContent = t(element.dataset.key as WordCardMessage);
    },
    hide,
    /** Close the card when its word is no longer highlighted. */
    sync() {
      if (current && !current.text.isConnected) hide();
    },
    dispose() {
      hide();
      if (hoverTimer !== undefined) view?.clearTimeout(hoverTimer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('keydown', onKey);
      view?.removeEventListener('scroll', onScroll);
      host.remove();
    },
  };
}

export function sentenceAround(entry: HighlightedWord): string {
  const text = (entry.block.textContent ?? '').replace(/\s+/g, ' ');
  const index = text.toLowerCase().indexOf(entry.word);
  if (index < 0) return contextSnippet(text, entry.word);
  const start = Math.max(
    0,
    ...['. ', '! ', '? '].map((mark) => {
      const found = text.lastIndexOf(mark, index);
      return found < 0 ? 0 : found + 2;
    }),
  );
  const ends = ['. ', '! ', '? ']
    .map((mark) => text.indexOf(mark, index))
    .filter((found) => found >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return contextSnippet(text.slice(start, end), entry.word);
}

const CARD_CSS = `
  :host {
    all: initial;
    --surface: #fff;
    --text: #171a17;
    --muted: #70756a;
    --border: #e0e3d8;
    --button: #ebede5;
    font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  :host([data-theme="dark"]) {
    --surface: #20251f; --text: #f4f4ef; --muted: #a6afa0; --border: #363e32; --button: #2b3128;
  }
  @media (prefers-color-scheme: dark) {
    :host([data-theme="system"]) {
      --surface: #20251f; --text: #f4f4ef; --muted: #a6afa0; --border: #363e32; --button: #2b3128;
    }
  }
  [hidden] { display: none !important; }
  section {
    position: fixed;
    z-index: 2147483100;
    width: 280px;
    padding: 12px 14px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 40px #171a1726;
  }
  strong { display: block; font-size: 15px; }
  p { margin: 4px 0 0; overflow-wrap: anywhere; }
  .context { color: var(--muted); font-size: 12px; }
  div { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  button {
    font: inherit;
    font-size: 12px;
    color: var(--text);
    background: var(--button);
    border: 0;
    border-radius: 6px;
    padding: 4px 9px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  button:focus-visible { outline: 2px solid #9ab400; outline-offset: 2px; }
`;
