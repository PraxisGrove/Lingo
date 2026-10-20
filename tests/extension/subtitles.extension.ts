import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/storage/settings-model';

declare const chrome: {
  storage: { local: { set(value: Record<string, unknown>): Promise<void> } };
};

const VIDEO = readFileSync(resolve('tests/fixtures/sample-10s.webm'));
const VTT = readFileSync(resolve('tests/fixtures/sample-en.vtt'), 'utf8');

/** Range responses make the routed video seekable. */
function videoResponse(rangeHeader: string | undefined) {
  const range = /bytes=(\d+)-(\d*)/.exec(rangeHeader ?? '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : VIDEO.length - 1;
  return {
    status: range ? 206 : 200,
    headers: {
      'content-type': 'video/webm',
      'accept-ranges': 'bytes',
      ...(range
        ? { 'content-range': `bytes ${start}-${end}/${VIDEO.length}` }
        : {}),
    },
    body: VIDEO.subarray(start, end + 1),
  };
}

let context: BrowserContext;
let server: Server;
let base: string;
let control: Page;
const translated: string[] = [];
let captionFetches = 0;

describe('installed video subtitles', () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/captions/en.vtt') {
        captionFetches += 1;
        // No CORS headers: only the extension background can read it.
        response.writeHead(200, { 'content-type': 'text/vtt' });
        response.end(VTT);
        return;
      }
      if (url.pathname === '/v1/chat/completions') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          messages: Array<{ role: string; content: string }>;
        };
        const units = JSON.parse(
          body.messages.find((message) => message.role === 'user')?.content ??
            '[]',
        ) as Array<{ id: string; text: string }>;
        translated.push(...units.map((unit) => unit.text));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translations: units.map((unit) => ({
                      id: unit.id,
                      text: `译:${unit.text}`,
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
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing server address.');
    base = `http://127.0.0.1:${address.port}`;
    const extensionPath = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1000, height: 700 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--autoplay-policy=no-user-gesture-required',
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
        });
      },
      { defaults: DEFAULT_SETTINGS, endpoint: `${base}/v1` },
    );
    await context.route('https://video.test/**', (route) =>
      new URL(route.request().url()).pathname === '/video.webm'
        ? route.fulfill(videoResponse(route.request().headers().range))
        : route.fulfill({
            contentType: 'text/html',
            body: `<html lang="en"><body style="margin:0"><video id="v" muted width="640" height="360" src="/video.webm"></video>
<script>fetch('https://cdn.test/captions/en.vtt', { mode: 'no-cors' });</script></body></html>`,
          }),
    );
    // A separate origin without CORS headers: only the background can read it.
    await context.route('https://cdn.test/**', (route) => {
      captionFetches += 1;
      return route.fulfill({ contentType: 'text/vtt', body: VTT });
    });
  });

  afterAll(async () => {
    await context?.close();
    if (server) await new Promise<void>((done) => server.close(() => done()));
  });

  it('translates a cross-origin caption file only after the reader starts it', async () => {
    const page = await context.newPage();
    await page.goto('https://video.test/');
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video && video.readyState >= 1);
    });
    const button = page.locator('[data-lingo-owned="subtitles-button"] button');
    await page.locator('video').hover();
    await vi.waitFor(async () =>
      expect(await button.textContent()).toBe('Lingo subtitles'),
    );
    await page.waitForTimeout(500);
    expect(translated).toEqual([]);

    await button.click();
    expect(await button.getAttribute('aria-pressed')).toBe('true');
    const overlay = (part: string) =>
      page.evaluate(
        (selector) =>
          document
            .querySelector('[data-lingo-owned="subtitles"]')
            ?.shadowRoot?.querySelector(selector)?.textContent ?? '',
        part,
      );
    await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      video.currentTime = 6;
    });
    await vi.waitFor(async () =>
      expect(await overlay('.translation')).toBe(
        '译:Nobody knew where it was going.',
      ),
    );
    expect(await overlay('.original')).toBe('Nobody knew where it was going.');
    const fetchesBeforeSeek = captionFetches;

    // Seeking back translates the earlier line once; rewatching sends nothing.
    const seek = (time: number) =>
      page.evaluate((target) => {
        const video = document.querySelector('video') as HTMLVideoElement;
        video.currentTime = target;
      }, time);
    await seek(1);
    await vi.waitFor(async () =>
      expect(await overlay('.translation')).toBe(
        '译:The ship left the harbour before sunrise.',
      ),
    );
    await seek(6);
    await vi.waitFor(async () =>
      expect(await overlay('.translation')).toBe(
        '译:Nobody knew where it was going.',
      ),
    );
    expect([...translated].sort()).toEqual([
      'Nobody knew where it was going.',
      'The ship left the harbour before sunrise.',
    ]);
    expect(captionFetches).toBe(fetchesBeforeSeek);

    await button.click();
    expect(await button.getAttribute('aria-pressed')).toBe('false');
    expect(await page.locator('[data-lingo-owned="subtitles"]').count()).toBe(
      0,
    );
  });

  it('translates Bilibili-style AI subtitles fetched from the subtitle CDN', async () => {
    translated.length = 0;
    await context.route('https://bili.test/**', (route) =>
      new URL(route.request().url()).pathname === '/video.webm'
        ? route.fulfill(videoResponse(route.request().headers().range))
        : route.fulfill({
            contentType: 'text/html',
            body: `<html lang="zh-CN"><body style="margin:0"><video muted width="640" height="360" src="/video.webm"></video>
<script>fetch('https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1.json', { mode: 'no-cors' });</script></body></html>`,
          }),
    );
    await context.route('https://aisubtitle.hdslb.com/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          body: [
            { from: 0, to: 2, content: '我们今天' },
            { from: 2, to: 4, content: '去海边。' },
            { from: 5, to: 8, content: '天气很好。' },
          ],
        }),
      }),
    );
    const page = await context.newPage();
    await page.goto('https://bili.test/');
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video && video.readyState >= 1);
    });
    await page.locator('video').hover();
    await page.locator('[data-lingo-owned="subtitles-button"] button').click();
    await vi.waitFor(async () =>
      expect(
        await page.evaluate(
          () =>
            document
              .querySelector('[data-lingo-owned="subtitles"]')
              ?.shadowRoot?.querySelector('.translation')?.textContent ?? '',
        ),
      ).toBe('译:我们今天去海边。'),
    );
    expect(translated[0]).toBe('我们今天去海边。');
  });
});
