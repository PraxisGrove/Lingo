import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupportedUiLocale } from '../../lib/i18n/locales';
import { resources } from '../../lib/i18n/resources';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from '../../lib/storage/settings-model';
import { EXTENSION_ACTION_TIMEOUT } from './timeouts';
import { waitFor } from './wait';

declare const chrome: {
  storage: {
    local: {
      set(value: Record<string, unknown>): Promise<void>;
      get(key: string): Promise<Record<string, unknown>>;
    };
  };
  runtime: {
    getManifest(): {
      action: { default_popup?: string };
      side_panel: { default_path: string };
      permissions: string[];
    };
  };
  windows: { getCurrent(): Promise<{ id: number }> };
  tabs: {
    query(query: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<Array<{ id: number; url: string }>>;
  };
  sidePanel: {
    getPanelBehavior(): Promise<{ openPanelOnActionClick: boolean }>;
    getOptions(options: object): Promise<{ enabled: boolean; path: string }>;
    open(options: { windowId: number }): Promise<void>;
  };
};

let context: BrowserContext;
let control: Page;
let extensionId: string;
let server: Server;
let endpoint: string;
let failNextTest = false;
let blockNextList = false;
let releaseList: (() => void) | undefined;
const requests: Array<{
  method: string;
  path: string;
  model?: string;
  texts?: string[];
}> = [];
const copy = resources.en.translation;

describe('installed native reading sidebar', () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      try {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (request.method === 'GET' && path === '/v1/models') {
          requests.push({ method: 'GET', path });
          if (blockNextList) {
            blockNextList = false;
            await new Promise<void>((resolve) => {
              releaseList = resolve;
              response.once('close', resolve);
            });
          }
          if (response.destroyed) return;
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              data: [
                { id: 'qwen3:8b', name: 'Local reading model' },
                { id: 'manual-model', name: 'Another reading model' },
              ],
            }),
          );
          return;
        }
        if (request.method === 'POST' && path === '/v1/chat/completions') {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString()) as {
            model: string;
            messages: Array<{ role: string; content: string }>;
          };
          const units = JSON.parse(
            body.messages.find((message) => message.role === 'user')?.content ??
              '[]',
          ) as Array<{ id: string; text: string }>;
          requests.push({
            method: 'POST',
            path,
            model: body.model,
            texts: units.map((unit) => unit.text),
          });
          if (
            failNextTest &&
            units.some((unit) => unit.id === 'connection-test')
          ) {
            failNextTest = false;
            response.writeHead(401, { 'content-type': 'application/json' });
            response.end(
              JSON.stringify({
                error: { message: 'Local test key rejected.' },
              }),
            );
            return;
          }
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      translations: units.map((unit) => ({
                        id: unit.id,
                        text: `Translated: ${unit.text}`,
                      })),
                    }),
                  },
                },
              ],
            }),
          );
          return;
        }
        response.writeHead(404);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local sidebar model server address.');
    endpoint = `http://127.0.0.1:${address.port}/v1`;
    const extensionPath = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 390, height: 840 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // Classic scrollbars change the usable width of the document and make
        // horizontal-fit assertions depend on the host scrollbar style.
        '--hide-scrollbars',
      ],
    });
    context.setDefaultTimeout(EXTENSION_ACTION_TIMEOUT);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).hostname;
    control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/options.html`);
    await context.route('https://*-reading.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html lang="en"><main><p>The library opens in the morning. Readers can find books or use the tables.</p></main></html>',
      }),
    );
  });

  beforeEach(async () => {
    releaseList?.();
    releaseList = undefined;
    requests.length = 0;
    failNextTest = false;
    blockNextList = false;
    for (const page of context.pages()) {
      if (page !== control) await page.close();
    }
    await control.evaluate(async (defaults) => {
      await chrome.storage.local.set({
        settings: {
          ...defaults,
          uiLocale: 'en',
          sourceLanguage: 'en',
          targetLanguage: 'zh-CN',
          setupCompleted: true,
          translationCacheEnabled: false,
          autoTranslation: { ...defaults.autoTranslation, enabled: false },
        },
        providerCredentials: {},
      });
    }, DEFAULT_SETTINGS);
  });

  afterAll(async () => {
    releaseList?.();
    await context?.close();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('binds the toolbar to the native panel and opens it on a user gesture', async () => {
    const configured = await control.evaluate(async () => ({
      manifest: chrome.runtime.getManifest(),
      behavior: await chrome.sidePanel.getPanelBehavior(),
      options: await chrome.sidePanel.getOptions({}),
      windowId: (await chrome.windows.getCurrent()).id,
    }));
    expect(configured.manifest.action.default_popup).toBeUndefined();
    expect(configured.manifest.side_panel.default_path).toBe('sidepanel.html');
    expect(configured.manifest.permissions).toContain('sidePanel');
    expect(configured.behavior.openPanelOnActionClick).toBe(true);
    expect(configured.options).toMatchObject({
      enabled: true,
      path: 'sidepanel.html',
    });
    await control.evaluate((windowId) => {
      const probe = document.createElement('button');
      probe.id = 'open-native-panel';
      probe.textContent = 'Open native panel';
      probe.addEventListener('click', () => {
        void chrome.sidePanel.open({ windowId }).then(
          () => {
            probe.dataset.result = 'opened';
          },
          () => {
            probe.dataset.result = 'failed';
          },
        );
      });
      document.body.append(probe);
    }, configured.windowId);
    await control.locator('#open-native-panel').click();
    await waitFor(async () => {
      expect(
        await control.locator('#open-native-panel').getAttribute('data-result'),
      ).toBe('opened');
    });
  });

  it('updates page identity when switching tabs or navigating without reopening the panel', async () => {
    const first = await context.newPage();
    await first.goto('https://first-reading.test/');
    const panel = await context.newPage();
    await first.bringToFront();
    // This renders the panel document directly for functional assertions;
    // the preceding check validates the native API, not OS-level placement.
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await waitFor(async () => {
      expect(await panel.locator('.hostname').textContent()).toBe(
        'first-reading.test',
      );
    });
    const second = await context.newPage();
    await second.goto('https://second-reading.test/');
    await second.bringToFront();
    await waitFor(async () => {
      expect(await panel.locator('.hostname').textContent()).toBe(
        'second-reading.test',
      );
    });
    await second.goto('https://third-reading.test/');
    await waitFor(async () => {
      expect(await panel.locator('.hostname').textContent()).toBe(
        'third-reading.test',
      );
    });
    expect(await panel.locator('html').getAttribute('data-surface')).toBe(
      'sidepanel',
    );
    const size = await panel.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(size.width).toBeLessThanOrEqual(size.viewport);
  });

  it('connects, imports, tests, and saves a service in the sidebar before translating the same page', async () => {
    await control.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({
        settings: { ...(settings as ExtensionSettings), setupCompleted: false },
      });
    });
    const { reading, panel } = await openReadingPanel();
    const activeTab = await currentTab();
    const openedPages: Page[] = [];
    const pageCreated = (page: Page) => openedPages.push(page);
    context.on('page', pageCreated);
    await panel.locator('.notice-no-service .primary-action').click();
    await chooseLocalService(panel);
    expect(requests).toEqual([]);
    await panel.locator('.model-connect-button').click();
    await waitFor(async () => {
      expect(await panel.locator('.model-catalog-option').count()).toBe(2);
      expect(await panel.locator('.model-selected code').textContent()).toBe(
        'qwen3:8b',
      );
    });
    expect(requests).toEqual([{ method: 'GET', path: '/v1/models' }]);
    await panel
      .getByRole('button', { name: copy['modelSetup.testSave'] })
      .click();
    await waitFor(async () => {
      expect(await panel.locator('.main-command').count()).toBe(1);
      expect(await panel.locator('.hostname').textContent()).toBe(
        'first-reading.test',
      );
    });
    const saved = await control.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return settings as ExtensionSettings;
    });
    expect(saved.setupCompleted).toBe(true);
    expect(saved.providerProfiles).toHaveLength(1);
    expect(saved.activeProviderProfileId).toBe(saved.providerProfiles[0].id);
    expect(saved.providerProfiles[0].model).toBe('qwen3:8b');
    expect(requests[1]).toEqual({
      method: 'POST',
      path: '/v1/chat/completions',
      model: 'qwen3:8b',
      texts: ['Hello'],
    });
    expect(openedPages).toEqual([]);
    expect(await currentTab()).toEqual(activeTab);
    await panel.locator('.main-command').click();
    await waitFor(async () => {
      expect(await reading.locator('[data-lingo-translation]').count()).toBe(1);
      expect(
        await reading.locator('[data-lingo-translation]').textContent(),
      ).toContain('Translated: The library opens in the morning.');
    });
    expect(requests.length).toBeGreaterThan(2);
    expect(
      requests.slice(2).every((request) => request.model === 'qwen3:8b'),
    ).toBe(true);
    const translationRequestCount = requests.length;
    await panel.locator('.reading-appearance-shortcut').click();
    await waitFor(async () => {
      expect(await panel.locator('.reading-appearance').isVisible()).toBe(true);
    });
    await panel
      .locator('.reading-appearance-color select')
      .selectOption('custom');
    await panel
      .locator('.reading-appearance-color-picker input')
      .fill('#226688');
    await waitFor(async () => {
      expect(
        await reading
          .locator('[data-lingo-translation]')
          .evaluate((element) => getComputedStyle(element).color),
      ).toBe('rgb(34, 102, 136)');
    });
    await backToPage(panel);
    await waitFor(async () => {
      expect(await panel.locator('.hostname').textContent()).toBe(
        'first-reading.test',
      );
    });
    // Style changes may trigger DOM observation, but must never translate again.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(requests).toHaveLength(translationRequestCount);
    await panel.locator('.page-preferences > summary').click();
    await panel.locator('.service-manage').click();
    await waitFor(async () => {
      expect(await panel.locator('.model-saved-service').count()).toBe(1);
    });
    expect(openedPages).toEqual([]);
    expect(await currentTab()).toEqual(activeTab);
    context.off('page', pageCreated);
  });

  it('keeps an unsaved service draft while the active reading tab switches and navigates', async () => {
    const { panel } = await openReadingPanel();
    await panel.locator('.notice-no-service .primary-action').click();
    await chooseLocalService(panel);
    await panel.locator('input[name="credential"]').fill('draft-local-key');
    const second = await context.newPage();
    await second.goto('https://second-reading.test/');
    await second.bringToFront();
    await second.goto('https://third-reading.test/');
    await panel.locator('.model-connect-button').click();
    await waitFor(async () => {
      expect(await panel.locator('.model-catalog-option').count()).toBe(2);
    });
    await panel
      .locator('.model-catalog-option')
      .filter({ hasText: 'Another reading model' })
      .click();
    // Returning to connection settings must retain the unsaved endpoint and key.
    await panel.locator('.model-summary-actions > button').click();
    await waitFor(async () => {
      const bounds = await panel.evaluate(() => ({
        keyTop: document
          .querySelector('input[name="credential"]')
          ?.getBoundingClientRect().top,
        toolbarBottom: document
          .querySelector('.settings-toolbar')
          ?.getBoundingClientRect().bottom,
      }));
      expect(bounds.keyTop).toBeGreaterThanOrEqual(bounds.toolbarBottom ?? 0);
    });
    expect(await panel.locator('input[name="endpoint"]').inputValue()).toBe(
      endpoint,
    );
    expect(await panel.locator('input[name="credential"]').inputValue()).toBe(
      'draft-local-key',
    );
    const credentials = await control.evaluate(async () => {
      const { providerCredentials } = await chrome.storage.local.get(
        'providerCredentials',
      );
      return providerCredentials;
    });
    expect(credentials).toEqual({});
    const importedRequests = structuredClone(requests);
    await backToPage(panel);
    await waitFor(async () => {
      expect(await panel.locator('.hostname').textContent()).toBe(
        'third-reading.test',
      );
    });
    await panel.locator('.notice-no-service .primary-action').click();
    expect(await panel.locator('input[name="endpoint"]').inputValue()).toBe(
      endpoint,
    );
    expect(await panel.locator('input[name="credential"]').inputValue()).toBe(
      'draft-local-key',
    );
    expect(await panel.locator('input[name="model"]').inputValue()).toBe(
      'manual-model',
    );
    expect(await panel.locator('.model-catalog-option').count()).toBe(2);
    await panel
      .getByRole('link', { name: copy['navigation.reading'], exact: true })
      .click();
    await waitFor(async () => {
      expect(await panel.locator('.reading-appearance').isVisible()).toBe(true);
    });
    await panel
      .getByRole('link', { name: copy['navigation.services'], exact: true })
      .click();
    expect(await panel.locator('input[name="endpoint"]').inputValue()).toBe(
      endpoint,
    );
    expect(await panel.locator('input[name="credential"]').inputValue()).toBe(
      'draft-local-key',
    );
    expect(await panel.locator('input[name="model"]').inputValue()).toBe(
      'manual-model',
    );
    expect(requests).toEqual(importedRequests);
    expect(
      await control.evaluate(
        async () =>
          (await chrome.storage.local.get('providerCredentials'))
            .providerCredentials,
      ),
    ).toEqual({});
  });

  it('shows a failed translation test beside its action and keeps the draft for a successful retry', async () => {
    const { panel } = await openReadingPanel();
    await panel.locator('.notice-no-service .primary-action').click();
    await chooseLocalService(panel);
    await panel.locator('input[name="credential"]').fill('local-contract-key');
    await panel.locator('.model-connect-button').click();
    await panel
      .locator('.model-catalog-option')
      .filter({ hasText: 'Another reading model' })
      .click();
    failNextTest = true;
    await panel
      .getByRole('button', { name: copy['modelSetup.testSave'] })
      .click();
    const error = panel.locator('.model-setup-status');
    await waitFor(async () => {
      expect(await error.textContent()).toBe(
        copy['modelSetup.testErrors.authentication'],
      );
      expect(
        await error.evaluate((element) => document.activeElement === element),
      ).toBe(true);
      const position = await error.evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        bottom: element.getBoundingClientRect().bottom,
        viewport: innerHeight,
        toolbarBottom:
          document.querySelector('.settings-toolbar')?.getBoundingClientRect()
            .bottom ?? 0,
      }));
      expect(position.top).toBeGreaterThanOrEqual(position.toolbarBottom);
      // Sub-pixel layout rounding differs between font rasterizers; one pixel of
      // slack keeps the visibility contract without encoding host metrics.
      expect(position.bottom).toBeLessThanOrEqual(position.viewport + 1);
    });
    expect(await panel.locator('.model-selected code').textContent()).toBe(
      'manual-model',
    );
    expect(
      await control.evaluate(
        async () => (await chrome.storage.local.get('settings')).settings,
      ),
    ).toMatchObject({ providerProfiles: [] });
    expect(
      await control.evaluate(
        async () =>
          (await chrome.storage.local.get('providerCredentials'))
            .providerCredentials,
      ),
    ).toEqual({});
    await panel.locator('.model-summary-actions > button').click();
    expect(await panel.locator('input[name="credential"]').inputValue()).toBe(
      'local-contract-key',
    );
    expect(await panel.locator('input[name="model"]').inputValue()).toBe(
      'manual-model',
    );
    await panel
      .getByRole('button', { name: copy['modelSetup.testSave'] })
      .click();
    await waitFor(async () => {
      expect(await panel.locator('.main-command').isVisible()).toBe(true);
    });
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'POST',
      'POST',
    ]);
  });

  it('keeps an unfinished model import when returning to the page and reopening settings', async () => {
    const { panel } = await openReadingPanel();
    const activeTab = await currentTab();
    await panel.locator('.notice-no-service .primary-action').click();
    await chooseLocalService(panel);
    blockNextList = true;
    await panel.locator('.model-connect-button').click();
    await waitFor(async () => {
      expect(requests).toEqual([{ method: 'GET', path: '/v1/models' }]);
      expect(
        await panel.locator('.model-setup').getAttribute('aria-busy'),
      ).toBe('true');
    });
    await backToPage(panel);
    await panel.locator('.notice-no-service .primary-action').click();
    expect(await panel.locator('.model-setup').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(await panel.locator('.model-connect-button').isDisabled()).toBe(
      true,
    );
    expect(await panel.locator('input[name="endpoint"]').inputValue()).toBe(
      endpoint,
    );
    expect(requests).toEqual([{ method: 'GET', path: '/v1/models' }]);
    releaseList?.();
    releaseList = undefined;
    await waitFor(async () => {
      expect(await panel.locator('.model-catalog-option').count()).toBe(2);
      expect(
        await panel.locator('.model-setup').getAttribute('aria-busy'),
      ).toBe('false');
    });
    expect(requests).toEqual([{ method: 'GET', path: '/v1/models' }]);
    expect(await currentTab()).toEqual(activeTab);
  });

  it.each([
    ['en', 320],
    ['en', 390],
    ['de', 320],
    ['de', 390],
  ] as const)('opens %s settings within a %ipx sidebar without another tab', async (locale, width) => {
    const localeCopy = resources[locale].translation;
    await control.evaluate(async (locale) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({
        settings: { ...(settings as ExtensionSettings), uiLocale: locale },
      });
    }, locale);
    const { panel } = await openReadingPanel();
    await panel.setViewportSize({ width, height: 840 });
    const activeTab = await currentTab();
    const pages = context.pages();
    await panel
      .getByRole('button', { name: localeCopy['common.openSettings'] })
      .click();
    await waitFor(async () => {
      expect(await panel.locator('.settings-shell').count()).toBe(1);
    });
    expect(context.pages()).toEqual(pages);
    expect(await currentTab()).toEqual(activeTab);
    await assertFits(panel);
    await panel
      .getByRole('link', {
        name: localeCopy['navigation.reading'],
        exact: true,
      })
      .click();
    await waitFor(async () => {
      expect(await panel.locator('.reading-appearance').isVisible()).toBe(true);
    });
    await assertFits(panel);
    await panel
      .getByRole('link', {
        name: localeCopy['navigation.services'],
        exact: true,
      })
      .click();
    await chooseLocalService(panel, locale);
    await assertFits(panel);
    await panel.locator('.model-connect-button').click();
    await waitFor(async () => {
      expect(await panel.locator('.model-catalog-option').count()).toBe(2);
    });
    await assertFits(panel);
    expect(context.pages()).toEqual(pages);
    expect(await currentTab()).toEqual(activeTab);
    await backToPage(panel, locale);
    await waitFor(async () => {
      expect(await panel.locator('.hostname').count()).toBe(1);
    });
    await assertFits(panel);
  });
});

async function openReadingPanel() {
  const reading = await context.newPage();
  await reading.goto('https://first-reading.test/');
  const panel = await context.newPage();
  await reading.bringToFront();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await waitFor(async () => {
    expect(await panel.locator('.hostname').textContent()).toBe(
      'first-reading.test',
    );
  });
  return { reading, panel };
}

async function chooseLocalService(
  panel: Page,
  locale: SupportedUiLocale = 'en',
) {
  await panel
    .getByRole('button', {
      name: resources[locale].translation['providerRegion.local'],
      exact: true,
    })
    .click();
  await panel
    .locator('.model-provider-choice')
    .filter({ hasText: 'Ollama' })
    .click();
  await panel.locator('input[name="endpoint"]').fill(endpoint);
}

async function currentTab() {
  return control.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab ? { id: tab.id, url: tab.url } : null;
  });
}

async function backToPage(panel: Page, locale: SupportedUiLocale = 'en') {
  await panel
    .getByRole('button', {
      name: resources[locale].translation['sidebar.backToPage'],
    })
    .click();
}

async function assertFits(panel: Page) {
  // Sidebar layouts must never scroll horizontally. `clientWidth` excludes the
  // scrollbar gutter, and the one-pixel slack absorbs sub-pixel rounding so the
  // contract does not depend on the runner's font metrics.
  const size = await panel.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
}
