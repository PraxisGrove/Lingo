// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { createPageTranslation } from './page-translation';

describe('PageTranslation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article>
        <p>Hello world.</p>
        <p>This is a static article paragraph.</p>
      </article>
    `;
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
});
