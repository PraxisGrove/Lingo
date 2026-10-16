import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';

declare const chrome: {
  storage: {
    local: {
      set(value: Record<string, unknown>): Promise<void>;
      get(key: string): Promise<Record<string, unknown>>;
    };
  };
};

const ARTICLE =
  '<html lang="en"><body><main><p id="story">The sailors were tired after the long voyage at sea. When the captain ignored their complaints about the food and the weather, a mutiny began below the deck before the morning came. Everyone on the ship could hear the noise from the lower rooms, and the officers ran to the stairs to see what had happened to the people who worked there every day.</p></main></body></html>';

let context: BrowserContext;
let control: Page;
let server: Server;
let endpoint: string;
const requested: string[] = [];

describe('installed vocabulary highlighting', () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
        messages?: Array<{ role: string; content: string }>;
      };
      const units = JSON.parse(
        body.messages?.find((message) => message.role === 'user')?.content ??
          '[]',
      ) as Array<{ id: string; text: string }>;
      requested.push(...units.map((unit) => unit.text));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: units.map((unit) => ({
                    id: unit.id,
                    text: unit.text === 'mutiny' ? '兵变' : `译:${unit.text}`,
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
      throw new Error('Missing local model address.');
    endpoint = `http://127.0.0.1:${address.port}/v1`;
    const extensionPath = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1000, height: 800 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    context.setDefaultTimeout(10_000);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).hostname;
    control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/options.html`);
    await control.evaluate(
      async ({ defaults, endpoint }) => {
        await chrome.storage.local.set({
          settings: {
            ...defaults,
            uiLocale: 'en',
            targetLanguage: 'zh-CN',
            setupCompleted: true,
            autoTranslation: { ...defaults.autoTranslation, enabled: false },
            providerProfiles: [
              {
                id: 'local',
                name: 'Local model',
                provider: 'openai-compatible',
                endpoint,
                model: 'reader',
              },
            ],
            activeProviderProfileId: 'local',
          },
          providerCredentials: {},
          vocabulary: { enabled: true, vocabularySize: 5000 },
        });
      },
      { defaults: DEFAULT_SETTINGS, endpoint },
    );
    await context.route('https://vocabulary-reading.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: ARTICLE }),
    );
  });

  afterAll(async () => {
    await context?.close();
    if (server) await new Promise<void>((done) => server.close(() => done()));
  });

  it('highlights rare words, glosses them on hover only, and forgets known words', async () => {
    const page = await context.newPage();
    await page.goto('https://vocabulary-reading.test/');
    const highlighted = () =>
      page.evaluate(() => {
        const highlight = (
          CSS as typeof CSS & { highlights: HighlightRegistry }
        ).highlights.get('lingo-word');
        return highlight
          ? [...highlight].map((range) => range.toString().toLowerCase())
          : [];
      });
    await vi.waitFor(async () =>
      expect(await highlighted()).toContain('mutiny'),
    );
    expect(requested).toEqual([]);
    const box = await page.evaluate(() => {
      const text = document.getElementById('story')?.firstChild as Text;
      const range = document.createRange();
      const index = text.data.indexOf('mutiny');
      range.setStart(text, index + 2);
      range.setEnd(text, index + 3);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    const card = page.locator('[data-lingo-owned="vocabulary-card"] section');
    await vi.waitFor(async () =>
      expect(await card.textContent()).toContain('兵变'),
    );
    expect(requested).toEqual(['mutiny']);
    await card.getByRole('button', { name: 'Mark as known' }).click();
    await vi.waitFor(async () =>
      expect(await highlighted()).not.toContain('mutiny'),
    );
    const stored = await control.evaluate(() =>
      chrome.storage.local.get('vocabulary'),
    );
    expect(stored.vocabulary).toMatchObject({ knownWords: ['mutiny'] });
  });
});
