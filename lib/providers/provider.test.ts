import { describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../storage/settings-model';
import { resolveTranslationQuality } from '../translation/quality';
import { createProvider, ProviderError } from './provider';

const cases: Array<{
  profile: ProviderProfile;
  response: unknown;
  expectedPath: string;
  expectedText: string;
}> = [
  {
    profile: {
      id: 'o',
      name: 'OpenAI',
      provider: 'openai-compatible',
      endpoint: 'https://llm.example/v1',
      model: 'gpt-4.1-mini',
    },
    response: {
      choices: [
        { message: { content: '{"translations":[{"id":"1","text":"Hola"}]}' } },
      ],
    },
    expectedPath: '/v1/chat/completions',
    expectedText: 'Hola',
  },
  {
    profile: {
      id: 'd',
      name: 'DeepL',
      provider: 'deepl',
      endpoint: 'https://api-free.deepl.com',
    },
    response: { translations: [{ text: 'Hallo' }] },
    expectedPath: '/v2/translate',
    expectedText: 'Hallo',
  },
  {
    profile: {
      id: 'g',
      name: 'Google',
      provider: 'google-cloud',
      endpoint: 'https://translation.googleapis.com',
    },
    response: { data: { translations: [{ translatedText: 'Bonjour' }] } },
    expectedPath: '/language/translate/v2',
    expectedText: 'Bonjour',
  },
  {
    profile: {
      id: 'a',
      name: 'Azure',
      provider: 'azure-translator',
      endpoint: 'https://api.cognitive.microsofttranslator.com',
      region: 'eastus',
    },
    response: [{ translations: [{ text: 'Ciao', to: 'it' }] }],
    expectedPath: '/translate',
    expectedText: 'Ciao',
  },
];

describe.each(cases)('$profile.provider provider contract', ({
  profile,
  response,
  expectedPath,
  expectedText,
}) => {
  it('translates through the common provider interface', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );
    const provider = createProvider(profile, 'secret', fetch);
    await expect(
      provider.translateBatch({
        sourceLanguage: 'auto',
        targetLanguage: 'es',
        quality: resolveTranslationQuality(),
        units: [{ id: '1', number: 1, text: 'Hello' }],
      }),
    ).resolves.toEqual([{ id: '1', text: expectedText }]);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe(
      expectedPath,
    );
  });
});

describe('provider errors', () => {
  it('repairs fenced structured output and sends glossary constraints to compatible models', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\\n{"translations":[{"id":"1","text":"Hola"}]}\\n```',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createProvider(cases[0].profile, 'secret', fetch);

    await expect(
      provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        quality: resolveTranslationQuality({
          instruction: 'Use a friendly tone.',
          glossary: [{ source: 'Lingo', target: 'Lingo' }],
        }),
        context: {
          pageTitle: 'Welcome',
          units: [{ id: '2', number: 2, text: 'Context.' }],
        },
        units: [{ id: '1', number: 1, text: 'Hello' }],
      }),
    ).resolves.toEqual([{ id: '1', text: 'Hola' }]);

    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('Lingo');
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('Welcome');
  });

  it('passes a configured DeepL glossary ID through its native request field', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ translations: [{ text: 'Hallo' }] }), {
        status: 200,
      }),
    );
    const provider = createProvider(
      { ...cases[1].profile, nativeGlossaryId: 'glossary-1' },
      'secret',
      fetch,
    );

    await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'de',
      quality: resolveTranslationQuality(),
      units: [{ id: '1', number: 1, text: 'Hello' }],
    });

    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain(
      '"glossary_id":"glossary-1"',
    );
  });

  it.each([
    [401, 'authentication'],
    [429, 'rate-limit'],
    [402, 'quota'],
    [400, 'invalid-request'],
    [503, 'unavailable'],
  ] as const)('classifies HTTP %i as %s', async (status, category) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{}', { status }));
    const provider = createProvider(cases[0].profile, 'secret', fetch);
    await expect(
      provider.translateBatch({
        sourceLanguage: 'auto',
        targetLanguage: 'es',
        quality: resolveTranslationQuality(),
        units: [{ id: '1', number: 1, text: 'Hello' }],
      }),
    ).rejects.toMatchObject({ category });
  });

  it('rejects insecure remote OpenAI-compatible endpoints', () => {
    expect(() =>
      createProvider(
        { ...cases[0].profile, endpoint: 'http://remote.example/v1' },
        'secret',
      ),
    ).toThrow(ProviderError);
  });

  it('tests a connection with fixed text rather than page content', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(cases[0].response), { status: 200 }),
      );
    await createProvider(cases[0].profile, 'secret', fetch).testConnection();
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('Hello');
  });
});
