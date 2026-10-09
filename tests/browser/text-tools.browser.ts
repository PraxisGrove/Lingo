import { afterEach, describe, expect, it, vi } from 'vitest';
import pageStyle from '../../entrypoints/page-translation.css?raw';
import { resources } from '../../lib/i18n/resources';
import { createPageTranslation } from '../../lib/page-translation/page-translation';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';
import type { TranslationUnit } from '../../lib/translation/types';
import { createTextTools } from '../../lib/ui/text-tools';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

describe('text interactions in real browsers', () => {
  it('removes a translation when unchanged text is replaced by protected markup', async () => {
    document.body.innerHTML = '<main><p><span>Hello</span></p></main>';
    const translate = vi.fn(async (units: TranslationUnit[]) => units);
    const session = createPageTranslation({ document, translate });
    cleanup = () => {
      void session.stop();
    };
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    (document.querySelector('p') as HTMLElement).innerHTML =
      '<span translate="no">Hello</span>';
    await vi.waitFor(() =>
      expect(document.querySelector('[data-lingo-translation]')).toBeNull(),
    );
    expect(translate).toHaveBeenCalledTimes(1);
    expect(session.snapshot().translatedUnitCount).toBe(0);
  });

  it.each([
    'original',
    'translation',
    'bilingual',
  ] as const)('does not treat its own table translation as source content in %s mode', async (displayMode) => {
    document.body.innerHTML =
      '<main><table><tbody><tr><td>Hello</td></tr></tbody></table></main>';
    const style = document.createElement('style');
    style.textContent = `${pageStyle} .highlight { font-size: 24px; }`;
    document.head.append(style);
    const translate = vi.fn(async (units: TranslationUnit[]) => units);
    const session = createPageTranslation({
      document,
      translate,
      shadowStyle: pageStyle,
    });
    cleanup = () => {
      style.remove();
      void session.stop();
    };
    await session.start({ targetLanguage: 'zh-CN', displayMode });
    const translation = document.querySelector('[data-lingo-translation]');
    (document.querySelector('td') as HTMLElement).className = 'highlight';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-lingo-translation]')).toBe(
      translation,
    );
    expect(translate).toHaveBeenCalledTimes(1);
    expect(getComputedStyle(translation as Element).fontSize).toBe('24px');
  });

  it('reloads repaired site rules when retrying their initial failure', async () => {
    document.body.innerHTML = '<main><p>Rule recovery.</p></main>';
    let invalid = true;
    const session = createPageTranslation({
      document,
      getRuleSelectors: async () => ({ main: [invalid ? '[' : 'main'] }),
      translate: async (units) => units,
    });
    cleanup = () => {
      void session.stop();
    };
    expect(
      (
        await session.start({
          targetLanguage: 'zh-CN',
          displayMode: 'bilingual',
        })
      ).status,
    ).toBe('failed');
    invalid = false;
    await session.update({ displayMode: 'bilingual', retryFailed: true });
    expect(session.snapshot().translatedUnitCount).toBe(1);
  });

  it('translates an open-shadow selection using its actual range and rejects protected hosts', async () => {
    document.body.innerHTML = '<main><div id="selected-host"></div></main>';
    const host = document.getElementById('selected-host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Shadow selection.</p>';
    const requests: string[] = [];
    const tools = createTextTools({
      document,
      t: (key) => resources.en.translation[key],
      openSettings() {},
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'test',
      }),
      client: {
        cancel() {},
        disconnect() {},
        async translate(units) {
          requests.push(...units.map((unit) => unit.text));
          return units;
        },
      },
    });
    cleanup = () => tools.dispose();
    const text = shadow.querySelector('p')?.firstChild;
    if (!text) throw new Error('Missing selected text');
    document
      .getSelection()
      ?.setBaseAndExtent(text, 0, text, text.textContent?.length ?? 0);
    tools.execute('selection');
    await vi.waitFor(() => expect(requests).toEqual(['Shadow selection.']));
    [
      ...(document
        .querySelector('[data-lingo-owned="text-tools"]')
        ?.shadowRoot?.querySelectorAll('button') ?? []),
    ]
      .find((button) => button.textContent === 'Close')
      ?.click();
    host.setAttribute('translate', 'no');
    document
      .getSelection()
      ?.setBaseAndExtent(text, 0, text, text.textContent?.length ?? 0);
    tools.execute('selection');
    expect(requests).toEqual(['Shadow selection.']);
  });

  it('starts a new page language while preserving scope and display mode', async () => {
    document.body.innerHTML =
      '<main><p>Main text.</p></main><nav><p>Navigation text.</p></nav>';
    const requests: string[] = [];
    const session = createPageTranslation({
      document,
      async translate(units, language) {
        requests.push(language);
        return units.map((unit) => ({
          ...unit,
          text: `${language}: ${unit.text}`,
        }));
      },
    });
    cleanup = () => {
      void session.stop();
    };
    await session.start({
      targetLanguage: 'zh-CN',
      contentScope: 'main-and-interface',
      displayMode: 'translation',
    });
    await session.start({ targetLanguage: 'ja', displayMode: 'translation' });
    expect(requests).toEqual(['zh-CN', 'ja']);
    expect(document.querySelectorAll('[data-lingo-translation]').length).toBe(
      2,
    );
    expect(document.querySelectorAll('[data-lingo-hidden]').length).toBe(2);
    expect(
      document.querySelector('[data-lingo-translation]')?.textContent,
    ).toBe('ja: Main text.');
  });

  it.each([
    'selection',
    'input',
  ] as const)('rechecks protection before a delayed %s request', async (action) => {
    document.body.innerHTML =
      '<main><p>Selected sentinel.</p></main><input value="Input sentinel.">';
    const settings = { ...DEFAULT_SETTINGS, activeProviderProfileId: 'test' };
    let release: ((value: typeof settings) => void) | undefined;
    const translate = vi.fn(async (units: TranslationUnit[]) => units);
    const tools = createTextTools({
      document,
      t: (key) => resources.en.translation[key],
      openSettings() {},
      getSettings: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      client: { translate, cancel() {}, disconnect() {} },
    });
    cleanup = () => tools.dispose();
    const field = document.querySelector('input') as HTMLInputElement;
    if (action === 'selection') {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('p') as Element);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    } else field.focus();
    tools.execute(action);
    if (action === 'selection')
      document.querySelector('p')?.setAttribute('translate', 'no');
    else field.type = 'password';
    release?.(settings);
    const panel = document.querySelector(
      '[data-lingo-owned="text-tools"]',
    )?.shadowRoot;
    await vi.waitFor(() =>
      expect(panel?.querySelector('[role="status"]')?.textContent).toBe(
        resources.en.translation['tools.protected'],
      ),
    );
    expect(translate).not.toHaveBeenCalled();
  });

  it('retains drafts, local language, and pending translation across presentation settings', async () => {
    const settings = { ...DEFAULT_SETTINGS, activeProviderProfileId: 'test' };
    let release: ((units: TranslationUnit[]) => void) | undefined;
    const cancel = vi.fn();
    const tools = createTextTools({
      document,
      standalone: true,
      t: (key) => resources.en.translation[key],
      openSettings() {},
      getSettings: async () => settings,
      client: {
        cancel,
        disconnect() {},
        translate: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
    });
    cleanup = () => tools.dispose();
    tools.update(settings);
    tools.execute('open');
    const panel = document.querySelector(
      '[data-lingo-owned="text-tools"]',
    )?.shadowRoot;
    if (!panel) throw new Error('Missing panel');
    const source = panel.querySelector('textarea') as HTMLTextAreaElement;
    const target = panel.querySelector('input') as HTMLInputElement;
    source.value = 'Saved draft.';
    target.value = 'ja';
    tools.execute('open');
    expect(source.value).toBe('Saved draft.');
    [...panel.querySelectorAll('button')]
      .find((button) => button.textContent === 'Translate')
      ?.click();
    await vi.waitFor(() => expect(release).toBeDefined());
    const cancellations = cancel.mock.calls.length;
    tools.update({ ...settings, theme: 'dark', uiLocale: 'ja' });
    expect(target.value).toBe('ja');
    expect(cancel.mock.calls.length).toBe(cancellations);
    release?.([{ id: 'text-tool', number: 1, text: 'Draft translated.' }]);
    await vi.waitFor(() =>
      expect(panel.querySelector('.output')?.textContent).toBe(
        'Draft translated.',
      ),
    );
  });

  it('does not send unassigned shadow-host text and responds to slot reassignment', async () => {
    document.body.innerHTML =
      '<main><div id="host"><p id="hidden">Hidden light sentinel.</p><div slot="reading"><p>Assigned text.</p></div></div></main>';
    const host = document.getElementById('host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<p>Visible shadow text.</p><slot name="reading"></slot>';
    const requests: string[] = [];
    const session = createPageTranslation({
      document,
      async translate(units) {
        requests.push(...units.map((unit) => unit.text));
        return units;
      },
    });
    cleanup = () => {
      void session.stop();
    };
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    expect(requests.sort()).toEqual(
      ['Assigned text.', 'Visible shadow text.'].sort(),
    );
    const assigned = host.querySelector('[slot]') as HTMLElement;
    assigned.setAttribute('slot', 'unmatched');
    await vi.waitFor(() =>
      expect(assigned.querySelector('[data-lingo-translation]')).toBeNull(),
    );
    expect(requests).not.toContain('Hidden light sentinel.');
    assigned.setAttribute('slot', 'reading');
    await vi.waitFor(() =>
      expect(assigned.querySelector('[data-lingo-translation]')).not.toBeNull(),
    );
  });

  it('keeps unchanged translations during unrelated class and style changes', async () => {
    document.body.innerHTML = '<main><p>Stable paragraph.</p></main>';
    const translate = vi.fn(async (units: TranslationUnit[]) => units);
    const session = createPageTranslation({ document, translate });
    cleanup = () => {
      void session.stop();
    };
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    const original = document.querySelector('p') as HTMLElement;
    const translation = document.querySelector('[data-lingo-translation]');
    for (const value of ['active', 'selected', 'animated']) {
      original.className = value;
      original.style.opacity = '0.8';
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(translate).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-lingo-translation]')).toBe(
      translation,
    );
    original.setAttribute('translate', 'no');
    await vi.waitFor(() =>
      expect(document.querySelector('[data-lingo-translation]')).toBeNull(),
    );
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('preserves literal marker characters in ordinary webpage text', async () => {
    document.body.innerHTML =
      '<main><p>Literal ⟦1⟧example⟦/1⟧ and ⟦KEEP:2⟧ text.</p></main>';
    const session = createPageTranslation({
      document,
      translate: async (units) => units,
    });
    cleanup = () => {
      void session.stop();
    };
    await session.start({ targetLanguage: 'zh-CN', displayMode: 'bilingual' });
    expect(
      document.querySelector('[data-lingo-translation]')?.textContent,
    ).toBe('Literal ⟦1⟧example⟦/1⟧ and ⟦KEEP:2⟧ text.');
  });

  it('keeps code local during hovered-paragraph translation and honors site exclusions', async () => {
    document.body.innerHTML =
      '<main><p id="read">Read <code>local-code-sentinel</code> safely.</p><p class="private">Excluded text.</p></main>';
    const requests: string[] = [];
    const tools = createTextTools({
      document,
      t: (key) => resources.en.translation[key],
      openSettings: () => {},
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'test',
      }),
      getRuleSelectors: async () => ({ exclude: ['.private'] }),
      client: {
        cancel() {},
        disconnect() {},
        async translate(units) {
          requests.push(...units.map((unit) => unit.text));
          return units;
        },
      },
    });
    cleanup = () => tools.dispose();
    document
      .getElementById('read')
      ?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, composed: true }),
      );
    tools.execute('paragraph');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).not.toContain('local-code-sentinel');
    const panel = document.querySelector(
      '[data-lingo-owned="text-tools"]',
    )?.shadowRoot;
    await vi.waitFor(() =>
      expect(panel?.querySelector('.output code')?.textContent).toBe(
        'local-code-sentinel',
      ),
    );
    expect(panel?.querySelector('textarea')?.value).toBe(
      'Read local-code-sentinel safely.',
    );
    document
      .querySelector('.private')
      ?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, composed: true }),
      );
    tools.execute('paragraph');
    await vi.waitFor(() =>
      expect(panel?.querySelector('[role="status"]')?.textContent).toBe(
        resources.en.translation['tools.protected'],
      ),
    );
    expect(requests).toHaveLength(1);
  });

  it('requires confirmation for input, can undo, and rejects changed input', async () => {
    document.body.innerHTML =
      '<textarea>Hello</textarea><input type="password" value="secret">';
    const requests: string[] = [];
    let release: (() => void) | undefined;
    const tools = createTextTools({
      document,
      t: (key) => resources.en.translation[key],
      openSettings: () => {},
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'test',
      }),
      client: {
        cancel() {},
        disconnect() {},
        async translate(units) {
          requests.push(...units.map((unit) => unit.text));
          if (requests.length === 2)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return units.map((unit) => ({ ...unit, text: '你好' }));
        },
      },
    });
    cleanup = () => tools.dispose();
    const field = document.querySelector('textarea');
    const shadow = document.querySelector(
      '[data-lingo-owned="text-tools"]',
    )?.shadowRoot;
    if (!field || !shadow) throw new Error('Missing field or panel');
    const buttons = () => [...shadow.querySelectorAll('button')];
    field.focus();
    tools.execute('input');
    await vi.waitFor(() =>
      expect(shadow.querySelector('.output')?.textContent).toBe('你好'),
    );
    expect(field.value).toBe('Hello');
    buttons()
      .find((button) => button.textContent === 'Replace input')
      ?.click();
    expect(field.value).toBe('你好');
    buttons()
      .find((button) => button.textContent === 'Undo input change')
      ?.click();
    expect(field.value).toBe('Hello');
    field.focus();
    tools.execute('input');
    await vi.waitFor(() => expect(release).toBeDefined());
    field.value = 'Edited while waiting';
    release?.();
    await vi.waitFor(() =>
      expect(shadow.querySelector('.output')?.textContent).toBe('你好'),
    );
    buttons()
      .find((button) => button.textContent === 'Replace input')
      ?.click();
    expect(field.value).toBe('Edited while waiting');
    (document.querySelector('input') as HTMLInputElement).focus();
    tools.execute('input');
    expect(requests).toEqual(['Hello', 'Hello']);
  });

  it('translates an explicit selection and ignores protected selections', async () => {
    document.body.innerHTML =
      '<main><p>Hello reader</p><p translate="no">private sentinel</p></main>';
    const requests: string[] = [];
    const tools = createTextTools({
      document,
      t: (key) => resources.en.translation[key],
      openSettings: () => {},
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        activeProviderProfileId: 'test',
      }),
      client: {
        cancel() {},
        disconnect() {},
        async translate(units) {
          requests.push(...units.map((unit) => unit.text));
          return units;
        },
      },
    });
    cleanup = () => tools.dispose();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('p') as Element);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    tools.execute('selection');
    await vi.waitFor(() => expect(requests).toEqual(['Hello reader']));
    range.selectNodeContents(
      document.querySelector('[translate="no"]') as Element,
    );
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    tools.execute('selection');
    expect(requests).toEqual(['Hello reader']);
  });

  it('handles nested open roots, dynamic text, inherited exclusions, slots, and full restoration', async () => {
    document.body.innerHTML =
      '<main><div id="host"></div><div translate="no" id="private"></div></main>';
    const host = document.getElementById('host') as HTMLElement;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<p>Shadow paragraph.</p><div id="nested"></div><slot></slot>';
    const nested = (root.querySelector('#nested') as HTMLElement).attachShadow({
      mode: 'open',
    });
    nested.innerHTML = '<p>Nested paragraph.</p>';
    const privateRoot = (
      document.getElementById('private') as HTMLElement
    ).attachShadow({ mode: 'open' });
    privateRoot.innerHTML = '<p>Private sentinel.</p>';
    const slotted = document.createElement('p');
    slotted.textContent = 'Slotted paragraph.';
    host.append(slotted);
    const requests: string[] = [];
    const session = createPageTranslation({
      document,
      shadowStyle: pageStyle,
      async translate(units) {
        requests.push(...units.map((unit) => unit.text));
        return units.map((unit) => ({
          ...unit,
          text: `Translated: ${unit.text}`,
        }));
      },
    });
    cleanup = () => {
      void session.stop();
    };
    await session.start({
      targetLanguage: 'zh-CN',
      displayMode: 'translation',
    });
    expect(requests.sort()).toEqual(
      ['Shadow paragraph.', 'Nested paragraph.', 'Slotted paragraph.'].sort(),
    );
    expect(getComputedStyle(root.querySelector('p') as Element).display).toBe(
      'none',
    );
    expect(privateRoot.querySelector('[data-lingo-translation]')).toBeNull();
    const paragraph = root.querySelector('p');
    if (!paragraph) throw new Error('Missing shadow paragraph');
    paragraph.textContent = 'Changed shadow paragraph.';
    await vi.waitFor(() =>
      expect(root.querySelector('[data-lingo-translation]')?.textContent).toBe(
        'Translated: Changed shadow paragraph.',
      ),
    );
    const additional = document.createElement('div');
    const addedRoot = additional.attachShadow({ mode: 'open' });
    addedRoot.innerHTML = '<p>Added component.</p>';
    root.append(additional);
    await vi.waitFor(() =>
      expect(
        addedRoot.querySelector('[data-lingo-translation]')?.textContent,
      ).toBe('Translated: Added component.'),
    );
    const sentCount = requests.length;
    host.setAttribute('translate', 'no');
    await vi.waitFor(() => {
      expect(root.querySelector('[data-lingo-translation]')).toBeNull();
      expect(nested.querySelector('[data-lingo-translation]')).toBeNull();
      expect(addedRoot.querySelector('[data-lingo-translation]')).toBeNull();
    });
    expect(requests.length).toBe(sentCount);
    host.removeAttribute('translate');
    await vi.waitFor(() =>
      expect(nested.querySelector('[data-lingo-translation]')).not.toBeNull(),
    );
    await session.stop();
    expect(
      root.querySelector(
        '[data-lingo-translation], [data-lingo-owned], [data-lingo-hidden]',
      ),
    ).toBeNull();
    expect(nested.innerHTML).toBe('<p>Nested paragraph.</p>');
    expect(addedRoot.innerHTML).toBe('<p>Added component.</p>');
    expect(host.textContent).toBe('Slotted paragraph.');
  });
});
