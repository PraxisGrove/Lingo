import { afterEach, describe, expect, it, vi } from 'vitest';
import pageTranslationCss from '../../entrypoints/page-translation.css?raw';
import {
  DEFAULT_TRANSLATION_APPEARANCE,
  TRANSLATION_APPEARANCE_PRESETS,
} from '../../lib/page-translation/appearance';
import {
  createPageTranslation,
  type PageTranslation,
} from '../../lib/page-translation/page-translation';
import type { TranslationUnit } from '../../lib/translation/types';

let session: PageTranslation | undefined;

afterEach(async () => {
  await session?.stop();
  session = undefined;
  document.body.innerHTML = '';
  document.querySelectorAll('[data-appearance-fixture]').forEach((style) => {
    style.remove();
  });
});

describe('translated reading appearance', () => {
  it('inherits source typography, links and code, and keeps source/translation pairs close', async () => {
    addStyle(`
      article { color: rgb(32, 49, 42); font-family: Georgia, serif; font-size: 20px; line-height: 1.65; }
      h1 { font-size: 32px; line-height: 1.2; }
      #body-copy { color: rgb(54, 67, 59); margin-bottom: 24px; }
      a { color: rgb(36, 86, 150); }
      code { font-family: monospace; }
    `);
    document.body.innerHTML =
      '<article><h1>Reading notes</h1><p id="body-copy">Read <a href="/library">library hours</a> and use <code>open()</code> today.</p></article>';
    const translate = vi.fn(async (units: TranslationUnit[]) => units);
    session = createPageTranslation({ document, translate });
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    const source = required('p[data-lingo-source]');
    const translation = required('p[data-lingo-translation]');
    const style = getComputedStyle(translation);
    expect(style.color).toBe('rgb(54, 67, 59)');
    expect(style.fontFamily).toBe(getComputedStyle(source).fontFamily);
    expect(style.fontSize).toBe('20px');
    expect(style.lineHeight).toBe('33px');
    expect(style.borderInlineStartWidth).toBe('0px');
    expect(style.marginBlockStart).toBe('7px');
    expect(style.marginBlockEnd).toBe('24px');
    expect(getComputedStyle(source).marginBlockEnd).toBe('0px');
    expect(
      getComputedStyle(required('h1[data-lingo-translation]')).fontSize,
    ).toBe('32px');
    expect(translation.querySelector('a')?.getAttribute('href')).toBe(
      '/library',
    );
    expect(translation.querySelector('code')?.textContent).toBe('open()');
    expect(
      getComputedStyle(required('p[data-lingo-translation] a')).color,
    ).toBe('rgb(36, 86, 150)');
    expect(translate).toHaveBeenCalledTimes(1);
    await session.stop();
    expect(getComputedStyle(source).marginBlockEnd).toBe('24px');
    expect(source.hasAttribute('data-lingo-source')).toBe(false);
  });

  it('updates existing body, heading, list and table styles without translating again', async () => {
    addStyle(
      'article { font-size: 20px; line-height: 1.5; } h2 { font-size: 30px; line-height: 1.2; }',
    );
    document.body.innerHTML =
      '<article><h2>Reading notes</h2><p>Opening hours.</p><ol><li>The first item.</li></ol><table><tbody><tr><td>Visitors</td></tr></tbody></table></article>';
    const translate = vi.fn(async (units: TranslationUnit[]) => units);
    session = createPageTranslation({ document, translate });
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    session.updateAppearance({
      ...DEFAULT_TRANSLATION_APPEARANCE,
      fontScale: 1.2,
      lineHeight: 1.8,
      paragraphGap: 0.5,
      color: '#345942',
      separator: 'dashed',
      fontFamily: 'sans-serif',
    });
    const body = required('p[data-lingo-translation]');
    expect(getComputedStyle(body).fontSize).toBe('24px');
    expect(Number.parseFloat(getComputedStyle(body).lineHeight)).toBeCloseTo(
      43.2,
    );
    expect(getComputedStyle(body).color).toBe('rgb(52, 89, 66)');
    expect(getComputedStyle(body).borderBlockStartStyle).toBe('dashed');
    expect(getComputedStyle(body).marginBlockStart).toBe('12px');
    expect(
      getComputedStyle(required('h2[data-lingo-translation]')).lineHeight,
    ).toBe('43.2px');
    expect(
      getComputedStyle(required('li[data-lingo-translation]')).display,
    ).toBe('block');

    await session.update({ displayMode: 'translation' });
    session.updateAppearance(TRANSLATION_APPEARANCE_PRESETS.comfortable);
    const cell = required('td');
    const cellTranslation = required('td [data-lingo-translation]');
    expect(getComputedStyle(cell).fontSize).toBe('0px');
    expect(getComputedStyle(cellTranslation).fontSize).toBe('21px');
    expect(
      getComputedStyle(required('li[data-lingo-translation]')).display,
    ).toBe('list-item');
    expect(getComputedStyle(body).borderBlockStartWidth).toBe('0px');
    expect(translate).toHaveBeenCalledTimes(1);

    session.updateAppearance(DEFAULT_TRANSLATION_APPEARANCE);
    expect(getComputedStyle(cellTranslation).fontSize).toBe('20px');
    expect(getComputedStyle(body).fontSize).toBe('20px');
  });

  it('follows a page theme change in the document and open shadow roots without extra requests', async () => {
    addStyle(
      'article { color: rgb(33, 40, 35); font-size: 18px; } article.dark { background: #202422; color: rgb(229, 231, 226); }',
    );
    document.body.innerHTML =
      '<article><p>Library opening hours.</p><section id="component"></section></article>';
    const root = required('#component').attachShadow({ mode: 'open' });
    root.innerHTML = '<p>Read a book in a quiet corner.</p>';
    const translate = vi.fn(async (units: TranslationUnit[]) => units);
    session = createPageTranslation({
      document,
      translate,
      shadowStyle: pageTranslationCss,
    });
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    expect(getComputedStyle(required('p[data-lingo-translation]')).color).toBe(
      'rgb(33, 40, 35)',
    );
    required('article').classList.add('dark');
    await vi.waitFor(() => {
      expect(
        getComputedStyle(required('p[data-lingo-translation]')).color,
      ).toBe('rgb(229, 231, 226)');
      const translated = root.querySelector('[data-lingo-translation]');
      if (!translated) throw new Error('Missing shadow translation.');
      expect(getComputedStyle(translated).color).toBe('rgb(229, 231, 226)');
    });
    expect(translate).toHaveBeenCalledTimes(1);
  });
});

function required(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing reading fixture element: ${selector}`);
  return element;
}

function addStyle(css: string) {
  const style = document.createElement('style');
  style.dataset.appearanceFixture = '';
  style.textContent = `${pageTranslationCss}\n${css}`;
  document.head.append(style);
}
