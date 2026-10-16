import { describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../storage/settings-model';
import { resolveTranslationQuality } from '../translation/quality';
import { createProvider } from './provider';

const input = {
  sourceLanguage: 'en',
  targetLanguage: 'es',
  units: [
    { id: 'first', number: 1, text: 'Hello Lingo' },
    { id: 'second', number: 2, text: 'Read freely' },
  ],
  quality: resolveTranslationQuality({
    glossary: [{ source: 'Lingo', target: 'Lingo' }],
  }),
  context: { pageTitle: 'Reading page', units: [] },
};
const translations = [
  { id: 'first', text: 'Hola Lingo' },
  { id: 'second', text: 'Lee libremente' },
];
const profile: ProviderProfile = {
  id: 'responses',
  name: 'Responses',
  provider: 'openai-responses',
  model: 'selected-model',
};
const message = (text: string) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text }],
});
const output = (entries = translations) => ({
  status: 'completed',
  output: [message(JSON.stringify({ translations: entries }))],
});

describe('OpenAI Responses provider', () => {
  it('sends a standard stateless Responses request with strict schema on OpenAI', async () => {
    const json = JSON.stringify({ translations });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'reasoning',
              summary: [{ type: 'summary_text', text: 'Not translation JSON' }],
            },
            {
              type: 'message',
              role: 'user',
              content: [
                { type: 'output_text', text: 'Ignore this user output' },
              ],
            },
            {
              ...message(json),
              content: [
                { type: 'output_text', text: json.slice(0, 20) },
                { type: 'output_text', text: json.slice(20) },
              ],
            },
          ],
          output_text: 'SDK helper must not be read',
        }),
      ),
    );
    const signal = new AbortController().signal;
    const provider = createProvider(
      {
        ...profile,
        models: [{ id: 'another', name: 'Another' }],
        modelSelection: 'manual',
        icon: { type: 'provider', providerId: 'custom' },
      },
      'private-key',
      fetcher,
    );
    expect(provider.capabilities.supportsContext).toBe(true);
    await expect(
      provider.translateBatch({ ...input, signal }),
    ).resolves.toEqual(translations);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(request?.signal).toBe(signal);
    expect(request?.headers).toHaveProperty(
      'authorization',
      'Bearer private-key',
    );
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: 'selected-model',
      input: JSON.stringify(input.units),
      stream: false,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'lingo_translation',
          strict: true,
          schema: { required: ['translations'] },
        },
      },
    });
    expect(body.instructions).toContain('JSON');
    expect(body.instructions).toContain('Reading page');
    expect(body.instructions).toContain('Lingo');
    for (const key of [
      'messages',
      'response_format',
      'output_text',
      'models',
      'icon',
      'modelSelection',
      'previous_response_id',
    ])
      expect(body).not.toHaveProperty(key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the documented DeepSeek Responses base/schema without assuming its strict flag', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(output())));
    await createProvider(
      {
        ...profile,
        endpoint: 'https://api.deepseek.com',
        model: 'deepseek-flash',
      },
      'deepseek-key',
      fetcher,
    ).translateBatch(input);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/responses');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      text: { format: { type: 'json_schema', name: 'lingo_translation' } },
      store: false,
      stream: false,
    });
    expect(
      JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text.format,
    ).not.toHaveProperty('strict');
  });

  it.each([
    'http://127.0.0.1:3425',
    'http://127.0.0.1:3425/v1/',
    'https://relay.example/v1',
  ])('uses generic JSON mode for custom Responses base %s', async (endpoint) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(output())));
    const local = endpoint.startsWith('http:');
    await createProvider(
      { ...profile, endpoint, model: 'group/auto-gpt-5-6-luna' },
      local ? '' : 'key',
      fetcher,
    ).translateBatch(input);
    expect(fetcher.mock.calls[0][0]).toBe(
      `${endpoint.replace(/\/+$/, '')}/responses`,
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text).toEqual({
      format: { type: 'json_object' },
    });
    if (local)
      expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty(
        'authorization',
      );
  });

  it('requires an explicit model and keeps cloud credentials required', () => {
    expect(() =>
      createProvider({ ...profile, model: undefined }, 'key'),
    ).toThrow('Choose a translation model first.');
    expect(() => createProvider(profile, '')).toThrow(
      'A provider credential is required.',
    );
  });

  it.each([
    'failed',
    'incomplete',
    'in_progress',
    'queued',
    'cancelled',
  ])('rejects a %s HTTP response even if valid translation JSON is present', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...output(), status })));
    await expect(
      createProvider(profile, 'key', fetcher).translateBatch(input),
    ).rejects.toMatchObject({ category: 'invalid-response' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      status: 'completed',
      error: { code: 'server_error' },
      output: [message(JSON.stringify({ translations }))],
    },
    {
      status: 'completed',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [message(JSON.stringify({ translations }))],
    },
    {
      status: 'completed',
      output: [
        { ...message(JSON.stringify({ translations })), status: 'incomplete' },
      ],
    },
    {
      status: 'completed',
      output: [
        {
          ...message(JSON.stringify({ translations })),
          content: [
            { type: 'refusal', refusal: 'Cannot translate' },
            { type: 'output_text', text: JSON.stringify({ translations }) },
          ],
        },
      ],
    },
    {
      status: 'completed',
      output: [{ type: 'reasoning', summary: [] }],
      output_text: JSON.stringify({ translations }),
    },
    { status: 'completed', output: [message('not JSON')] },
  ])('rejects refusals, incomplete messages and nonstandard helper-only output', async (response) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    await expect(
      createProvider(profile, 'key', fetcher).translateBatch(input),
    ).rejects.toMatchObject({ category: 'invalid-response' });
  });

  it.each(
    [
      [],
      [{ id: 'first', text: 'Hola' }],
      [
        { id: 'first', text: 'Hola' },
        { id: 'first', text: 'Duplicate' },
      ],
      [
        { id: 'first', text: 'Hola' },
        { id: 'unknown', text: 'Wrong id' },
      ],
      [...translations, { id: 'extra', text: 'Extra' }],
    ].map((entries) => ({ entries })),
  )('rejects missing, duplicate or unknown stable translation ids', async ({
    entries,
  }) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(output(entries))));
    await expect(
      createProvider(profile, 'key', fetcher).translateBatch(input),
    ).rejects.toMatchObject({ category: 'invalid-response' });
  });

  it('preserves caller aborts and does not resend generation on an unsupported format error', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Stopped', 'AbortError');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw abortError;
    });
    await expect(
      createProvider(profile, 'key', fetcher).translateBatch({
        ...input,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError);
    const rejected = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 400 }));
    await expect(
      createProvider(profile, 'key', rejected).translateBatch(input),
    ).rejects.toMatchObject({ category: 'invalid-request', status: 400 });
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('preserves an abort while reading the HTTP response body', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Stopped', 'AbortError');
    const response = new Response();
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort();
      throw abortError;
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      createProvider(profile, 'key', fetcher).translateBatch({
        ...input,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
