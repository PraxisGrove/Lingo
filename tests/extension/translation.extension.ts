import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';

declare const chrome: {
  storage: { local: { set(value: Record<string, unknown>): Promise<void> } };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  tabs: {
    query(query: Record<string, unknown>): Promise<Array<{ id: number }>>;
    sendMessage(
      tabId: number,
      message: unknown,
      options?: { frameId: number },
    ): Promise<unknown>;
  };
};

let context: BrowserContext;
let server: Server;
let endpoint: string;
let extensionId: string;
let control: Page;
let blockNext = false;
let blockedText: string | undefined;
let release: (() => void) | undefined;
const requests: Array<{ texts: string[]; source: string; path: string }> = [];
const credential = 'local-contract-credential';
let articleHtml = '';

describe('installed Chromium extension translation', () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        q: string[];
        source: string;
      };
      requests.push({
        texts: body.q,
        source: body.source,
        path: request.url ?? '',
      });
      if (blockNext || body.q.includes(blockedText ?? '\u0000')) {
        blockNext = false;
        blockedText = undefined;
        await new Promise<void>((resolve) => {
          release = resolve;
          response.once('close', resolve);
        });
      }
      if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            data: {
              translations: body.q.map((text) => ({
                translatedText: `Translated: ${text}`,
              })),
            },
          }),
        );
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local provider address.');
    endpoint = `http://127.0.0.1:${address.port}`;
    const extensionPath = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).hostname;
    control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/options.html`);
    await context.route('https://reading.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: route.request().url().endsWith('/frame')
          ? '<main class="story"><p>Iframe paragraph.</p></main>'
          : articleHtml,
      });
    });
  });

  beforeEach(async () => {
    release?.();
    release = undefined;
    blockNext = false;
    blockedText = undefined;
    requests.length = 0;
    for (const page of context.pages())
      if (page !== control) await page.close();
    await control.evaluate(
      async ({ defaults, endpoint, credential }) => {
        await chrome.storage.local.set({
          settings: {
            ...defaults,
            uiLocale: 'en',
            targetLanguage: 'zh-CN',
            sourceLanguage: 'en',
            autoTranslation: { ...defaults.autoTranslation, enabled: false },
            translationCacheEnabled: false,
          },
          userRules: {
            schemaVersion: 1,
            rules: [
              {
                id: 'reading-scope',
                domain: 'reading.test',
                selectors: { main: ['.story'], exclude: ['.private'] },
              },
            ],
          },
        });
        await chrome.runtime.sendMessage({
          type: 'saveProviderProfile',
          payload: {
            profile: {
              id: 'local-provider',
              name: 'Local contract service',
              provider: 'google-cloud',
              endpoint,
            },
            credential,
          },
        });
      },
      { defaults: DEFAULT_SETTINGS, endpoint, credential },
    );
  });

  afterAll(async () => {
    release?.();
    await context?.close();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('uses popup controls, applies site rules, protects inline code, and translates iframes', async () => {
    articleHtml =
      '<main class="story"><p>Use <code>private-code-sentinel</code> safely.</p><p>Public paragraph.</p><aside class="private"><p>Private sentinel.</p></aside></main><footer><p>Footer sentinel.</p></footer><iframe src="/frame"></iframe>';
    const article = await openArticle();
    const popup = await openPopup(article);
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(async () => {
      expect(await article.locator('[data-lingo-translation]').count()).toBe(2);
      expect(
        await article
          .frameLocator('iframe')
          .locator('[data-lingo-translation]')
          .count(),
      ).toBe(1);
    });
    expect(
      await article.locator('[data-lingo-translation] code').textContent(),
    ).toBe('private-code-sentinel');
    expect(requests.every((request) => request.source === 'en')).toBe(true);
    const sent = requests.flatMap((request) => request.texts).join('\n');
    expect(sent).not.toContain('private-code-sentinel');
    expect(sent).not.toContain('Private sentinel');
    expect(sent).not.toContain('Footer sentinel');
    expect(await article.content()).not.toContain(credential);
    await clickPopup(popup, 'Restore original');
    await vi.waitFor(async () =>
      expect(await article.locator('[data-lingo-translation]').count()).toBe(0),
    );
    expect(await article.locator('main code').textContent()).toBe(
      'private-code-sentinel',
    );
    await vi.waitFor(async () =>
      expect(
        await article
          .frameLocator('iframe')
          .locator('[data-lingo-translation]')
          .count(),
      ).toBe(0),
    );
  });

  it('translates selections and input only on request, confirms writes, and opens the standalone window', async () => {
    articleHtml =
      '<main class="story"><p id="selected">Selected phrase.</p><p translate="no">Private selection.</p></main><textarea>Hello writer</textarea><input type="password" value="password-sentinel">';
    const article = await openArticle();
    await article.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('selected') as Element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await article
      .getByRole('button', { name: 'Translate selection', exact: true })
      .click();
    await expectTextOutput(article, 'Translated: Selected phrase.');
    expect(requests.flatMap((request) => request.texts)).toEqual([
      'Selected phrase.',
    ]);
    await article.getByRole('button', { name: 'Close', exact: true }).click();
    await article.locator('textarea').first().focus();
    await article.keyboard.press('Alt+Shift+I');
    await expectTextOutput(article, 'Translated: Hello writer');
    expect(await article.locator('textarea').first().inputValue()).toBe(
      'Hello writer',
    );
    await article
      .getByRole('button', { name: 'Replace input', exact: true })
      .click();
    expect(await article.locator('textarea').first().inputValue()).toBe(
      'Translated: Hello writer',
    );
    await article
      .getByRole('button', { name: 'Undo input change', exact: true })
      .click();
    expect(await article.locator('textarea').first().inputValue()).toBe(
      'Hello writer',
    );
    expect(requests.flatMap((request) => request.texts).join('')).not.toContain(
      'password-sentinel',
    );
    const popup = await openPopup(article);
    const newTab = context.waitForEvent('page');
    await clickPopup(popup, 'Open text translation');
    const translator = await newTab;
    await translator.waitForURL(
      `chrome-extension://${extensionId}/translate.html`,
    );
    await translator
      .getByRole('textbox', { name: 'Original text', exact: true })
      .fill('Independent text.');
    await translator
      .getByRole('button', { name: 'Translate', exact: true })
      .click();
    await expectTextOutput(translator, 'Translated: Independent text.');
    await translator.screenshot({
      path: '.vitest-attachments/text-translation.png',
      fullPage: true,
    });
  });

  it('translates open shadow components, preserves code, and restores their original DOM', async () => {
    articleHtml =
      '<main class="story"><div id="component"></div><div id="excluded" translate="no"></div></main>';
    const article = await openArticle();
    await article.evaluate(() => {
      (document.getElementById('component') as HTMLElement).attachShadow({
        mode: 'open',
      }).innerHTML = '<p>Read <code>shadow-code-sentinel</code> safely.</p>';
      (document.getElementById('excluded') as HTMLElement).attachShadow({
        mode: 'open',
      }).innerHTML = '<p>Private shadow sentinel.</p>';
    });
    const popup = await openPopup(article);
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(async () =>
      expect(
        await article.locator('#component [data-lingo-translation]').count(),
      ).toBe(1),
    );
    expect(
      await article
        .locator('#component [data-lingo-translation] code')
        .textContent(),
    ).toBe('shadow-code-sentinel');
    const sent = requests.flatMap((request) => request.texts).join('');
    expect(sent).not.toContain('shadow-code-sentinel');
    expect(sent).not.toContain('Private shadow sentinel');
    await clickPopup(popup, 'Restore original');
    await vi.waitFor(async () =>
      expect(
        await article.locator('#component [data-lingo-translation]').count(),
      ).toBe(0),
    );
    expect(
      await article.evaluate(
        () => document.getElementById('component')?.shadowRoot?.innerHTML,
      ),
    ).toBe('<p>Read <code>shadow-code-sentinel</code> safely.</p>');
  });

  it('splits an oversized formatted paragraph within service budgets and restores it intact', async () => {
    const longText = 'A complete sentence for reading. '.repeat(1000);
    articleHtml = `<main class="story"><p>Before <strong>${longText}</strong> after <code>long-code-sentinel</code>.</p></main>`;
    const article = await openArticle();
    const before = await article.locator('main').innerHTML();
    const popup = await openPopup(article);
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(
      async () =>
        expect(await article.locator('[data-lingo-translation]').count()).toBe(
          1,
        ),
      { timeout: 10_000 },
    );
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(
      requests.every((request) => request.texts.join('').length <= 24_000),
    ).toBe(true);
    expect(requests.flatMap((request) => request.texts).join('')).not.toContain(
      'long-code-sentinel',
    );
    expect(
      await article.locator('[data-lingo-translation] strong').count(),
    ).toBe(1);
    expect(
      await article.locator('[data-lingo-translation] code').textContent(),
    ).toBe('long-code-sentinel');
    await clickPopup(popup, 'Restore original');
    await vi.waitFor(async () =>
      expect(await article.locator('main').innerHTML()).toBe(before),
    );
  });

  it('keeps controls usable during a request and recovers from main-world SPA navigation', async () => {
    articleHtml = '<main class="story"><p>Initial paragraph.</p></main>';
    const article = await openArticle();
    const popup = await openPopup(article);
    blockNext = true;
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await clickPopup(popup, 'Restore original');
    release?.();
    await vi.waitFor(async () =>
      expect(await article.locator('[data-lingo-translation]').count()).toBe(0),
    );
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(async () =>
      expect(await article.locator('[data-lingo-translation]').count()).toBe(1),
    );
    const before = await snapshot();
    await article.evaluate(() => {
      const main = document.querySelector('main');
      if (main) main.innerHTML = '<p>New route paragraph.</p>';
      history.pushState({}, '', '/next');
    });
    await vi.waitFor(async () => {
      expect(
        await article.locator('[data-lingo-translation]').allTextContents(),
      ).toEqual(['Translated: New route paragraph.']);
      expect((await snapshot()).pageRevision).toBeGreaterThan(
        before.pageRevision,
      );
    });
    await article.evaluate(() => {
      const paragraph = document.querySelector('main p');
      if (paragraph) paragraph.textContent = 'Updated route paragraph.';
    });
    await vi.waitFor(async () =>
      expect(
        await article.locator('[data-lingo-translation]').allTextContents(),
      ).toEqual(['Translated: Updated route paragraph.']),
    );
    await clickPopup(popup, 'Restore original');
    expect(await article.locator('main').textContent()).toBe(
      'Updated route paragraph.',
    );
  });

  it('displays completed batches before a slow final batch finishes', async () => {
    articleHtml = `<main class="story">${Array.from({ length: 100 }, (_, index) => `<p>Paragraph ${index}.</p>`).join('')}<p>Delayed final paragraph.</p></main>`;
    const article = await openArticle();
    const popup = await openPopup(article);
    blockedText = 'Delayed final paragraph.';
    await control.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://reading.test/*' });
      await chrome.tabs.sendMessage(tab.id, {
        type: 'startPageTranslation',
        payload: {
          targetLanguage: 'zh-CN',
          displayMode: 'bilingual',
          translateImmediately: true,
        },
      });
    });
    await vi.waitFor(
      async () => {
        const translated = await article
          .locator('[data-lingo-translation]')
          .count();
        expect(translated).toBeGreaterThan(0);
        expect(translated).toBeLessThan(101);
        expect((await snapshot()).status).toBe('translating');
        expect(release).toBeDefined();
      },
      { timeout: 10_000 },
    );
    release?.();
    await vi.waitFor(
      async () =>
        expect(await article.locator('[data-lingo-translation]').count()).toBe(
          101,
        ),
      { timeout: 10_000 },
    );
    await clickPopup(popup, 'Restore original');
    await vi.waitFor(async () =>
      expect(await article.locator('[data-lingo-translation]').count()).toBe(0),
    );
  });

  it('can translate again after persisted page lifecycle events', async () => {
    articleHtml = '<main class="story"><p>Restored page paragraph.</p></main>';
    const article = await openArticle();
    const popup = await openPopup(article);
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(async () =>
      expect(await article.locator('[data-lingo-translation]').count()).toBe(1),
    );
    await article.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: true }),
      );
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      );
    });
    await vi.waitFor(async () =>
      expect((await snapshot()).status).toBe('idle'),
    );
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(async () =>
      expect(
        await article.locator('[data-lingo-translation]').allTextContents(),
      ).toEqual(['Translated: Restored page paragraph.']),
    );
    await clickPopup(popup, 'Restore original');
  });

  it('reconnects an unfinished request after the background worker is stopped', async () => {
    articleHtml =
      '<main class="story"><p>Worker recovery paragraph.</p></main>';
    const article = await openArticle();
    const popup = await openPopup(article);
    const cdp = await context.newCDPSession(control);
    let versionId: string | undefined;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      versionId =
        versions.find(
          (version: {
            scriptURL: string;
            runningStatus: string;
            versionId: string;
          }) =>
            version.scriptURL.startsWith(
              `chrome-extension://${extensionId}/`,
            ) && version.runningStatus === 'running',
        )?.versionId ?? versionId;
    });
    await cdp.send('ServiceWorker.enable');
    await vi.waitFor(() => expect(versionId).toBeDefined());
    if (!versionId)
      throw new Error('Missing running extension worker version.');
    blockNext = true;
    await clickPopup(popup, 'Translate page');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await cdp.send('ServiceWorker.stopWorker', { versionId });
    await vi.waitFor(
      async () =>
        expect(
          await article.locator('[data-lingo-translation]').allTextContents(),
        ).toEqual(['Translated: Worker recovery paragraph.']),
      { timeout: 10_000 },
    );
    expect(requests).toHaveLength(2);
    expect((await snapshot()).status).toBe('translated');
    await cdp.detach();
    await clickPopup(popup, 'Restore original');
  });
});

