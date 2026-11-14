import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resources } from '../../lib/i18n/resources';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';
import { EXTENSION_ACTION_TIMEOUT } from './timeouts';

declare const chrome: {
  storage: {
    local: {
      set(value: Record<string, unknown>): Promise<void>;
      get(key?: string): Promise<Record<string, unknown>>;
    };
  };
  tabs: {
    query(query: object): Promise<Array<{ id: number }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
};

type Seen = {
  method: string;
  path: string;
  query: string;
  apiKey?: string;
  authorization?: string;
  route?: string;
  token?: string;
};

let context: BrowserContext;
let server: Server;
let base: string;
let options: Page;
const seen: Seen[] = [];
const copy = resources.en.translation;

describe('installed gateway service setup', () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/article') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(
          '<html lang="en"><main><p>The gateway translates this paragraph for the reader.</p></main></html>',
        );
        return;
      }
      if (!url.pathname.startsWith('/openai/')) {
        response.writeHead(404);
        response.end();
        return;
      }
      seen.push({
        method: request.method ?? '',
        path: url.pathname,
        query: url.search,
        apiKey: request.headers['api-key'] as string | undefined,
        authorization: request.headers.authorization,
        route: request.headers['x-route'] as string | undefined,
        token: request.headers['x-gateway-token'] as string | undefined,
      });
      if (url.pathname.endsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: 'gpt-gw' }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages: Array<{ role: string; content: string }>;
      };
      const units = JSON.parse(
        body.messages.find((message) => message.role === 'user')?.content ??
          '[]',
      ) as Array<{ id: string; text: string }>;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: units.map((unit) => ({
                    id: unit.id,
                    text: `GW: ${unit.text}`,
                  })),
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing gateway address.');
    base = `http://127.0.0.1:${address.port}`;
    const extensionPath = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1100, height: 1200 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    context.setDefaultTimeout(EXTENSION_ACTION_TIMEOUT);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).hostname;
    options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(async (defaults) => {
      await chrome.storage.local.set({
        settings: {
          ...defaults,
          uiLocale: 'en',
          setupCompleted: true,
          translationCacheEnabled: false,
          autoTranslation: { ...defaults.autoTranslation, enabled: false },
        },
        providerCredentials: {},
      });
    }, DEFAULT_SETTINGS);
    await options.goto(
      `chrome-extension://${extensionId}/options.html#provider-heading`,
    );
  });

  afterAll(async () => {
    await context?.close();
    if (server) await new Promise<void>((done) => server.close(() => done()));
  });

  it('saves an Azure-style gateway with api-key auth and a secret header kept out of settings', async () => {
    await options
      .getByRole('button', { name: copy['customService.add'], exact: true })
      .click();
    await options.locator('input[name="name"]').fill('Team gateway');
    await options
      .locator('input[name="endpoint"]')
      .fill(`${base}/openai/deployments/gw?api-version=2024-10-21`);
    await options.locator('input[name="credential"]').fill('gw-key');
    await options.locator('.model-connection-settings > summary').click();
    await options
      .locator('select[name="credentialHeader"]')
      .selectOption('api-key');
    const add = options.getByRole('button', {
      name: `+ ${copy['modelSetup.headers.add']}`,
    });
    await add.click();
    await options.locator('input[name="header-name-0"]').fill('X-Route');
    await options.locator('input[name="header-value-0"]').fill('fast');
    await add.click();
    await options
      .locator('input[name="header-name-1"]')
      .fill('X-Gateway-Token');
    await options.locator('input[name="header-value-1"]').fill('top-secret');
    expect(
      await options
        .locator('input[name="header-value-1"]')
        .getAttribute('type'),
    ).toBe('password');
    await options.locator('.model-connect-button').click();
    await vi.waitFor(async () =>
      expect(await options.locator('.model-catalog-option').count()).toBe(1),
    );
    await options
      .getByRole('button', { name: copy['modelSetup.testSave'], exact: true })
      .click();
    await vi.waitFor(async () =>
      expect(await options.locator('.model-ready').count()).toBe(1),
    );
    const expected = {
      query: '?api-version=2024-10-21',
      apiKey: 'gw-key',
      authorization: undefined,
      route: 'fast',
      token: 'top-secret',
    };
    expect(seen[0]).toMatchObject({
      method: 'GET',
      path: '/openai/deployments/gw/models',
      ...expected,
    });
    expect(seen[1]).toMatchObject({
      method: 'POST',
      path: '/openai/deployments/gw/chat/completions',
      ...expected,
    });
    const stored = await options.evaluate(() => chrome.storage.local.get());
    expect(JSON.stringify(stored.settings)).not.toContain('top-secret');
    expect(JSON.stringify(stored.settings)).toContain('X-Gateway-Token');
    expect(JSON.stringify(stored.providerCredentials)).toContain('top-secret');

    const page = await context.newPage();
    await page.goto(`${base}/article`);
    seen.length = 0;
    await options.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url: `${url}/*` });
      await chrome.tabs.sendMessage(tab.id, {
        type: 'startPageTranslation',
        payload: {
          targetLanguage: 'zh-CN',
          displayMode: 'bilingual',
          translateImmediately: true,
        },
      });
    }, base);
    await vi.waitFor(async () =>
      expect(
        await page.locator('[data-lingo-translation]').first().textContent(),
      ).toContain('GW: The gateway translates'),
    );
    expect(seen[0]).toMatchObject({
      path: '/openai/deployments/gw/chat/completions',
      ...expected,
    });
  });
});
