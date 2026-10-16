import { describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../storage/settings-model';
import { resolveTranslationQuality } from '../translation/quality';
import { createProvider, resolveEndpoint } from './provider';

const input = {
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  units: [{ id: 'paragraph', number: 1, text: 'Hello Lingo' }],
  quality: resolveTranslationQuality({
    glossary: [{ source: 'Lingo', target: '灵译' }],
  }),
  context: { pageTitle: 'Reading title', units: [] },
};

describe('native AI provider adapters', () => {
  it.each([
    ['gemini', 'http://127.0.0.1:3425', 'http://127.0.0.1:3425/v1beta'],
    ['gemini', 'http://localhost:3425/', 'http://localhost:3425/v1beta'],
    ['gemini', 'https://api.example/v1', 'https://api.example/v1'],
    ['gemini', 'https://api.example/v1beta/', 'https://api.example/v1beta'],
    ['gemini', 'https://api.example/proxy', 'https://api.example/proxy'],
    ['anthropic', 'http://127.0.0.1:3425', 'http://127.0.0.1:3425/v1'],
    ['anthropic', 'https://api.example/v1/', 'https://api.example/v1'],
    ['anthropic', 'https://api.example/proxy', 'https://api.example/proxy'],
    [
      'openai-compatible',
      'https://api.deepseek.com',
      'https://api.deepseek.com',
    ],
  ] as const)('resolves %s base %s as %s without overwriting explicit version/proxy paths', (provider, endpoint, expected) => {
    expect(
      resolveEndpoint({ id: 'test', name: 'Test', provider, endpoint }),
    ).toBe(expected);
  });

  it('uses the same normalized Gemini root for qualified-model generation and permits local no-key access', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"translations":[{"id":"paragraph","text":"你好"}]}',
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    await expect(
      createProvider(
        {
          id: 'magpie',
          name: 'Magpie',
          provider: 'gemini',
          endpoint: 'http://127.0.0.1:3425',
          model: 'group/auto-gpt-5-6-luna',
        },
        '',
        fetcher,
      ).translateBatch(input),
    ).resolves.toEqual([{ id: 'paragraph', text: '你好' }]);
    expect(fetcher.mock.calls[0][0]).toBe(
      'http://127.0.0.1:3425/v1beta/models/group/auto-gpt-5-6-luna:generateContent',
    );
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty(
      'x-goog-api-key',
    );
  });

  it('uses a normalized Anthropic root for local generation with no key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              name: 'translate',
              input: { translations: [{ id: 'paragraph', text: '你好' }] },
            },
          ],
        }),
      ),
    );
    await createProvider(
      {
        id: 'local',
        name: 'Local',
        provider: 'anthropic',
        endpoint: 'http://localhost:3425',
        model: 'claude/chosen',
      },
      '',
      fetcher,
    ).translateBatch(input);
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:3425/v1/messages');
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('x-api-key');
  });

  it.each([
    '../secret',
    'group/../secret',
    'group//chosen',
    './chosen',
  ])('rejects unsafe Gemini model path %s before sending any request', (model) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() =>
      createProvider(
        { id: 'x', name: 'X', provider: 'gemini', model },
        'key',
        fetcher,
      ),
    ).toThrow('Enter a valid Gemini model id.');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'openai-compatible',
    'anthropic',
    'gemini',
  ] as const)('keeps local icon preferences out of %s HTTP payloads', async (provider) => {
    const translations = { translations: [{ id: 'paragraph', text: '你好' }] };
    const content = JSON.stringify(translations);
    const response =
      provider === 'anthropic'
        ? {
            content: [
              { type: 'tool_use', name: 'translate', input: translations },
            ],
          }
        : provider === 'gemini'
          ? { candidates: [{ content: { parts: [{ text: content }] } }] }
          : { choices: [{ message: { content } }] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    await createProvider(
      {
        id: 'custom',
        name: 'Custom',
        provider,
        model: 'chosen',
        icon: {
          type: 'image',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=',
        },
      },
      'key',
      fetcher,
    ).translateBatch(input);
    const body = String(fetcher.mock.calls[0][1]?.body);
    expect(body).not.toContain('data:image');
    expect(JSON.parse(body)).not.toHaveProperty('icon');
  });
  it('uses Anthropic Messages with a forced structured translation tool', async () => {
    const profile: ProviderProfile = {
      id: 'claude',
      name: 'Claude',
      provider: 'anthropic',
      model: 'claude-selected',
      models: [{ id: 'other', name: 'Other' }],
      modelSelection: 'manual',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', thinking: 'private reasoning' },
            {
              type: 'tool_use',
              name: 'translate',
              input: { translations: [{ id: 'paragraph', text: '你好灵译' }] },
            },
          ],
        }),
      ),
    );
    const signal = new AbortController().signal;
    const provider = createProvider(profile, 'claude-key', fetcher);
    expect(provider.capabilities.supportsContext).toBe(true);
    await expect(
      provider.translateBatch({ ...input, signal }),
    ).resolves.toEqual([{ id: 'paragraph', text: '你好灵译' }]);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(request?.headers).toMatchObject({
      'x-api-key': 'claude-key',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(request?.headers).not.toHaveProperty('authorization');
    expect(request?.signal).toBe(signal);
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: 'claude-selected',
      tool_choice: { type: 'tool', name: 'translate' },
      tools: [
        { name: 'translate', input_schema: { required: ['translations'] } },
      ],
    });
    expect(body.system).toContain('Reading title');
    expect(body.system).toContain('灵译');
    expect(body.messages).toEqual([
      { role: 'user', content: JSON.stringify(input.units) },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('accepts Anthropic structured JSON text and rejects malformed tool input', async () => {
    const profile: ProviderProfile = {
      id: 'c',
      name: 'Claude',
      provider: 'anthropic',
      endpoint: 'https://claude.example/v1/',
      model: 'claude-selected',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: '```json\n{"translations":[{"id":"paragraph","text":"你好"}]}\n```',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'tool_use',
                name: 'translate',
                input: { translations: [{ id: 'paragraph', text: 123 }] },
              },
            ],
          }),
        ),
      );
    await expect(
      createProvider(profile, 'key', fetcher).translateBatch(input),
    ).resolves.toEqual([{ id: 'paragraph', text: '你好' }]);
    expect(fetcher.mock.calls[0][0]).toBe('https://claude.example/v1/messages');
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty(
      'anthropic-dangerous-direct-browser-access',
    );
    await expect(
      createProvider(profile, 'key', fetcher).translateBatch(input),
    ).rejects.toMatchObject({ category: 'invalid-response' });
  });

  it('uses Gemini generateContent with key headers and JSON schema, excluding thought parts', async () => {
    const profile: ProviderProfile = {
      id: 'g',
      name: 'Gemini',
      provider: 'gemini',
      model: 'models/gemini-selected',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'not JSON reasoning' },
                  {
                    text: '{"translations":[{"id":"paragraph","text":"你好"}]}',
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    await expect(
      createProvider(profile, 'private-key', fetcher).translateBatch(input),
    ).resolves.toEqual([{ id: 'paragraph', text: '你好' }]);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-selected:generateContent',
    );
    expect(String(url)).not.toContain('private-key');
    expect(request?.headers).toHaveProperty('x-goog-api-key', 'private-key');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: { required: ['translations'] },
      },
      contents: [
        { role: 'user', parts: [{ text: JSON.stringify(input.units) }] },
      ],
    });
  });

  it.each([
    'anthropic',
    'gemini',
  ] as const)('requires an explicit model and key for %s', (provider) => {
    const profile: ProviderProfile = { id: provider, name: provider, provider };
    expect(() => createProvider(profile, 'key')).toThrow(
      'Choose a translation model first.',
    );
    expect(() => createProvider({ ...profile, model: 'chosen' }, '')).toThrow(
      'A provider credential is required.',
    );
  });

  it.each([
    'api.minimax.io',
    'dashscope.aliyuncs.com',
    'custom.example',
  ])('keeps compatibility parameters scoped to known service %s', async (host) => {
    const endpoint = `https://${host}${host === 'dashscope.aliyuncs.com' ? '/compatible-mode/v1' : '/v1'}`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '<think>{"reason":"thinking"}</think>\n{"translations":[{"id":"paragraph","text":"你好"}]}',
              },
            },
          ],
        }),
      ),
    );
    await expect(
      createProvider(
        {
          id: 'x',
          name: 'X',
          provider: 'openai-compatible',
          endpoint,
          model: 'chosen',
        },
        'key',
        fetcher,
      ).translateBatch(input),
    ).resolves.toEqual([{ id: 'paragraph', text: '你好' }]);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('response_format');
    if (host === 'api.minimax.io') expect(body.reasoning_split).toBe(true);
    else expect(body).not.toHaveProperty('reasoning_split');
    if (host === 'dashscope.aliyuncs.com')
      expect(body.enable_thinking).toBe(false);
    else expect(body).not.toHaveProperty('enable_thinking');
  });
});