async function openArticle() {
  const article = await context.newPage();
  await article.goto('https://reading.test/article');
  await vi.waitFor(async () => expect((await snapshot()).status).toBe('idle'));
  return article;
}

async function openPopup(article: Page) {
  const popup = await context.newPage();
  await article.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await vi.waitFor(async () =>
    expect(await popup.locator('.hostname').textContent()).toBe('reading.test'),
  );
  return popup;
}

async function clickPopup(popup: Page, label: string) {
  const button = popup.getByRole('button', { name: label, exact: true });
  await button.waitFor({ state: 'attached', timeout: 10_000 });
  await vi.waitFor(async () => expect(await button.isEnabled()).toBe(true));
  await button.evaluate((element: HTMLButtonElement) => element.click());
}

async function snapshot(): Promise<{ status: string; pageRevision: number }> {
  return control.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://reading.test/*' });
    if (!tab) throw new Error('Missing reading tab.');
    return chrome.tabs.sendMessage(
      tab.id,
      { type: 'getPageTranslation', payload: {} },
      { frameId: 0 },
    );
  }) as Promise<{ status: string; pageRevision: number }>;
}

async function expectTextOutput(page: Page, text: string) {
  await vi.waitFor(
    async () =>
      expect(
        await page
          .locator('[data-lingo-owned="text-tools"] .output')
          .textContent(),
      ).toBe(text),
    { timeout: 10_000 },
  );
}
