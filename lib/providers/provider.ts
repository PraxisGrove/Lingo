import type { ProviderProfile } from '../storage/settings-model';
import type {
  ProviderBatchInput,
  ProviderBatchResult,
  ProviderCapabilities,
  TranslationProvider,
} from '../translation/orchestrator';
import {
  instructionForQuality,
  resolveTranslationQuality,
} from '../translation/quality';
import {
  acceptsEndpointQuery,
  DEFAULT_PROVIDER_ENDPOINTS,
  isAiProvider,
  isLocalProviderEndpoint,
  isQwenCompatibleEndpoint,
  PROVIDER_DEFINITIONS,
  providerRequiresCredential,
} from './config';
import {
  customHeaderValues,
  joinEndpoint,
  secretQueryParameter,
} from './request-options';

export type ProviderErrorCategory =
  | 'authentication'
  | 'quota'
  | 'rate-limit'
  | 'invalid-request'
  | 'unavailable'
  | 'network'
  | 'invalid-response'
  | 'unsupported'
  | 'language-pack';

export class ProviderError extends Error {
  constructor(
    public readonly category: ProviderErrorCategory,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ConfiguredTranslationProvider = TranslationProvider & {
  testConnection(): Promise<void>;
};

const BASE_CAPABILITIES: ProviderCapabilities = {
  maxBatchSize: 50,
  supportsContext: false,
  supportsNativeGlossary: false,
  supportsStructuredOutput: false,
  supportsStreaming: false,
};

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
};

export function createProvider(
  profile: ProviderProfile,
  credential: string,
  fetcher: typeof fetch = fetch,
  headerSecrets: Record<string, string> = {},
): ConfiguredTranslationProvider {
  credential = credential.trim();
  if (!credential && providerRequiresCredential(profile))
    throw new ProviderError(
      'authentication',
      'A provider credential is required.',
    );
  const endpoint = resolveEndpoint(profile);
  validateEndpoint(endpoint, profile.provider);
  const extraHeaders = customHeaderValues(profile.headers, headerSecrets);
  if (
    (profile.provider === 'anthropic' ||
      profile.provider === 'gemini' ||
      profile.provider === 'openai-responses') &&
    !profile.model?.trim()
  )
    throw new ProviderError(
      'invalid-request',
      'Choose a translation model first.',
    );
  if (
    profile.provider === 'gemini' &&
    (profile.model ?? '')
      .replace(/^models\//, '')
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  )
    throw new ProviderError(
      'invalid-request',
      'Enter a valid Gemini model id.',
    );
  const definition = PROVIDER_DEFINITIONS.find(
    (item) => item.value === profile.provider,
  );
  const capabilities = {
    ...BASE_CAPABILITIES,
    maxBatchSize: definition?.maxBatchSize ?? BASE_CAPABILITIES.maxBatchSize,
    // Conservative per-request budgets; a single paragraph is never truncated.
    maxBatchCharacters: isAiProvider(profile.provider) ? 12_000 : 24_000,
    supportsContext: isAiProvider(profile.provider),
    supportsStructuredOutput: isAiProvider(profile.provider),
    supportsNativeGlossary: profile.provider === 'deepl',
  };
  return {
    capabilities: withTuning(capabilities, profile.tuning),
    translateBatch: (input) =>
      translate(profile, credential, endpoint, input, fetcher, extraHeaders),
    async testConnection() {
      const translations = await translate(
        { ...profile, nativeGlossaryId: undefined },
        credential,
        endpoint,
        {
          sourceLanguage: 'auto',
          targetLanguage: 'es',
          quality: resolveTranslationQuality(),
          units: [{ id: 'connection-test', number: 1, text: 'Hello' }],
        },
        fetcher,
        extraHeaders,
      );
      if (
        translations.length !== 1 ||
        translations[0].id !== 'connection-test' ||
        typeof translations[0].text !== 'string' ||
        !translations[0].text.trim()
      )
        throw new ProviderError(
          'invalid-response',
          'The service did not return a valid test translation.',
        );
    },
  };
}

async function translate(
  profile: ProviderProfile,
  credential: string,
  endpoint: string,
  input: ProviderBatchInput,
  fetcher: typeof fetch,
  extraHeaders: Record<string, string> = {},
): Promise<ProviderBatchResult> {
  const request = buildRequest(
    profile,
    credential,
    endpoint,
    input,
    extraHeaders,
  );
  let response: Response;
  try {
    response = await fetcher(request.url, request.init);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new ProviderError(
      'network',
      'The translation service could not be reached.',
    );
  }
  if (!response.ok) throw errorForStatus(response.status, profile.provider);
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new ProviderError(
      'invalid-response',
      'The translation service returned invalid JSON.',
    );
  }
  return parseResponse(
    profile.provider,
    data,
    input.units.map((unit) => unit.id),
  );
}

function buildRequest(
  profile: ProviderProfile,
  credential: string,
  endpoint: string,
  input: ProviderBatchInput,
  extraHeaders: Record<string, string> = {},
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {
    ...extraHeaders,
    'content-type': 'application/json',
  };
  const bearer = (value: string) => {
    if (!value) return;
    if (profile.credentialHeader === 'api-key') headers['api-key'] = value;
    else headers.authorization = `Bearer ${value}`;
  };
  let url: string;
  let body: unknown;
  switch (profile.provider) {
    case 'openai-compatible':
      url = joinEndpoint(endpoint, 'chat/completions');
      bearer(credential);
      body = {
        model: profile.model ?? 'gpt-4.1-mini',
        ...(['api.openai.com', 'api.mistral.ai', 'api.groq.com'].includes(
          new URL(endpoint).hostname,
        )
          ? { response_format: { type: 'json_object' } }
          : {}),
        ...(isQwenCompatibleEndpoint(endpoint)
          ? { enable_thinking: false }
          : {}),
        ...(['api.minimax.io', 'api.minimax.chat'].includes(
          new URL(endpoint).hostname,
        )
          ? { reasoning_split: true }
          : {}),
        messages: [
          {
            role: 'system',
            content: structuredInstruction(input),
          },
          { role: 'user', content: JSON.stringify(input.units) },
        ],
      };
      break;
    case 'openai-responses': {
      url = joinEndpoint(endpoint, 'responses');
      bearer(credential);
      const host = new URL(endpoint).hostname;
      body = {
        model: profile.model,
        instructions: structuredInstruction(input),
        input: JSON.stringify(input.units),
        stream: false,
        store: false,
        text: {
          format: ['api.openai.com', 'api.deepseek.com'].includes(host)
            ? {
                type: 'json_schema',
                name: 'lingo_translation',
                schema: TRANSLATION_SCHEMA,
                ...(host === 'api.openai.com' ? { strict: true } : {}),
              }
            : { type: 'json_object' },
        },
      };
      break;
    }
    case 'anthropic':
      url = joinEndpoint(endpoint, 'messages');
      if (credential) headers['x-api-key'] = credential;
      headers['anthropic-version'] = '2023-06-01';
      if (new URL(endpoint).hostname === 'api.anthropic.com')
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = {
        model: profile.model,
        max_tokens: 8192,
        system: structuredInstruction(input),
        messages: [{ role: 'user', content: JSON.stringify(input.units) }],
        tools: [
          {
            name: 'translate',
            description:
              'Return the translated paragraphs with their original stable ids.',
            input_schema: TRANSLATION_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'translate' },
      };
      break;
    case 'gemini':
      url = `${endpoint}/models/${(profile.model ?? '')
        .replace(/^models\//, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/')}:generateContent`;
      if (credential) headers['x-goog-api-key'] = credential;
      body = {
        systemInstruction: { parts: [{ text: structuredInstruction(input) }] },
        contents: [
          { role: 'user', parts: [{ text: JSON.stringify(input.units) }] },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: TRANSLATION_SCHEMA,
        },
      };
      break;
    case 'deepl':
      if (profile.nativeGlossaryId && input.sourceLanguage === 'auto')
        throw new ProviderError(
          'invalid-request',
          'Choose an explicit source language to use a DeepL glossary.',
        );
      url = `${endpoint.replace(/\/$/, '')}/v2/translate`;
      headers.authorization = `DeepL-Auth-Key ${credential}`;
      body = {
        text: input.units.map((unit) => unit.text),
        target_lang: nativeLanguage(
          profile.provider,
          input.targetLanguage,
          'target',
        ),
        ...(input.sourceLanguage === 'auto'
          ? {}
          : {
              source_lang: nativeLanguage(
                profile.provider,
                input.sourceLanguage,
                'source',
              ),
            }),
        ...(profile.nativeGlossaryId
          ? { glossary_id: profile.nativeGlossaryId }
          : {}),
      };
      break;
    case 'google-cloud':
      url = `${endpoint.replace(/\/$/, '')}/language/translate/v2?key=${encodeURIComponent(credential)}`;
      body = {
        q: input.units.map((unit) => unit.text),
        target: input.targetLanguage,
        format: 'text',
        ...(input.sourceLanguage === 'auto'
          ? {}
          : { source: input.sourceLanguage }),
      };
      break;
    case 'azure-translator':
      url = `${endpoint.replace(/\/$/, '')}/translate?api-version=3.0&to=${encodeURIComponent(nativeLanguage(profile.provider, input.targetLanguage, 'target'))}${input.sourceLanguage === 'auto' ? '' : `&from=${encodeURIComponent(nativeLanguage(profile.provider, input.sourceLanguage, 'source'))}`}`;
      headers['ocp-apim-subscription-key'] = credential;
      if (profile.region)
        headers['ocp-apim-subscription-region'] = profile.region;
      body = input.units.map((unit) => ({ text: unit.text }));
      break;
    case 'built-in':
      throw new ProviderError(
        'unsupported',
        'On-device translation does not use network requests.',
      );
  }
  return {
    url,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: input.signal,
    },
  };
}

// UI preferences use locale codes; native MT APIs require their own language
// identifiers. Keep the user's locale and cache identity unchanged.
function nativeLanguage(
  kind: ProviderProfile['provider'],
  language: string,
  role: 'source' | 'target',
): string {
  const code = language.toLowerCase();
  if (kind === 'deepl') {
    if (role === 'source') {
      if (/^zh(?:-|$)/.test(code)) return 'ZH';
      if (/^en(?:-|$)/.test(code)) return 'EN';
      if (/^pt(?:-|$)/.test(code)) return 'PT';
    }
    return (
      (
        {
          'zh-cn': 'ZH-HANS',
          'zh-sg': 'ZH-HANS',
          'zh-tw': 'ZH-HANT',
          'zh-hk': 'ZH-HANT',
          en: 'EN-US',
          pt: 'PT-BR',
        } as Record<string, string>
      )[code] ?? language.toUpperCase()
    );
  }
  if (kind === 'azure-translator') {
    return (
      (
        {
          'zh-cn': 'zh-Hans',
          'zh-sg': 'zh-Hans',
          'zh-tw': 'zh-Hant',
          'zh-hk': 'zh-Hant',
          'en-us': 'en',
          'en-gb': 'en',
        } as Record<string, string>
      )[code] ?? language
    );
  }
  return language;
}

function parseResponse(
  kind: ProviderProfile['provider'],
  data: unknown,
  ids: string[],
): ProviderBatchResult {
  try {
    if (kind === 'openai-responses')
      return parseResponsesTranslations(data, ids);
    if (kind === 'openai-compatible') {
      const content = (
        data as { choices: Array<{ message: { content: string } }> }
      ).choices[0].message.content;
      return parseStructuredTranslations(content);
    }
    if (kind === 'anthropic') {
      const blocks = (
        data as {
          content: Array<{
            type: string;
            name?: string;
            input?: unknown;
            text?: string;
          }>;
        }
      ).content;
      const tool = blocks.find(
        (block) => block.type === 'tool_use' && block.name === 'translate',
      );
      return parseStructuredTranslations(
        tool
          ? JSON.stringify(tool.input)
          : blocks
              .filter((block) => block.type === 'text')
              .map((block) => block.text ?? '')
              .join(''),
      );
    }
    if (kind === 'gemini') {
      const parts = (
        data as {
          candidates: Array<{
            content: { parts: Array<{ text?: string; thought?: boolean }> };
          }>;
        }
      ).candidates[0].content.parts;
      return parseStructuredTranslations(
        parts
          .filter((part) => !part.thought)
          .map((part) => part.text ?? '')
          .join(''),
      );
    }
    if (kind === 'deepl')
      return (
        data as { translations: Array<{ text: string }> }
      ).translations.map((item, index) => ({
        id: ids[index],
        text: item.text,
      }));
    if (kind === 'google-cloud')
      return (
        data as { data: { translations: Array<{ translatedText: string }> } }
      ).data.translations.map((item, index) => ({
        id: ids[index],
        text: item.translatedText,
      }));
    return (data as Array<{ translations: Array<{ text: string }> }>).map(
      (item, index) => ({ id: ids[index], text: item.translations[0].text }),
    );
  } catch {
    throw new ProviderError(
      'invalid-response',
      'The translation service response did not match its contract.',
    );
  }
}

function structuredInstruction(input: ProviderBatchInput): string {
  const parts = [
    input.sourceLanguage === 'auto'
      ? `Translate to ${input.targetLanguage}.`
      : `Translate from ${input.sourceLanguage} to ${input.targetLanguage}.`,
    instructionForQuality(input.quality),
    'Preserve all ⟦number⟧, ⟦/number⟧ and ⟦KEEP:number⟧ markers exactly once. Paired markers must stay correctly nested; KEEP markers represent content that must remain untouched.',
    'Return a JSON object with a translations array. Each item must contain the supplied stable id and its translated text.',
  ];
  if (input.quality.glossary.length > 0) {
    parts.push(
      `Use these required terminology mappings: ${JSON.stringify(input.quality.glossary)}.`,
    );
  }
  if (input.context) {
    if (input.context.pageTitle)
      parts.push(`Page title for context only: ${input.context.pageTitle}`);
    if (input.context.units.length > 0)
      parts.push(
        `Adjacent paragraphs for context only: ${JSON.stringify(input.context.units)}.`,
      );
  }
  return parts.join(' ');
}

function parseResponsesTranslations(
  data: unknown,
  ids: string[],
): ProviderBatchResult {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Missing response.');
  const response = data as Record<string, unknown>;
  if (
    (response.status !== undefined && response.status !== 'completed') ||
    response.error != null ||
    response.incomplete_details != null ||
    !Array.isArray(response.output)
  )
    throw new Error('Response did not complete.');
  const text: string[] = [];
  for (const candidate of response.output) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    if (item.type !== 'message' || item.role !== 'assistant') continue;
    if (
      (item.status !== undefined && item.status !== 'completed') ||
      !Array.isArray(item.content)
    )
      throw new Error('Incomplete message.');
    for (const candidatePart of item.content) {
      if (!candidatePart || typeof candidatePart !== 'object') continue;
      const part = candidatePart as Record<string, unknown>;
      if (part.type === 'refusal') throw new Error('Translation refused.');
      if (part.type === 'output_text') {
        if (typeof part.text !== 'string') throw new Error('Invalid text.');
        text.push(part.text);
      }
    }
  }
  const translations = parseStructuredTranslations(text.join(''));
  const expected = new Set(ids);
  if (
    translations.length !== ids.length ||
    new Set(translations.map((item) => item.id)).size !== ids.length ||
    translations.some((item) => !expected.has(item.id))
  )
    throw new Error('Translation ids did not match.');
  return translations;
}

