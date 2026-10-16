import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Worker } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

declare const chrome: {
  runtime: {
    getManifest(): { permissions: string[] };
    getContexts(filter: object): Promise<unknown[]>;
    sendMessage(message: unknown): Promise<unknown>;
  };
  offscreen: {
    createDocument(options: object): Promise<void>;
  };
};

let context: BrowserContext;
let worker: Worker;

describe('installed on-device translation bridge', () => {
  beforeAll(async () => {
    const extensionPath = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
  });

  afterAll(async () => {
    await context?.close();
  });

  it('answers availability through the offscreen document', async () => {
    const result = await worker.evaluate(async () => {
      await chrome.offscreen.createDocument({
        url: '/offscreen.html',
        reasons: ['DOM_PARSER'],
        justification: 'Extension acceptance test.',
      });
      return {
        permissions: chrome.runtime.getManifest().permissions,
        contexts: (
          await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
          })
        ).length,
        response: await chrome.runtime.sendMessage({
          target: 'lingo-built-in-translation',
          request: {
            kind: 'availability',
            pair: { sourceLanguage: 'en', targetLanguage: 'zh' },
          },
        }),
      };
    });
    expect(result.permissions).toContain('offscreen');
    expect(result.contexts).toBe(1);
    // Model availability depends on the machine; the bridge contract does not.
    expect(result.response).toSatisfy(
      (response: { ok: boolean; result?: string; category?: string }) =>
        response.ok
          ? [
              'unavailable',
              'downloadable',
              'downloading',
              'available',
            ].includes(response.result ?? '')
          : response.category === 'unsupported',
    );
  });
});
