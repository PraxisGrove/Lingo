import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import pageTranslationCss from '../../entrypoints/page-translation.css?raw';
import contentTypesFixture from '../../lib/page-translation/fixtures/content-types.html?raw';
import { createPageTranslation } from '../../lib/page-translation/page-translation';
import fixtureCss from './page-translation-fixture.css?raw';

let stopTranslation: (() => Promise<void>) | undefined;

describe('page translation browser fixture', () => {
  it.each([
    'bilingual',
    'translation',
    'original',
  ] as const)('updates existing paragraphs and table cells in %s mode', async (displayMode) => {
    appendStyle(pageTranslationCss);
    document.body.innerHTML =
      '<main><p>Old paragraph.</p><table><tbody><tr><td>Old cell.</td></tr></tbody></table></main>';
    const requests: string[][] = [];
    const session = createPageTranslation({
      document,
      async translate(units) {
        requests.push(units.map((unit) => unit.text));
        return units.map((unit) => ({
          ...unit,
          text: `Translated: ${unit.text}`,
        }));
      },
    });
    stopTranslation = () => session.stop();
    await session.start({ targetLanguage: 'zh-CN', displayMode });
    const paragraph = requiredElement('p');
    const cell = requiredElement('td');
    if (!paragraph.firstChild || !cell.firstChild)
      throw new Error('Missing text nodes.');
    paragraph.firstChild.textContent = 'New paragraph.';
    cell.firstChild.textContent = 'New cell.';
    await vi.waitFor(() => {
      expect(requiredElement('p[data-lingo-translation]').textContent).toBe(
        'Translated: New paragraph.',
      );
      expect(requiredElement('td [data-lingo-translation]').textContent).toBe(
        'Translated: New cell.',
      );
    });
    expect(requests).toEqual([
      ['Old paragraph.', 'Old cell.'],
      ['New paragraph.', 'New cell.'],
    ]);
    expect(session.snapshot()).toMatchObject({
      translatedUnitCount: 2,
      totalUnitCount: 2,
    });
    expect(
      requiredElement<HTMLElement>('p[data-lingo-translation]').hidden,
    ).toBe(displayMode === 'original');
    await session.stop();
    expect(paragraph.textContent).toBe('New paragraph.');
    expect(cell.textContent).toBe('New cell.');
    expect(document.querySelector('[data-lingo-translation]')).toBeNull();
  });

  afterEach(async () => {
    await stopTranslation?.();
    stopTranslation = undefined;
    document.body.innerHTML = '';
    document.querySelectorAll('[data-test-style]').forEach((style) => {
      style.remove();
    });
  });

  it('preserves layout, structure, exclusions, display modes, and restoration', async () => {
    await page.viewport(900, 900);
    appendStyle(pageTranslationCss);
    appendStyle(fixtureCss);
    document.body.innerHTML = contentTypesFixture;
    const originalMarkup = document.body.innerHTML;
    const translatedTexts: string[] = [];
    const originalLabel = requiredElement<HTMLElement>('.single-line-label');
    const originalLabelHeight = originalLabel.getBoundingClientRect().height;
    const firstCell = requiredElement<HTMLTableCellElement>('td');
    const originalTextNode = firstCell.firstChild;
    const originalTableShape = tableShape();
    const pageTranslation = createPageTranslation({
      document,
      async translate(units) {
        translatedTexts.push(...units.map((unit) => unit.text));
        return units.map((unit) => ({
          ...unit,
          text: `Translated: ${unit.text}`,
        }));
      },
    });
    stopTranslation = () => pageTranslation.stop();

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      translateImmediately: true,
    });
    await nextPaint();

    const translatedLabel = requiredElement<HTMLElement>(
      '.single-line-label[data-lingo-translation]',
    );
    expect(getComputedStyle(translatedLabel).whiteSpace).toBe('nowrap');
    expect(
      Math.abs(
        translatedLabel.getBoundingClientRect().height - originalLabelHeight,
      ),
    ).toBeLessThan(0.1);
    expect(tableShape()).toEqual(originalTableShape);
    expect(originalTextNode?.parentElement).toBe(firstCell);
    expect(
      getComputedStyle(requiredElement('li[data-lingo-translation]')).display,
    ).toBe('block');
    expect(translatedTexts).not.toContain(
      'This CSS-hidden paragraph must not be translated.',
    );
    expect(translatedTexts).not.toContain(
      'This protected paragraph must not be translated.',
    );
    for (const sentinel of [
      'private-inline-sentinel',
      'private-code-sentinel',
      'private-hidden-sentinel',
    ]) {
      expect(translatedTexts.join('\n')).not.toContain(sentinel);
    }

    await pageTranslation.update({ displayMode: 'translation' });
    expect(firstCell.hasAttribute('data-lingo-cell-original-hidden')).toBe(
      true,
    );
    expect(getComputedStyle(firstCell).fontSize).toBe('0px');
    expect(
      getComputedStyle(requiredElement('td > [data-lingo-translation]'))
        .fontSize,
    ).not.toBe('0px');
    expect(
      getComputedStyle(requiredElement('li[data-lingo-translation]')).display,
    ).toBe('list-item');

    await pageTranslation.update({ displayMode: 'original' });
    expect(
      [
        ...document.querySelectorAll<HTMLElement>('[data-lingo-translation]'),
      ].every((translation) => translation.hidden),
    ).toBe(true);

    await pageTranslation.stop();
    stopTranslation = undefined;
    expect(document.body.innerHTML).toBe(originalMarkup);
    expect(originalTextNode?.parentElement).toBe(firstCell);
  });
});

function appendStyle(css: string): void {
  const style = document.createElement('style');
  style.dataset.testStyle = '';
  style.textContent = css;
  document.head.append(style);
}

function requiredElement<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Expected fixture element: ${selector}`);
  return element;
}

function tableShape(): number[][] {
  return [...document.querySelectorAll('table')].map((table) =>
    [...table.rows].map((row) => row.cells.length),
  );
}

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
