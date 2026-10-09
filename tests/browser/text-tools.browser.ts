import { afterEach, describe, expect, it, vi } from 'vitest';
import pageStyle from '../../entrypoints/page-translation.css?raw';
import { resources } from '../../lib/i18n/resources';
import { createPageTranslation } from '../../lib/page-translation/page-translation';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';
import { createTextTools } from '../../lib/ui/text-tools';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

describe('text interactions in real browsers', () => {
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
    field.value = 'Edited while waiting';
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
