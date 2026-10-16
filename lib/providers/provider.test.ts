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
    const signal = new AbortController().signal;
    await expect(
      provider.translateBatch({
        signal,
        sourceLanguage: 'auto',
        targetLanguage: 'es',
        quality: resolveTranslationQuality(),
        units: [{ id: '1', number: 1, text: 'Hello' }],
      }),
    ).resolves.toEqual([{ id: '1', text: expectedText }]);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe(
      expectedPath,
    );
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(signal);
  });
});

describe('provider errors', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://[::1]:11434/v1',
  ])('translates with a local model at %s without sending an API key', async (endpoint) => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(cases[0].response)));
    await createProvider(
      { ...cases[0].profile, endpoint, model: 'qwen3:8b' },
      '',
      fetcher,
    ).translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      quality: resolveTranslationQuality(),
      units: [{ id: '1', number: 1, text: 'Hello' }],
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      'authorization',
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).model).toBe(
      'qwen3:8b',
    );
  });

  it('keeps credentials required for cloud models and native translation APIs', () => {
    expect(() => createProvider(cases[0].profile, '')).toThrow(
      'A provider credential is required.',
    );
    expect(() =>
      createProvider({ ...cases[1].profile, endpoint: 'http://localhost' }, ''),
    ).toThrow('A provider credential is required.');
    expect(() =>
      createProvider(
        { ...cases[0].profile, endpoint: 'https://localhost.other.example/v1' },
        '',
      ),
    ).toThrow('A provider credential is required.');
  });

  it('rejects a DeepL glossary with automatic source before sending text', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const provider = createProvider(
      { ...cases[1].profile, nativeGlossaryId: 'glossary' },
      'dummy',
      fetcher,
    );
    await expect(
      provider.translateBatch({
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        quality: resolveTranslationQuality(),
        units: [{ id: '1', number: 1, text: 'Hello' }],
      }),
    ).rejects.toMatchObject({
      category: 'invalid-request',
      message: 'Choose an explicit source language to use a DeepL glossary.',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [456, 'quota'],
    [529, 'rate-limit'],
  ] as const)('classifies DeepL HTTP %s as %s', async (status, category) => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{}', { status }));
    await expect(
      createProvider(cases[1].profile, 'dummy', fetcher).translateBatch({
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        quality: resolveTranslationQuality(),
        units: [{ id: '1', number: 1, text: 'Hello' }],
      }),
    ).rejects.toMatchObject({ category, status });
  });

  it.each([
    ['deepl', 'zh-CN', 'ZH-HANS'],
    ['deepl', 'zh-TW', 'ZH-HANT'],
    ['azure-translator', 'zh-CN', 'zh-Hans'],
    ['azure-translator', 'zh-TW', 'zh-Hant'],
  ] as const)('maps %s target locale %s to native language %s', async (kind, locale, expected) => {
    const profile = cases.find(
      (item) => item.profile.provider === kind,
    )?.profile;
    if (!profile) throw new Error('Missing provider profile');
    const response =
      kind === 'deepl'
        ? { translations: [{ text: '译文' }] }
        : [{ translations: [{ text: '译文' }] }];
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    await createProvider(profile, 'dummy', fetcher).translateBatch({
      sourceLanguage: 'auto',
      targetLanguage: locale,
      quality: resolveTranslationQuality(),
      units: [{ id: '1', number: 1, text: 'Hello' }],
    });
    if (kind === 'deepl')
      expect(
        JSON.parse(String(fetcher.mock.calls[0][1]?.body)).target_lang,
      ).toBe(expected);
    else
      expect(
        new URL(String(fetcher.mock.calls[0][0])).searchParams.get('to'),
      ).toBe(expected);
  });

  it('uses DeepL base source languages and keeps target variants', async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ translations: [{ text: 'Hello' }] })),
      );
    await createProvider(cases[1].profile, 'dummy', fetcher).translateBatch({
      sourceLanguage: 'zh-TW',
      targetLanguage: 'en',
      quality: resolveTranslationQuality(),
      units: [{ id: '1', number: 1, text: '你好' }],
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      source_lang: 'ZH',
      target_lang: 'EN-US',
    });
  });

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

  it.each(cases)('rejects insecure remote $profile.provider endpoints', ({
    profile,
  }) => {
    expect(() =>
      createProvider(
        { ...profile, endpoint: 'http://remote.example/v1' },
        'secret',
      ),
    ).toThrow(ProviderError);
  });

  it('classifies malformed native endpoints as configuration errors', () => {
    expect(() =>
      createProvider(
        { ...cases[1].profile, endpoint: 'invalid endpoint' },
        'dummy',
      ),
    ).toThrowError(expect.objectContaining({ category: 'invalid-request' }));
  });

  it('tests a connection with fixed text rather than page content', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"translations":[{"id":"connection-test","text":"Hola"}]}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await createProvider(cases[0].profile, 'secret', fetch).testConnection();
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('Hello');
  });

  it.each([
    { translations: [] },
    { translations: [{ id: 'wrong-id', text: 'Hola' }] },
    { translations: [{ id: 'connection-test', text: ' ' }] },
    {
      translations: [
        { id: 'connection-test', text: 'Hola' },
        { id: 'extra', text: 'Extra' },
      ],
    },
  ])('rejects empty, unrelated or blank test translations before reporting a healthy connection', async (body) => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(body) } }],
        }),
      ),
    );
    await expect(
      createProvider(cases[0].profile, 'fixture-key', fetcher).testConnection(),
    ).rejects.toMatchObject({ category: 'invalid-response' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('provider tuning', () => {
  it('turns a profile rate limit into request spacing and caps batch size', () => {
    const provider = createProvider(
      {
        id: 'tuned',
        name: 'Free tier',
        provider: 'openai-compatible',
        model: 'm',
        tuning: {
          concurrency: 1,
          requestsPerMinute: 15,
          timeoutSeconds: 60,
          maxBatchSize: 500,
          maxBatchCharacters: 3000,
        },
      },
      'key',
    );
    expect(provider.capabilities).toMatchObject({
      maxBatchSize: 50,
      maxBatchCharacters: 3000,
      requestPolicy: { concurrency: 1, minIntervalMs: 4000, timeoutMs: 60_000 },
    });
  });
});

describe('gateway requests', () => {
  const ok = () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: [{ id: 'connection-test', text: 'Hola' }],
              }),
            },
          },
        ],
      }),
    );

  it('sends Azure-style deployments with api-key auth, query, and custom headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok());
    await createProvider(
      {
        id: 'azure',
        name: 'Azure OpenAI',
        provider: 'openai-compatible',
        endpoint:
          'https://r.openai.azure.com/openai/deployments/gpt?api-version=2024-10-21',
        model: 'gpt',
        credentialHeader: 'api-key',
        headers: [
          { name: 'X-Plain', value: 'visible' },
          { name: 'X-Gateway-Token' },
        ],
      },
      'azure-key',
      fetcher,
      { 'x-gateway-token': 'secret-token' },
    ).testConnection();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://r.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-10-21',
    );
    expect(init?.headers).toMatchObject({
      'api-key': 'azure-key',
      'X-Plain': 'visible',
      'X-Gateway-Token': 'secret-token',
      'content-type': 'application/json',
    });
    expect(init?.headers).not.toHaveProperty('authorization');
  });

  it('rejects secrets placed in the endpoint query and queries for MT services', () => {
    expect(() =>
      createProvider(
        {
          id: 'leaky',
          name: 'Leaky',
          provider: 'openai-compatible',
          endpoint: 'https://gw.example/v1?api_key=abc',
          model: 'm',
        },
        'key',
      ),
    ).toThrow(ProviderError);
    expect(() =>
      createProvider(
        {
          id: 'deepl',
          name: 'DeepL',
          provider: 'deepl',
          endpoint: 'https://api.deepl.com?x=1',
        },
        'key',
      ),
    ).toThrow(ProviderError);
  });
});
