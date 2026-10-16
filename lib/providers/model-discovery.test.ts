import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type ProviderProfile,
} from '../storage/settings-model';
import { discoverProviderModels } from './model-discovery';
import { listProviderModels } from './provider-service';

const profile: ProviderProfile = {
  id: 'new',
  name: 'Cloud',
  provider: 'openai-compatible',
  endpoint: 'https://api.example/v1',
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const dependencies = (fetcher: typeof fetch) => ({
  getSettings: async () => DEFAULT_SETTINGS,
  getCredential: vi.fn(async () => null),
  fetcher,
});

describe('provider model discovery', () => {
  afterEach(() => vi.useRealTimers());

  it('requests the official SiliconFlow chat-only catalog instead of relying on model names', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ data: [{ id: 'deepseek-ai/DeepSeek-V3' }] }),
      );
    expect(
      await discoverProviderModels(
        { ...profile, endpoint: 'https://api.siliconflow.cn/v1' },
        'key',
        fetcher,
      ),
    ).toEqual([
      { id: 'deepseek-ai/DeepSeek-V3', name: 'deepseek-ai/DeepSeek-V3' },
    ]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/v1/models');
    expect(url.searchParams.get('sub_type')).toBe('chat');
  });

  it('does not add SiliconFlow-specific query parameters to arbitrary compatible gateways', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ data: [{ id: 'gateway-chat' }] }));
    await discoverProviderModels(
      { ...profile, endpoint: 'https://relay.example/v1' },
      'key',
      fetcher,
    );
    expect(new URL(String(fetcher.mock.calls[0][0])).search).toBe('');
  });

  it('filters Mistral models explicitly unavailable for Chat Completions or archived', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          {
            id: 'mistral-small-latest',
            capabilities: { completion_chat: true },
          },
          {
            id: 'mistral-ocr-latest',
            capabilities: { completion_chat: false },
          },
          {
            id: 'codestral-latest',
            capabilities: { completion_chat: false, completion_fim: true },
          },
          {
            id: 'archived-small',
            archived: true,
            capabilities: { completion_chat: true },
          },
        ],
      }),
    );
    expect(
      await discoverProviderModels(
        { ...profile, endpoint: 'https://api.mistral.ai/v1' },
        'key',
        fetcher,
      ),
    ).toEqual([{ id: 'mistral-small-latest', name: 'mistral-small-latest' }]);
  });

  it('keeps vendor-compatibility metadata from filtering a generic gateway that can translate protocols', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          {
            id: 'proxy/chat-model',
            capabilities: { completion_chat: false },
            archived: true,
          },
        ],
      }),
    );
    expect(
      await discoverProviderModels(
        { ...profile, endpoint: 'http://localhost:3425/v1' },
        '',
        fetcher,
      ),
    ).toEqual([{ id: 'proxy/chat-model', name: 'proxy/chat-model' }]);
  });

  it('parses the official MiniMax model-list format through the existing compatible adapter', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        object: 'list',
        data: [
          { id: 'MiniMax-M3', object: 'model', owned_by: 'minimax' },
          { id: 'MiniMax-M2.7', object: 'model', owned_by: 'minimax' },
        ],
      }),
    );
    expect(
      await discoverProviderModels(
        { ...profile, endpoint: 'https://api.minimax.io/v1' },
        'key',
        fetcher,
      ),
    ).toEqual([
      { id: 'MiniMax-M3', name: 'MiniMax-M3' },
      { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7' },
    ]);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.minimax.io/v1/models');
  });

  it('includes direct OpenAI Codex text models when using the Responses protocol', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          { id: 'gpt-5.3-codex' },
          { id: 'gpt-4.1-mini' },
          { id: 'text-embedding-3-small' },
        ],
      }),
    );
    expect(
      await listProviderModels(
        {
          ...profile,
          provider: 'openai-responses',
          endpoint: 'https://api.openai.com/v1',
        },
        'key',
        dependencies(fetcher),
      ),
    ).toEqual({
      ok: true,
      models: [
        { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
        { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
      ],
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
  });

  it('shares compatible catalog root fallback and resolved base with Responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ data: [{ id: 'group/chosen' }] }));
    expect(
      await listProviderModels(
        {
          ...profile,
          provider: 'openai-responses',
          endpoint: 'http://localhost:3425',
        },
        '',
        dependencies(fetcher),
      ),
    ).toEqual({
      ok: true,
      models: [{ id: 'group/chosen', name: 'group/chosen' }],
      resolvedEndpoint: 'http://localhost:3425/v1',
    });
    expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty(
      'authorization',
    );
  });

  it('normalizes a native Gemini gateway root before fetching a protocol-specific catalog', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        models: [
          {
            name: 'models/group/auto-gpt-5-6-luna',
            displayName: 'GPT-5.6 Luna',
            supportedGenerationMethods: [
              'generateContent',
              'streamGenerateContent',
            ],
          },
          {
            name: 'models/codex/gpt-5.4',
            displayName: 'GPT 5.4',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    );
    expect(
      await listProviderModels(
        { ...profile, provider: 'gemini', endpoint: 'http://127.0.0.1:3425' },
        'magpie',
        dependencies(fetcher),
      ),
    ).toEqual({
      ok: true,
      models: [
        { id: 'group/auto-gpt-5-6-luna', name: 'GPT-5.6 Luna' },
        { id: 'codex/gpt-5.4', name: 'GPT 5.4' },
      ],
      resolvedEndpoint: 'http://127.0.0.1:3425/v1beta',
    });
    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe(
      '/v1beta/models',
    );
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
      'x-goog-api-key',
      'magpie',
    );
  });

  it('keeps the documented DeepSeek root endpoint and its explicit text capabilities', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        object: 'list',
        data: [
          {
            id: 'deepseek-flash',
            name: 'DeepSeek Flash',
            output_modalities: ['text'],
          },
          {
            id: 'text-image-chat',
            name: 'Text model',
            output_modalities: ['text'],
          },
        ],
      }),
    );
    expect(
      await listProviderModels(
        { ...profile, endpoint: 'https://api.deepseek.com' },
        'key',
        dependencies(fetcher),
      ),
    ).toEqual({
      ok: true,
      models: [
        { id: 'deepseek-flash', name: 'DeepSeek Flash' },
        { id: 'text-image-chat', name: 'Text model' },
      ],
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/models');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    404, 405,
  ])('retries an unversioned compatible root only after HTTP %s and returns the working base', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, status))
      .mockResolvedValueOnce(response({ data: [{ id: 'local-chat' }] }));
    expect(
      await listProviderModels(
        { ...profile, endpoint: 'http://127.0.0.1:3425' },
        '',
        dependencies(fetcher),
      ),
    ).toEqual({
      ok: true,
      models: [{ id: 'local-chat', name: 'local-chat' }],
      resolvedEndpoint: 'http://127.0.0.1:3425/v1',
    });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:3425/models',
      'http://127.0.0.1:3425/v1/models',
    ]);
    expect(
      fetcher.mock.calls.every(
        ([url]) => new URL(String(url)).origin === 'http://127.0.0.1:3425',
      ),
    ).toBe(true);
  });

  it.each([
    401, 403, 429, 500, 501,
  ])('does not retry a compatible root after HTTP %s', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({}, status));
    const result = await listProviderModels(
      { ...profile, endpoint: 'https://api.example' },
      'private-key',
      dependencies(fetcher),
    );
    expect(result).toMatchObject({
      ok: false,
      status,
      requestUrl: 'https://api.example/models',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('does not guess a version below a custom reverse-proxy path', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 404));
    expect(
      await listProviderModels(
        { ...profile, endpoint: 'https://api.example/proxy' },
        'key',
        dependencies(fetcher),
      ),
    ).toMatchObject({
      ok: false,
      category: 'unsupported',
      status: 404,
      requestUrl: 'https://api.example/proxy/models',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('redacts the current credential if a custom proxy embeds it in its path', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 500));
    const result = await listProviderModels(
      { ...profile, endpoint: 'https://api.example/proxy/private-key/v1' },
      'private-key',
      dependencies(fetcher),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      requestUrl: 'https://api.example/proxy/[redacted]/v1/models',
    });
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('reports protocol-shape errors with the sanitized request and HTTP status', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ data: [{ id: 'wrong-protocol' }] }));
    expect(
      await listProviderModels(
        { ...profile, provider: 'gemini', endpoint: 'http://127.0.0.1:3425' },
        '',
        dependencies(fetcher),
      ),
    ).toMatchObject({
      ok: false,
      category: 'invalid-response',
      status: 200,
      requestUrl: 'http://127.0.0.1:3425/v1beta/models',
    });
  });

  it('normalizes/deduplicates text models without exposing keys or leaking arbitrary metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          {
            id: ' qwen-chat ',
            name: 'Friendly\u0000 name',
            api_key: 'private-key',
          },
          { id: 'qwen-chat', name: 'Duplicate' },
          { id: 'embedding-model' },
          { id: 'seedream', architecture: { output_modalities: ['image'] } },
          { id: 'flux-image-model' },
          { id: 'gpt-audio' },
          { id: 'invalid id' },
          { id: 'private-key', name: 'Secret echoed by server' },
          { id: 'valid', name: 'private-key in name' },
          { id: 'deepseek-flash' },
        ],
      }),
    );
    const result = await listProviderModels(
      profile,
      'private-key',
      dependencies(fetcher),
    );
    expect(result).toEqual({
      ok: true,
      models: [
        { id: 'qwen-chat', name: 'Friendly name' },
        { id: 'deepseek-flash', name: 'deepseek-flash' },
      ],
    });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.example/v1/models');
    expect(request).toMatchObject({
      method: 'GET',
      headers: { authorization: 'Bearer private-key' },
      redirect: 'error',
    });
    expect(request).not.toHaveProperty('body');
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('uses the saved key on edits and a submitted replacement in preference to it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response({ data: [{ id: 'chat-model' }] }),
      );
    const deps = {
      ...dependencies(fetcher),
      getSettings: async () => ({
        ...DEFAULT_SETTINGS,
        providerProfiles: [profile],
      }),
      getCredential: vi.fn(async () => 'stored-key'),
    };
    await listProviderModels(profile, '', deps);
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
      'authorization',
      'Bearer stored-key',
    );
    await listProviderModels(profile, ' replacement-key ', deps);
    expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty(
      'authorization',
      'Bearer replacement-key',
    );
  });

  it('loads local models with no auth and does not read orphaned credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ data: [{ id: 'qwen3:8b' }] }));
    const deps = dependencies(fetcher);
    const result = await listProviderModels(
      { ...profile, endpoint: 'http://localhost:11434/v1' },
      '',
      deps,
    );
    expect(result).toEqual({
      ok: true,
      models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }],
    });
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty(
      'authorization',
    );
    expect(deps.getCredential).not.toHaveBeenCalled();
  });

  it('keeps qualified text models from a local Magpie-compatible gateway, including Codex subscriptions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        object: 'list',
        data: [
          {
            id: 'codex/gpt-5.4',
            display_name: 'GPT 5.4',
            type: 'model',
            modalities: { input: ['text', 'image'] },
          },
          { id: 'deepseek/deepseek-flash', display_name: 'DeepSeek Flash' },
        ],
      }),
    );
    expect(
      await discoverProviderModels(
        { ...profile, endpoint: 'http://127.0.0.1:3425/v1' },
        '',
        fetcher,
      ),
    ).toEqual([
      { id: 'codex/gpt-5.4', name: 'GPT 5.4' },
      { id: 'deepseek/deepseek-flash', name: 'DeepSeek Flash' },
    ]);
  });

  it('continues excluding Responses-only Codex models from the direct OpenAI Chat Completions catalog', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ data: [{ id: 'gpt-5.3-codex' }, { id: 'gpt-4.1-mini' }] }),
      );
    expect(
      await discoverProviderModels(
        { ...profile, endpoint: 'https://api.openai.com/v1' },
        'key',
        fetcher,
      ),
    ).toEqual([{ id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' }]);
  });

  it('paginates Anthropic models using last_id with native authentication', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: [{ id: 'claude-first', display_name: 'First' }],
          has_more: true,
          last_id: 'claude-first',
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: [
            { id: 'claude-old', lifecycle: 'retired' },
            { id: 'claude-second', display_name: 'Second' },
          ],
          has_more: false,
        }),
      );
    expect(
      await discoverProviderModels(
        {
          ...profile,
          provider: 'anthropic',
          endpoint: 'https://api.anthropic.com/v1',
        },
        'secret',
        fetcher,
      ),
    ).toEqual([
      { id: 'claude-first', name: 'First' },
      { id: 'claude-second', name: 'Second' },
    ]);
    expect(
      new URL(String(fetcher.mock.calls[1][0])).searchParams.get('after_id'),
    ).toBe('claude-first');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      'x-api-key': 'secret',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('paginates Gemini and only returns generateContent text models without models/ prefix', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          models: [
            {
              name: 'models/gemini-flash',
              displayName: 'Flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/embedding',
              supportedGenerationMethods: ['embedContent'],
            },
            {
              name: 'models/gemini-image',
              supportedGenerationMethods: ['generateContent'],
              output_modalities: ['image'],
            },
          ],
          nextPageToken: 'page-two',
        }),
      )
      .mockResolvedValueOnce(
        response({
          models: [
            {
              name: 'models/gemini-pro',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      );
    const result = await discoverProviderModels(
      {
        ...profile,
        provider: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      },
      'private-key',
      fetcher,
    );
    expect(result).toEqual([
      { id: 'gemini-flash', name: 'Flash' },
      { id: 'gemini-pro', name: 'gemini-pro' },
    ]);
    expect(
      new URL(String(fetcher.mock.calls[1][0])).searchParams.get('pageToken'),
    ).toBe('page-two');
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
      'x-goog-api-key',
      'private-key',
    );
    expect(String(fetcher.mock.calls[0][0])).not.toContain('private-key');
  });

  it.each([
    'dashscope.aliyuncs.com',
    'dashscope-intl.aliyuncs.com',
    'work.cn-beijing.maas.aliyuncs.com',
  ])('loads Qwen native catalog on the configured %s origin and paginates totals', async (host) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          output: {
            total: 2,
            models: [
              { model: 'qwen3-plus', name: 'Qwen Plus', capabilities: ['TG'] },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          output: {
            total: 2,
            models: [
              {
                model: 'qwen3-flash',
                name: 'Qwen Flash',
                capabilities: ['Reasoning'],
              },
            ],
          },
        }),
      );
    expect(
      await discoverProviderModels(
        { ...profile, endpoint: `https://${host}/compatible-mode/v1` },
        'key',
        fetcher,
      ),
    ).toEqual([
      { id: 'qwen3-plus', name: 'Qwen Plus' },
      { id: 'qwen3-flash', name: 'Qwen Flash' },
    ]);
    const url = new URL(String(fetcher.mock.calls[1][0]));
    expect(url.origin).toBe(`https://${host}`);
    expect(url.pathname).toBe('/api/v1/models');
    expect(url.searchParams.get('page_no')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('20');
    expect(url.searchParams.getAll('capabilities')).toEqual([
      'TG',
      'Reasoning',
    ]);
  });

  it('does not transform an arbitrary compatible endpoint into a Qwen API URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ data: [{ id: 'custom-chat' }] }));
    await discoverProviderModels(
      {
        ...profile,
        endpoint:
          'https://dashscope.aliyuncs.com.evil.example/compatible-mode/v1',
      },
      'key',
      fetcher,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://dashscope.aliyuncs.com.evil.example/compatible-mode/v1/models',
    );
  });

  it.each([
    404, 405, 501,
  ])('reports catalog unsupported for HTTP %s without inventing fallback models', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ message: 'private-key echoed' }, status));
    const result = await listProviderModels(
      profile,
      'private-key',
      dependencies(fetcher),
    );
    expect(result).toMatchObject({ ok: false, category: 'unsupported' });
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(result).not.toHaveProperty('models');
  });

  it.each([
    [401, 'authentication'],
    [402, 'quota'],
    [429, 'rate-limit'],
    [500, 'unavailable'],
  ] as const)('classifies HTTP %s as %s', async (status, category) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({}, status));
    expect(
      await listProviderModels(profile, 'key', dependencies(fetcher)),
    ).toMatchObject({ ok: false, category });
  });

  it('rejects missing keys before requesting remote models', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await listProviderModels(profile, '', dependencies(fetcher)),
    ).toMatchObject({ ok: false, category: 'authentication' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'not a URL',
    'http://remote.example/v1',
    'https://api.example/v1?key=secret',
    'https://user:secret@api.example/v1',
    'https://api.example/v1/models',
    'https://api.example/v1/messages',
  ])('rejects unsafe/nonbase endpoint %s before requesting models', async (endpoint) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await listProviderModels(
        { ...profile, endpoint },
        'key',
        dependencies(fetcher),
      ),
    ).toMatchObject({ ok: false, category: 'invalid-request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { data: [] },
    { data: [{ id: 'embedding-only' }] },
  ])('reports an empty text catalog', async (catalog) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(catalog));
    expect(
      await listProviderModels(profile, 'key', dependencies(fetcher)),
    ).toMatchObject({ ok: false, category: 'empty' });
  });

  it('rejects invalid JSON, missing arrays and malformed native pagination', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bad JSON'))
      .mockResolvedValueOnce(response({ wrong: [] }))
      .mockResolvedValueOnce(
        response({ data: [], has_more: true, last_id: 123 }),
      );
    const deps = dependencies(fetcher);
    expect(await listProviderModels(profile, 'key', deps)).toMatchObject({
      ok: false,
      category: 'invalid-response',
    });
    expect(await listProviderModels(profile, 'key', deps)).toMatchObject({
      ok: false,
      category: 'invalid-response',
    });
    expect(
      await listProviderModels(
        { ...profile, provider: 'anthropic' },
        'key',
        deps,
      ),
    ).toMatchObject({ ok: false, category: 'invalid-response' });
  });

  it('reports network errors without returning exception details or keys', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('private-key network details'));
    const result = await listProviderModels(
      profile,
      'private-key',
      dependencies(fetcher),
    );
    expect(result).toMatchObject({ ok: false, category: 'network' });
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('aborts a hung request and returns a timeout that allows manual selection', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const pending = listProviderModels(profile, 'key', {
      ...dependencies(fetcher),
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ ok: false, category: 'timeout' });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