function parseStructuredTranslations(content: string): ProviderBatchResult {
  try {
    const parsed = JSON.parse(repairJson(content)) as {
      translations?: unknown;
    };
    if (!Array.isArray(parsed.translations))
      throw new Error('Missing translations.');
    return parsed.translations.map((item) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { id?: unknown }).id !== 'string' ||
        typeof (item as { text?: unknown }).text !== 'string'
      ) {
        throw new Error('Malformed translation.');
      }
      const { id, text } = item as { id: string; text: string };
      return { id, text };
    });
  } catch {
    throw new ProviderError(
      'invalid-response',
      'The translation service response did not match its contract.',
    );
  }
}

function repairJson(content: string): string {
  const withoutFence = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  return start >= 0 && end >= start
    ? withoutFence.slice(start, end + 1)
    : withoutFence;
}

export function withTuning(
  capabilities: ProviderCapabilities,
  tuning: ProviderProfile['tuning'],
): ProviderCapabilities {
  if (!tuning) return capabilities;
  return {
    ...capabilities,
    maxBatchSize: Math.min(
      capabilities.maxBatchSize,
      tuning.maxBatchSize ?? capabilities.maxBatchSize,
    ),
    ...(tuning.maxBatchCharacters
      ? { maxBatchCharacters: tuning.maxBatchCharacters }
      : {}),
    requestPolicy: {
      ...(tuning.concurrency ? { concurrency: tuning.concurrency } : {}),
      ...(tuning.requestsPerMinute
        ? { minIntervalMs: Math.ceil(60_000 / tuning.requestsPerMinute) }
        : {}),
      ...(tuning.timeoutSeconds
        ? { timeoutMs: tuning.timeoutSeconds * 1000 }
        : {}),
    },
  };
}

