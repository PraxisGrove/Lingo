import { afterEach, describe, expect, it, vi } from 'vitest';
import pageTranslationCss from '../../entrypoints/page-translation.css?raw';
import { createPageTranslation } from '../../lib/page-translation/page-translation';
import {
  createHighlighter,
  HIGHLIGHT_NAME,
  supportsHighlights,
} from '../../lib/vocabulary/highlighter';
import { createRankService } from '../../lib/vocabulary/rank-service';
import { sentenceAround } from '../../lib/vocabulary/word-card';
import enRanks from '../../public/vocabulary/en-ranks.txt?raw';

const ARTICLE = `<main>
  <p id="story">The sailors were tired after the long voyage. When the captain
  ignored their complaints, a mutiny began below the deck, and his nephews
  joined the rebellion before dawn. Everyone on the ship heard the noise.</p>
  <p>Readers can find the whole story in the library, where the old books are
  kept for anyone who wants to read about the sea and the people who sailed it.</p>
  <pre>mutiny rebellion</pre>
  <nav>mutiny</nav>
</main>`;

const classify = createRankService(async () => enRanks);
let cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

function highlighted(): string[] {
  const registry = (CSS as typeof CSS & { highlights: HighlightRegistry })
    .highlights;
  const highlight = registry.get(HIGHLIGHT_NAME);
  return highlight
    ? [...highlight].map((range) => range.toString().toLowerCase()).sort()
    : [];
}

function start(vocabularySize = 5000, known = new Set<string>()) {
  const highlighter = createHighlighter({
    document,
    classify,
    isHard: (word) => word.rank > vocabularySize && !known.has(word.lemma),
  });
  highlighter.start();
  cleanup.push(() => highlighter.stop());
  return highlighter;
}

describe('vocabulary highlighting', () => {
  it('marks only rare words in readable English text without changing the page', async () => {
    if (!supportsHighlights(window)) return;
    document.documentElement.lang = 'en';
    document.body.innerHTML = ARTICLE;
    const before = document.body.innerHTML;
    start();
    await vi.waitFor(() => expect(highlighted()).toContain('mutiny'));
    expect(highlighted()).toContain('nephews');
    expect(highlighted()).not.toContain('the');
    expect(highlighted()).not.toContain('library');
    // Code and navigation are protected; their copies stay unmarked.
    expect(highlighted().filter((word) => word === 'mutiny')).toHaveLength(1);
    expect(document.body.innerHTML).toBe(before);
  });

  it('does not highlight pages declared in another language', async () => {
    if (!supportsHighlights(window)) return;
    document.documentElement.lang = 'fr';
    document.body.innerHTML = ARTICLE;
    start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(highlighted()).toEqual([]);
  });

  it('finds the hovered word from screen coordinates', async () => {
    if (!supportsHighlights(window)) return;
    document.documentElement.lang = 'en';
    document.body.innerHTML = ARTICLE;
    const highlighter = start();
    await vi.waitFor(() => expect(highlighted()).toContain('mutiny'));
    const story = document.getElementById('story')?.firstChild as Text;
    const index = story.data.indexOf('mutiny');
    const range = document.createRange();
    range.setStart(story, index + 2);
    range.setEnd(story, index + 3);
    const rect = range.getBoundingClientRect();
    const entry = highlighter.wordAt(rect.left + 1, rect.top + rect.height / 2);
    if (!entry) throw new Error('Missing hovered word.');
    expect(entry.word).toBe('mutiny');
    expect(sentenceAround(entry)).toMatch(
      /^When the captain ignored .*dawn\.$/,
    );
    expect(highlighter.wordAt(1, 1)).toBeUndefined();
  });

  it('coexists with page translation without extra requests or marking translations', async () => {
    if (!supportsHighlights(window)) return;
    const style = document.createElement('style');
    style.textContent = pageTranslationCss;
    document.head.append(style);
    cleanup.push(() => style.remove());
    document.documentElement.lang = 'en';
    document.body.innerHTML = ARTICLE;
    const requests: string[] = [];
    const session = createPageTranslation({
      document,
      async translate(units) {
        requests.push(...units.map((unit) => unit.text));
        return units.map((unit) => ({
          ...unit,
          text: `译文 mutiny ${unit.number}`,
        }));
      },
    });
    cleanup.push(() => session.stop());
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    const requestCount = requests.length;
    const highlighter = start();
    await vi.waitFor(() => expect(highlighted()).toContain('mutiny'));
    // Only the original paragraph's word is marked, not the translation's.
    expect(highlighted().filter((word) => word === 'mutiny')).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(requests).toHaveLength(requestCount);
    await session.update({ displayMode: 'translation' });
    highlighter.refresh();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(highlighted()).toEqual([]);
  });

  it('removes a word once the reader knows it', async () => {
    if (!supportsHighlights(window)) return;
    document.documentElement.lang = 'en';
    document.body.innerHTML = ARTICLE;
    const known = new Set<string>();
    const highlighter = start(5000, known);
    await vi.waitFor(() => expect(highlighted()).toContain('nephews'));
    known.add('nephew');
    highlighter.refresh();
    await vi.waitFor(() => expect(highlighted()).toContain('mutiny'));
    expect(highlighted()).not.toContain('nephews');
  });
});
