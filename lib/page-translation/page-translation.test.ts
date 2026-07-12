// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPageTranslation as createPageTranslationImplementation,
  type PageTranslation,
} from './page-translation';

const sessions: PageTranslation[] = [];
const createPageTranslation: typeof createPageTranslationImplementation = (
  dependencies,
) => {
  const session = createPageTranslationImplementation(dependencies);
  sessions.push(session);
  return session;
};

describe('PageTranslation', () => {
  beforeEach(() => {
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