export function resolveEndpoint(profile: ProviderProfile): string {
  const endpoint = (
    profile.endpoint?.trim() || DEFAULT_PROVIDER_ENDPOINTS[profile.provider]
  ).replace(/\/+$/, '');
  if (profile.provider === 'anthropic' || profile.provider === 'gemini') {
    try {
      const url = new URL(endpoint);
      if (url.pathname === '/' || url.pathname === '') {
        url.pathname = profile.provider === 'gemini' ? '/v1beta' : '/v1';
        return url.href;
      }
    } catch {
      // Leave malformed URLs to the common endpoint validator.
    }
  }
  return endpoint;
}

export function validateEndpoint(
  endpoint: string,
  provider?: ProviderProfile['provider'],
): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ProviderError(
      'invalid-request',
      'A valid service endpoint URL is required.',
    );
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.search && !(provider && acceptsEndpointQuery(provider)))
  )
    throw new ProviderError(
      'invalid-request',
      'Use a service base URL without credentials, a query or a fragment.',
    );
  if (secretQueryParameter(endpoint))
    throw new ProviderError(
      'invalid-request',
      'Put keys in the API key or header fields, not in the endpoint URL.',
    );
  if (
    /\/(?:models(?:\/[^/]+)?|messages|chat\/completions|responses|translate|language\/translate\/v2)\/?$/.test(
      url.pathname,
    ) ||
    /:generateContent$/.test(url.pathname)
  )
    throw new ProviderError(
      'invalid-request',
      'Use the service base URL instead of a complete API request URL.',
    );
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLocalProviderEndpoint(endpoint)) return;
  throw new ProviderError(
    'invalid-request',
    'Custom endpoints must use HTTPS unless they are local.',
  );
}

export function errorForStatus(
  status: number,
  kind: ProviderProfile['provider'],
): ProviderError {
  const category: ProviderErrorCategory =
    status === 401 || status === 403
      ? 'authentication'
      : status === 402 || (kind === 'deepl' && status === 456)
        ? 'quota'
        : status === 429 || (kind === 'deepl' && status === 529)
          ? 'rate-limit'
          : status >= 500
            ? 'unavailable'
            : 'invalid-request';
  return new ProviderError(
    category,
    `The translation service returned HTTP ${status}.`,
    status,
  );
}
