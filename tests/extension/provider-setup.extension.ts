import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resources } from '../../lib/i18n/resources';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from '../../lib/storage/settings-model';
import { waitFor } from '../wait';
import { EXTENSION_ACTION_TIMEOUT } from './timeouts';

declare const chrome: {
  storage: {
    local: {
      set(value: Record<string, unknown>): Promise<void>;
      get(key: string): Promise<Record<string, unknown>>;
    };
  };
};

let context: BrowserContext;
let server: Server;
let endpoint: string;
let extensionId: string;
let options: Page;
const requests: Array<{
  method: string;
  path: string;
  model?: string;
  authorization: string | undefined;
  apiKey?: string;
}> = [];
const responseBodies: Array<Record<string, unknown>> = [];

describe('installed extension provider setup', () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost');
        if (
          request.method === 'GET' &&
          requestUrl.pathname === '/responses-reading'
        ) {
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end(
            '<html lang="en"><head><title>Responses reading</title></head><body><main><p>Read this article using the Responses protocol. Keep the original paragraph beside its translation.</p></main></body></html>',
          );
          return;
        }
        if (
          request.method === 'GET' &&
          requestUrl.pathname === '/response-gateway/v1/models'
        ) {
          requests.push({
            method: 'GET',
            path: requestUrl.pathname,
            authorization: request.headers.authorization,
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              data: [
                { id: 'group/auto-gpt-5-6-luna', display_name: 'GPT-5.6 Luna' },
                { id: 'codex/gpt-5.4', display_name: 'GPT 5.4' },
              ],
            }),
          );
          return;
        }
        if (
          request.method === 'GET' &&
          requestUrl.pathname === '/v1beta/models'
        ) {
          const apiKey = request.headers['x-goog-api-key'];
          requests.push({
            method: 'GET',
            path: requestUrl.pathname,
            authorization: request.headers.authorization,
            ...(typeof apiKey === 'string' ? { apiKey } : {}),
          });
          response.writeHead(apiKey === 'incorrect-key' ? 401 : 200, {
            'content-type': 'application/json',
          });
          response.end(
            JSON.stringify({
              models: [
                {
                  name: 'models/group/auto-gpt-5-6-luna',
                  displayName: 'GPT-5.6 Luna',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/codex/gpt-5.4',
                  displayName: 'GPT 5.4',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }),
          );
          return;
        }
        if (request.method === 'GET' && request.url === '/v1/models') {
          requests.push({
            method: 'GET',
            path: request.url,
            authorization: request.headers.authorization,
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              data: [
                { id: 'qwen3:8b', name: 'Qwen 8B' },
                { id: 'manual-model', name: 'Manual reading model' },
                { id: 'text-embedding-small', name: 'Embedding distractor' },
              ],
            }),
          );
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        if (
          request.method === 'POST' &&
          requestUrl.pathname === '/response-gateway/v1/responses'
        ) {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >;
          responseBodies.push(body);
          const units = JSON.parse(body.input as string) as Array<{
            id: string;
          }>;
          requests.push({
            method: 'POST',
            path: requestUrl.pathname,
            model: body.model as string,
            authorization: request.headers.authorization,
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              status: 'completed',
              output: [
                { type: 'reasoning', summary: [] },
                {
                  type: 'message',
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({
                        translations: units.map((unit) => ({
                          id: unit.id,
                          text: 'Hola',
                        })),
                      }),
                    },
                  ],
                },
              ],
            }),
          );
          return;
        }
        if (
          request.method === 'POST' &&
          requestUrl.pathname.startsWith('/v1beta/models/')
        ) {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as {
            contents: Array<{ parts: Array<{ text: string }> }>;
          };
          const units = JSON.parse(body.contents[0].parts[0].text) as Array<{
            id: string;
          }>;
          const apiKey = request.headers['x-goog-api-key'];
          requests.push({
            method: 'POST',
            path: requestUrl.pathname,
            authorization: request.headers.authorization,
            ...(typeof apiKey === 'string' ? { apiKey } : {}),
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          translations: units.map((unit) => ({
                            id: unit.id,
                            text: 'Hola',
                          })),
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          model: string;
          messages: Array<{ role: string; content: string }>;
        };
        const units = JSON.parse(
          body.messages.find((message) => message.role === 'user')?.content ??
            '[]',
        ) as Array<{ id: string }>;
        requests.push({
          method: request.method ?? '',
          path: request.url ?? '',
          model: body.model,
          authorization: request.headers.authorization,
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translations: units.map((unit) => ({
                      id: unit.id,
                      text: 'Hola',
                    })),
                  }),
                },
              },
            ],
          }),
        );
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local model server address.');
    }
    endpoint = `http://127.0.0.1:${address.port}/v1`;
    const extensionPath = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    context.setDefaultTimeout(EXTENSION_ACTION_TIMEOUT);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).hostname;
    options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
  });

  beforeEach(async () => {
    requests.length = 0;
    responseBodies.length = 0;
    for (const page of context.pages()) {
      if (page !== options) await page.close();
    }
  });

  afterAll(async () => {
    await context?.close();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    'en',
    'zh-CN',
  ] as const)('connects and edits a local model in %s without an API key', async (locale) => {
    const copy = resources[locale].translation;
    await options.evaluate(
      async ({ defaults, locale }) => {
        await chrome.storage.local.set({
          settings: { ...defaults, uiLocale: locale },
          providerCredentials: {},
        });
      },
      { defaults: DEFAULT_SETTINGS, locale },
    );
    await options.goto(
      `chrome-extension://${extensionId}/options.html?setup-test=${locale}#provider-heading`,
    );
    await waitFor(async () => {
      expect(await options.locator('html').getAttribute('lang')).toBe(locale);
    });
    await options
      .getByRole('button', { name: copy['providerRegion.local'], exact: true })
      .click();
    await options
      .locator('.model-provider-choice')
      .filter({ hasText: 'Ollama' })
      .click();
    await options.locator('input[name="endpoint"]').fill(endpoint);
    expect(requests).toEqual([]);
    await options
      .getByRole('button', { name: copy['modelSetup.connect'], exact: true })
      .click();
    await waitFor(async () => {
      expect(await options.locator('.model-catalog-option').count()).toBe(2);
      expect(await options.locator('.model-selected code').textContent()).toBe(
        'qwen3:8b',
      );
    });
    expect(requests).toEqual([
      { method: 'GET', path: '/v1/models', authorization: undefined },
    ]);
    expect(
      await options.locator('.model-catalog-list').textContent(),
    ).not.toContain('Embedding distractor');
    await options
      .locator('.model-catalog-option')
      .filter({ hasText: 'Manual reading model' })
      .click();
    expect(await options.locator('input[name="model"]').inputValue()).toBe(
      'manual-model',
    );
    await options
      .getByRole('button', { name: copy['modelSetup.refresh'], exact: true })
      .click();
    await waitFor(async () => {
      expect(requests).toHaveLength(2);
      expect(
        await options.locator('.model-setup').getAttribute('aria-busy'),
      ).toBe('false');
    });
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
    await options.locator('.model-summary-actions > button').click();
    await options.locator('.model-connection-settings > summary').click();
    await options.locator('input[name="name"]').fill('Local reading service');
    expect(await options.locator('input[name="model"]').inputValue()).toBe(
      'manual-model',
    );
    await options
      .getByRole('button', { name: copy['modelSetup.testSave'], exact: true })
      .click();
    await waitFor(async () => {
      expect(await options.locator('.model-ready').count()).toBe(1);
      expect(
        await options.locator('.model-saved-description strong').textContent(),
      ).toBe('Local reading service');
    });
    expect(requests[2]).toEqual({
      method: 'POST',
      path: '/v1/chat/completions',
      model: 'manual-model',
      authorization: undefined,
    });
    const first = await savedSettings();
    expect(first.setupCompleted).toBe(true);
    expect(first.providerProfiles).toHaveLength(1);
    expect(first.activeProviderProfileId).toBe(first.providerProfiles[0].id);
    expect(first.providerProfiles[0]).toMatchObject({
      model: 'manual-model',
      modelSelection: 'manual',
      models: [
        { id: 'qwen3:8b', name: 'Qwen 8B' },
        { id: 'manual-model', name: 'Manual reading model' },
      ],
    });

    await options
      .getByRole('button', {
        name: copy['modelSetup.edit'].replace(
          '{{name}}',
          'Local reading service',
        ),
        exact: true,
      })
      .click();
    expect(await options.locator('input[name="credential"]').inputValue()).toBe(
      '',
    );
    await options.locator('input[name="model"]').fill('edited-model');
    await options
      .getByRole('button', { name: copy['modelSetup.testSave'], exact: true })
      .click();
    await waitFor(async () => {
      expect(
        await options.locator('.model-saved-description small').textContent(),
      ).toBe('edited-model');
      expect(await options.locator('.model-setup-form').count()).toBe(0);
    });
    const edited = await savedSettings();
    expect(edited.providerProfiles).toHaveLength(1);
    expect(edited.providerProfiles[0].id).toBe(first.providerProfiles[0].id);
    expect(requests[3]).toEqual({
      method: 'POST',
      path: '/v1/chat/completions',
      model: 'edited-model',
      authorization: undefined,
    });
    expect(edited.providerProfiles[0].models).toEqual(
      first.providerProfiles[0].models,
    );
    expect(edited.providerProfiles[0].modelSelection).toBe('manual');
    expect(
      await options.evaluate(() =>
        chrome.storage.local.get('providerCredentials'),
      ),
    ).toEqual({
      providerCredentials: {},
    });
  });

  it('recovers custom Gemini discovery at a gateway root and saves a qualified group model', async () => {
    const copy = resources['zh-CN'].translation;
    await options.evaluate(async (defaults) => {
      await chrome.storage.local.set({
        settings: { ...defaults, uiLocale: 'zh-CN', setupCompleted: true },
        providerCredentials: {},
      });
    }, DEFAULT_SETTINGS);
    await options.goto(
      `chrome-extension://${extensionId}/options.html?custom-gemini#provider-heading`,
    );
    await options
      .getByRole('button', { name: copy['customService.add'], exact: true })
      .click();
    await options.locator('input[name="name"]').fill('Magpie gateway');
    await options.locator('select[name="protocol"]').selectOption('gemini');
    const rootEndpoint = new URL(endpoint).origin;
    await options.locator('input[name="endpoint"]').fill(rootEndpoint);
    await options.locator('input[name="credential"]').fill('incorrect-key');
    await options.locator('.model-connect-button').click();
    await waitFor(async () => {
      expect(
        await options.locator('.model-discovery-error').textContent(),
      ).toContain('HTTP 401');
    });
    expect(
      await options.locator('.model-discovery-request code').textContent(),
    ).toBe(`GET ${rootEndpoint}/v1beta/models`);
    expect(await options.locator('input[name="endpoint"]').isVisible()).toBe(
      true,
    );
    expect(await options.locator('.model-catalog-step').count()).toBe(0);
    await options
      .getByRole('button', { name: copy['modelDiscovery.retry'], exact: true })
      .click();
    await waitFor(() => expect(requests).toHaveLength(2));
    await options.locator('input[name="credential"]').fill('magpie');
    await options.locator('.model-connect-button').click();
    await waitFor(async () => {
      expect(await options.locator('.model-catalog-option').count()).toBe(2);
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/v1beta/models',
        authorization: undefined,
        apiKey: 'incorrect-key',
      },
      {
        method: 'GET',
        path: '/v1beta/models',
        authorization: undefined,
        apiKey: 'incorrect-key',
      },
      {
        method: 'GET',
        path: '/v1beta/models',
        authorization: undefined,
        apiKey: 'magpie',
      },
    ]);
    expect(await options.locator('.model-default-badge').count()).toBe(1);
    expect(['group/auto-gpt-5-6-luna', 'codex/gpt-5.4']).toContain(
      await options.locator('.model-selected code').textContent(),
    );
    await options
      .locator('.model-catalog-option')
      .filter({ hasText: 'group/auto-gpt-5-6-luna' })
      .click();
    await options
      .getByRole('button', { name: copy['modelSetup.testSave'], exact: true })
      .click();
    await waitFor(async () => {
      expect(await options.locator('.model-ready').count()).toBe(1);
    });
    expect(requests[3]).toEqual({
      method: 'POST',
      path: '/v1beta/models/group/auto-gpt-5-6-luna:generateContent',
      authorization: undefined,
      apiKey: 'magpie',
    });
    const saved = await savedSettings();
    expect(saved.providerProfiles[0]).toMatchObject({
      name: 'Magpie gateway',
      provider: 'gemini',
      endpoint: `${rootEndpoint}/v1beta`,
      model: 'group/auto-gpt-5-6-luna',
      modelSelection: 'manual',
      models: [
        { id: 'group/auto-gpt-5-6-luna', name: 'GPT-5.6 Luna' },
        { id: 'codex/gpt-5.4', name: 'GPT 5.4' },
      ],
    });
    await options
      .getByRole('button', {
        name: copy['modelSetup.edit'].replace('{{name}}', 'Magpie gateway'),
        exact: true,
      })
      .click();
    expect(await options.locator('select[name="protocol"]').inputValue()).toBe(
      'gemini',
    );
    expect(await options.locator('input[name="credential"]').inputValue()).toBe(
      '',
    );
    expect(await options.locator('input[name="endpoint"]').inputValue()).toBe(
      `${rootEndpoint}/v1beta`,
    );
    expect(
      await options
        .getByRole('link', { name: copy['modelSetup.getKey'] })
        .count(),
    ).toBe(0);
  });

  it('imports a standard Responses service and uses its saved protocol for webpage translation', async () => {
    const copy = resources.en.translation;
    await options.evaluate(async (defaults) => {
      await chrome.storage.local.set({
        settings: {
          ...defaults,
          uiLocale: 'en',
          setupCompleted: true,
          targetLanguage: 'es',
          autoTranslation: { ...defaults.autoTranslation, enabled: false },
        },
        providerCredentials: {},
      });
    }, DEFAULT_SETTINGS);
    await options.goto(
      `chrome-extension://${extensionId}/options.html?custom-responses#provider-heading`,
    );
    await options
      .getByRole('button', { name: copy['customService.add'], exact: true })
      .click();
    await options.locator('input[name="name"]').fill('Responses gateway');
    await options
      .locator('select[name="protocol"]')
      .selectOption('openai-responses');
    const responsesEndpoint = `${new URL(endpoint).origin}/response-gateway/v1`;
    await options.locator('input[name="endpoint"]').fill(responsesEndpoint);
    await options.locator('input[name="credential"]').fill('responses-key');
    await options.locator('.model-connect-button').click();
    await waitFor(async () => {
      expect(await options.locator('.model-catalog-option').count()).toBe(2);
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/response-gateway/v1/models',
        authorization: 'Bearer responses-key',
      },
    ]);
    await options
      .locator('.model-catalog-option')
      .filter({ hasText: 'group/auto-gpt-5-6-luna' })
      .click();
    await options
      .getByRole('button', { name: copy['modelSetup.testSave'], exact: true })
      .click();
    await waitFor(async () => {
      expect(await options.locator('.model-ready').count()).toBe(1);
    });
    expect((await savedSettings()).providerProfiles[0]).toMatchObject({
      provider: 'openai-responses',
      endpoint: responsesEndpoint,
      model: 'group/auto-gpt-5-6-luna',
      modelSelection: 'manual',
    });
    const article = await context.newPage();
    await article.goto(`${new URL(endpoint).origin}/responses-reading`);
    const popup = await context.newPage();
    await article.bringToFront();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await waitFor(async () => {
      expect(await popup.locator('.hostname').textContent()).toBe('127.0.0.1');
    });
    const translateButton = popup.getByRole('button', {
      name: copy['popup.action.translatePage'],
      exact: true,
    });
    await waitFor(async () =>
      expect(await translateButton.isEnabled()).toBe(true),
    );
    await translateButton.evaluate((button: HTMLButtonElement) =>
      button.click(),
    );
    await waitFor(async () => {
      expect(
        await article.locator('[data-lingo-translation]').textContent(),
      ).toBe('Hola');
    });
    expect(requests.slice(1)).toEqual([
      {
        method: 'POST',
        path: '/response-gateway/v1/responses',
        model: 'group/auto-gpt-5-6-luna',
        authorization: 'Bearer responses-key',
      },
      {
        method: 'POST',
        path: '/response-gateway/v1/responses',
        model: 'group/auto-gpt-5-6-luna',
        authorization: 'Bearer responses-key',
      },
    ]);
    for (const body of responseBodies) {
      expect(body).toMatchObject({
        model: 'group/auto-gpt-5-6-luna',
        store: false,
        stream: false,
        text: { format: { type: 'json_object' } },
      });
      expect(typeof body.instructions).toBe('string');
      expect(body).not.toHaveProperty('messages');
      expect(body).not.toHaveProperty('previous_response_id');
    }
    await options
      .getByRole('button', {
        name: copy['modelSetup.edit'].replace('{{name}}', 'Responses gateway'),
        exact: true,
      })
      .click();
    expect(await options.locator('select[name="protocol"]').inputValue()).toBe(
      'openai-responses',
    );
  });
});

async function savedSettings(): Promise<ExtensionSettings> {
  return options.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    return stored.settings as ExtensionSettings;
  });
}
