// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger/logger';
import {
  createPageTranslation as createPageTranslationImplementation,
  type PageTranslation,
} from './page-translation';

const sessions: PageTranslation[] = [];
const pageTranslationCss = readFileSync(
  'entrypoints/page-translation.css',
  'utf8',
);
const contentTypesFixture = readFileSync(
  'lib/page-translation/fixtures/content-types.html',
  'utf8',
);
const createPageTranslation: typeof createPageTranslationImplementation = (
  dependencies,
) => {
  const session = createPageTranslationImplementation(dependencies);
  sessions.push(session);
  return session;
};

describe('PageTranslation', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <article>
        <p>Hello world.</p>
        <p>This is a static article paragraph.</p>
      </article>
    `;
  });

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.stop()));
  });

  it('inserts translated paragraphs after ordinary article paragraphs', async () => {
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) =>
        units.map((unit) => ({ ...unit, text: `Chinese: ${unit.text}` })),
    });

    const snapshot = await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });

    expect(snapshot).toMatchObject({
      status: 'translated',
      displayMode: 'bilingual',
      translatedUnitCount: 2,
    });
    expect(
      [...document.querySelectorAll('[data-lingo-translation]')].map(
        (element) => element.textContent,
      ),
    ).toEqual([
      'Chinese: Hello world.',
      'Chinese: This is a static article paragraph.',
    ]);
  });

  it('translates article headings and restores the original document', async () => {
    document.body.innerHTML = contentTypesFixture;
    const originalMarkup = document.body.innerHTML;
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) =>
        units.map((unit) => ({ ...unit, text: `Translated: ${unit.text}` })),
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    expect(
      document.querySelector('h1 + [data-lingo-translation]')?.textContent,
    ).toBe('Translated: Understanding bilingual reading');
    await pageTranslation.stop();
    expect(document.body.innerHTML).toBe(originalMarkup);
  });

  it('translates figure captions without moving them out of the figure', async () => {
    document.body.innerHTML = contentTypesFixture;
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) =>
        units.map((unit) => ({ ...unit, text: `Translated: ${unit.text}` })),
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    const translation = document.querySelector(
      'figure > figcaption + figcaption[data-lingo-translation]',
    );
    expect(translation?.textContent).toBe(
      'Translated: A concise figure caption.',
    );
  });

  it('translates table cells without adding rows or columns', async () => {
    document.head.innerHTML = `<style>${pageTranslationCss}</style>`;
    document.body.innerHTML = contentTypesFixture;
    const originalMarkup = document.body.innerHTML;
    const firstCell = document.querySelector<HTMLTableCellElement>('td');
    const originalTextNode = firstCell?.firstChild;
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) =>
        units.map((unit) => ({ ...unit, text: `Translated: ${unit.text}` })),
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    const rows = [...document.querySelectorAll('tr')];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.cells.length)).toEqual([2, 2]);
    expect(
      document.querySelector('th > [data-lingo-translation]')?.textContent,
    ).toBe('Translated: Language');
    expect(
      document.querySelector('td > [data-lingo-translation]')?.textContent,
    ).toBe('Translated: English');
    expect(originalTextNode?.parentElement).toBe(firstCell);

    await pageTranslation.update({ displayMode: 'translation' });
    expect(firstCell?.hasAttribute('data-lingo-cell-original-hidden')).toBe(
      true,
    );

    await pageTranslation.stop();
    expect(originalTextNode?.parentElement).toBe(firstCell);
    expect(document.body.innerHTML).toBe(originalMarkup);
  });

  it('translates nested table paragraphs only once', async () => {
    document.body.innerHTML = `
      <main><table><tbody><tr><td><p>Nested cell paragraph.</p></td></tr></tbody></table></main>
    `;
    const translatedTexts: string[] = [];
    const pageTranslation = createPageTranslation({
      document,
      async translate(units) {
        translatedTexts.push(...units.map((unit) => unit.text));
        return units;
      },
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    expect(translatedTexts).toEqual(['Nested cell paragraph.']);
    expect(
      document.querySelectorAll('td [data-lingo-translation]'),
    ).toHaveLength(1);
    expect(document.querySelector('tr')?.children).toHaveLength(1);
  });

  it('counts all queued paragraphs before they enter the viewport', async () => {
    class PendingIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', PendingIntersectionObserver);
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) => units,
    });

    const snapshot = await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: false,
    });

    expect(snapshot).toMatchObject({
      status: 'translating',
      translatedUnitCount: 0,
      totalUnitCount: 2,
    });
    vi.unstubAllGlobals();
  });

  it('pauses newly visible paragraphs after a global provider failure', async () => {
    let callback: IntersectionObserverCallback = () => undefined;
    class ControlledIntersectionObserver {
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
    const translate = vi.fn(async () => {
      throw Object.assign(new Error('Provider balance exhausted.'), {
        category: 'quota',
      });
    });
    const pageTranslation = createPageTranslation({ document, translate });
    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: false,
    });
    const paragraphs = [...document.querySelectorAll('p')];

    callback(
      [
        {
          isIntersecting: true,
          target: paragraphs[0],
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(pageTranslation.snapshot()).toMatchObject({ status: 'failed' });
    expect(translate).toHaveBeenCalledTimes(1);

    callback(
      [
        {
          isIntersecting: true,
          target: paragraphs[1],
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
    await Promise.resolve();
    expect(translate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('keeps original content and exposes a categorized translation failure', async () => {
    const logger = mockLogger();
    const pageTranslation = createPageTranslation({
      document,
      logger,
      translate: async () => {
        throw Object.assign(
          new Error('The provider balance is insufficient.'),
          {
            category: 'quota',
          },
        );
      },
    });

    const snapshot = await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });

    expect(snapshot).toMatchObject({
      status: 'failed',
      failure: {
        category: 'quota',
        message: 'The provider balance is insufficient.',
      },
    });
    expect(document.querySelector('[data-lingo-translation]')).toBeNull();
    expect(document.querySelector('article')?.textContent).toContain(
      'Hello world.',
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Page translation request failed.',
      expect.objectContaining({
        category: 'quota',
        pageRevision: 0,
        unitCount: 2,
      }),
    );
  });

  it('keeps partial results and retries only failed paragraphs', async () => {
    let attempt = 0;
    const translatedBatches: string[][] = [];
    const logger = mockLogger();
    const pageTranslation = createPageTranslation({
      document,
      logger,
      async translate(units) {
        translatedBatches.push(units.map((unit) => unit.id));
        attempt += 1;
        if (attempt === 1) {
          return {
            translations: [{ ...units[0], text: `Chinese: ${units[0].text}` }],
            failures: [
              {
                unitId: units[1].id,
                category: 'invalid-response',
                message: 'This paragraph was missing.',
              },
            ],
          };
        }
        return units.map((unit) => ({
          ...unit,
          text: `Chinese: ${unit.text}`,
        }));
      },
    });

    const partial = await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });
    expect(partial).toMatchObject({
      status: 'translated',
      translatedUnitCount: 1,
      failedUnitCount: 1,
      totalUnitCount: 2,
    });

    const complete = await pageTranslation.update({
      displayMode: 'bilingual',
      retryFailed: true,
    });
    expect(complete).toMatchObject({
      translatedUnitCount: 2,
      failedUnitCount: 0,
      totalUnitCount: 2,
    });
    expect(translatedBatches[1]).toEqual([translatedBatches[0][1]]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Page translation completed with missing results.',
      expect.objectContaining({
        failedUnitCount: 1,
        pageRevision: 0,
        requestedUnitCount: 2,
        translatedUnitCount: 1,
      }),
    );
  });

  it('restores the original page without removing page-owned changes', async () => {
    const originalMarkup = document.body.innerHTML;
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) => units,
    });
    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });
    const pageOwnedNode = document.createElement('aside');
    pageOwnedNode.textContent = 'Added by the page';
    document.body.append(pageOwnedNode);

    await pageTranslation.stop();

    expect(document.querySelector('[data-lingo-translation]')).toBeNull();
    expect(document.querySelector('article')?.outerHTML).toBe(
      document
        .createRange()
        .createContextualFragment(originalMarkup)
        .querySelector('article')?.outerHTML,
    );
    expect(pageOwnedNode.isConnected).toBe(true);
  });

  it('can start again after stopping without duplicating translations', async () => {
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) => units,
    });
    const options = {
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual' as const,
      translateImmediately: true,
    };

    await pageTranslation.start(options);
    await pageTranslation.stop();
    await pageTranslation.start(options);

    expect(document.querySelectorAll('[data-lingo-translation]')).toHaveLength(
      2,
    );
  });

  it('preserves stable unit ids and page-owned Lingo-like attributes', async () => {
    const originalParagraph = document.querySelector('article p');
    const pageOwnedTranslation = document.createElement('p');
    pageOwnedTranslation.dataset.lingoTranslation = 'page-owned';
    pageOwnedTranslation.textContent = 'Page-owned marker';
    document.body.append(pageOwnedTranslation);
    const translatedUnits: Array<{ id: string; text: string }> = [];
    const pageTranslation = createPageTranslation({
      document,
      async translate(units) {
        translatedUnits.push(...units);
        return units;
      },
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });
    await pageTranslation.stop();
    const insertedParagraph = document.createElement('p');
    insertedParagraph.textContent = 'Inserted later.';
    originalParagraph?.before(insertedParagraph);
    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });
    await pageTranslation.stop();

    const originalIds = translatedUnits
      .filter((unit) => unit.text === 'Hello world.')
      .map((unit) => unit.id);
    expect(originalIds).toEqual([originalIds[0], originalIds[0]]);
    expect(pageOwnedTranslation.isConnected).toBe(true);
    expect(pageOwnedTranslation.dataset.lingoTranslation).toBe('page-owned');
  });

  it('does not translate protected or hidden paragraphs', async () => {
    document.body.innerHTML = `
      <main>
        <p>Translate me.</p>
        <section translate="no"><p>Keep private.</p></section>
        <form><p>Payment details.</p></form>
        <p hidden>Not visible.</p>
        <section style="display: none"><p>Hidden by ancestor CSS.</p></section>
        <pre><p>const credential = 'secret';</p></pre>
      </main>
    `;
    const translatedTexts: string[] = [];
    const pageTranslation = createPageTranslation({
      document,
      async translate(units) {
        translatedTexts.push(...units.map((unit) => unit.text));
        return units;
      },
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });

    expect(translatedTexts).toEqual(['Translate me.']);
    expect(
      document.querySelector<HTMLParagraphElement>('p[hidden]')?.hidden,
    ).toBe(true);
  });

  it('classifies main content, optional page interface, and protected content', async () => {
    document.body.innerHTML = `
      <nav><p>Navigation label</p></nav>
      <main><p>A sufficiently substantial main article paragraph for reading.</p></main>
      <aside><p>Related link</p></aside>
      <div data-lingo-content="interface"><p>Explicit interface copy</p></div>
      <div data-lingo-content="exclude"><p>Explicitly protected</p></div>
    `;
    const translatedTexts: string[] = [];
    const pageTranslation = createPageTranslation({
      document,
      async translate(units) {
        translatedTexts.push(...units.map((unit) => unit.text));
        return units;
      },
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      contentScope: 'main-and-interface',
      translateImmediately: true,
    });

    expect(translatedTexts).toEqual([
      'Navigation label',
      'A sufficiently substantial main article paragraph for reading.',
      'Explicit interface copy',
    ]);
  });

  it('preserves links and emphasis in translated output', async () => {
    document.body.innerHTML = `
      <article><p>Read <a href="/guide">the <strong>guide</strong></a> today.</p></article>
    `;
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) =>
        units.map((unit) => ({
          ...unit,
          text: unit.text.replace('Read ', '阅读 ').replace(' today.', '。'),
        })),
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    const translation = document.querySelector('[data-lingo-translation]');
    expect(translation?.textContent).toBe('阅读 the guide。');
    expect(translation?.querySelector('a')?.getAttribute('href')).toBe(
      '/guide',
    );
    expect(translation?.querySelector('strong')?.textContent).toBe('guide');
  });

  it('preserves page styles that keep translated text on one line', async () => {
    document.head.innerHTML = `
      <style>
        .single-line-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    `;
    document.body.innerHTML = `
      <article>
        <p id="source-label" class="single-line-label" dir="ltr" onclick="alert('source')">
          A single-line label.
        </p>
      </article>
    `;
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) =>
        units.map((unit) => ({
          ...unit,
          text: 'Translated single-line label.',
        })),
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    const original = document.querySelector<HTMLElement>('article p');
    const translation = document.querySelector<HTMLElement>(
      '[data-lingo-translation]',
    );
    expect(original).not.toBeNull();
    expect(translation).not.toBeNull();
    if (!original || !translation)
      throw new Error('Translation was not rendered.');
    expect(getComputedStyle(original).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(translation).whiteSpace).toBe('nowrap');
    expect(translation.classList.contains('single-line-label')).toBe(true);
    expect(translation.dir).toBe('ltr');
    expect(translation.hasAttribute('id')).toBe(false);
    expect(translation.hasAttribute('onclick')).toBe(false);
  });

  it('does not let bilingual translations consume ordered-list numbers', async () => {
    document.head.innerHTML = `<style>${pageTranslationCss}</style>`;
    document.body.innerHTML = `
      <main><ol><li>First item.</li><li>Second item.</li></ol></main>
    `;
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) =>
        units.map((unit) => ({ ...unit, text: `Translated ${unit.text}` })),
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    const translations = [
      ...document.querySelectorAll<HTMLElement>('li[data-lingo-translation]'),
    ];
    expect(translations).toHaveLength(2);
    expect(translations.map((item) => getComputedStyle(item).display)).toEqual([
      'block',
      'block',
    ]);

    await pageTranslation.update({ displayMode: 'translation' });
    expect(translations.map((item) => getComputedStyle(item).display)).toEqual([
      'list-item',
      'list-item',
    ]);
  });

  it('switches among bilingual, translation-only, and original modes', async () => {
    const pageTranslation = createPageTranslation({
      document,
      translate: async (units) => units,
    });
    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });

    await pageTranslation.update({ displayMode: 'translation' });
    expect(
      document.querySelector('article p')?.hasAttribute('data-lingo-hidden'),
    ).toBe(true);
    await pageTranslation.update({ displayMode: 'original' });
    expect(
      document
        .querySelector('[data-lingo-translation]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
    expect(
      document.querySelector('article p')?.hasAttribute('data-lingo-hidden'),
    ).toBe(false);
    await pageTranslation.update({ displayMode: 'bilingual' });
    expect(
      document
        .querySelector('[data-lingo-translation]')
        ?.hasAttribute('hidden'),
    ).toBe(false);
  });

  it('translates dynamically added content once and disconnects observers on stop', async () => {
    const translatedTexts: string[] = [];
    const pageTranslation = createPageTranslation({
      document,
      async translate(units) {
        translatedTexts.push(...units.map((unit) => unit.text));
        return units;
      },
    });
    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Loaded by infinite scroll.';
    document.querySelector('article')?.append(paragraph);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      translatedTexts.filter((text) => text === paragraph.textContent),
    ).toHaveLength(1);
    await pageTranslation.stop();
    const afterStop = document.createElement('p');
    afterStop.textContent = 'Added after stop.';
    document.querySelector('article')?.append(afterStop);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translatedTexts).not.toContain('Added after stop.');
    expect(document.querySelector('[data-lingo-translation]')).toBeNull();
    expect(document.querySelector('[data-lingo-hidden]')).toBeNull();
  });

  it('increments the page revision and discards translations from the previous URL', async () => {
    let resolveTranslation:
      | ((value: Array<{ id: string; text: string }>) => void)
      | undefined;
    const pageTranslation = createPageTranslation({
      document,
      translate: (units) =>
        new Promise((resolve) => {
          resolveTranslation ??= () => resolve(units);
        }),
    });
    const started = pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });
    history.pushState({}, '', '/next-page');
    resolveTranslation?.([]);
    await started;

    expect(pageTranslation.snapshot().pageRevision).toBe(1);
    expect(document.querySelector('[data-lingo-translation]')).toBeNull();
  });
});

function mockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies Logger;
}
