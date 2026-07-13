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
import { PROVIDER_DEFINITIONS } from './config';

export type ProviderErrorCategory =
  | 'authentication'
  | 'quota'
  | 'rate-limit'
  | 'invalid-request'
  | 'unavailable'
  | 'network'
  | 'invalid-response';

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

export function createProvider(
  profile: ProviderProfile,
  credential: string,
  fetcher: typeof fetch = fetch,
): ConfiguredTranslationProvider {
  if (!credential)
    throw new ProviderError(
      'authentication',
      'A provider credential is required.',
    );
  const endpoint = resolveEndpoint(profile);
  if (profile.provider === 'openai-compatible') validateEndpoint(endpoint);
  const definition = PROVIDER_DEFINITIONS.find(
    (item) => item.value === profile.provider,
  );
  const capabilities = {
    ...BASE_CAPABILITIES,
    maxBatchSize: definition?.maxBatchSize ?? BASE_CAPABILITIES.maxBatchSize,
    supportsContext: profile.provider === 'openai-compatible',
    supportsStructuredOutput: profile.provider === 'openai-compatible',
    supportsNativeGlossary: profile.provider === 'deepl',
  };
  return {
    capabilities,
    translateBatch: (input) =>
      translate(profile, credential, endpoint, input, fetcher),
    async testConnection() {
      await translate(
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
): Promise<ProviderBatchResult> {
  const request = buildRequest(profile, credential, endpoint, input);
  let response: Response;
  try {
    response = await fetcher(request.url, request.init);
  } catch {
    throw new ProviderError(
      'network',
      'The translation service could not be reached.',
    );
  }
  if (!response.ok) throw errorForStatus(response.status);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
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
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  let url: string;
  let body: unknown;
  switch (profile.provider) {
    case 'openai-compatible':
      url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
      headers.authorization = `Bearer ${credential}`;
      body = {
        model: profile.model ?? 'gpt-4.1-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: structuredInstruction(input),
          },
          { role: 'user', content: JSON.stringify(input.units) },
        ],
      };
      break;
    case 'deepl':
      url = `${endpoint.replace(/\/$/, '')}/v2/translate`;
      headers.authorization = `DeepL-Auth-Key ${credential}`;
      body = {
        text: input.units.map((unit) => unit.text),
        target_lang: input.targetLanguage,
        ...(input.sourceLanguage === 'auto'
          ? {}
          : { source_lang: input.sourceLanguage }),
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
      url = `${endpoint.replace(/\/$/, '')}/translate?api-version=3.0&to=${encodeURIComponent(input.targetLanguage)}${input.sourceLanguage === 'auto' ? '' : `&from=${encodeURIComponent(input.sourceLanguage)}`}`;
      headers['ocp-apim-subscription-key'] = credential;
      if (profile.region)
        headers['ocp-apim-subscription-region'] = profile.region;
      body = input.units.map((unit) => ({ text: unit.text }));
  }
  return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

function parseResponse(
  kind: ProviderProfile['provider'],
  data: unknown,
  ids: string[],
): ProviderBatchResult {
  try {
    if (kind === 'openai-compatible') {
      const content = (
        data as { choices: Array<{ message: { content: string } }> }
      ).choices[0].message.content;
      return parseStructuredTranslations(content);
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
    `Translate to ${input.targetLanguage}.`,
    instructionForQuality(input.quality),
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
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  return start >= 0 && end >= start
    ? withoutFence.slice(start, end + 1)
    : withoutFence;
}

function resolveEndpoint(profile: ProviderProfile): string {
  if (profile.endpoint) return profile.endpoint;
  if (profile.provider === 'deepl') return 'https://api-free.deepl.com';
  if (profile.provider === 'google-cloud')
    return 'https://translation.googleapis.com';
  if (profile.provider === 'azure-translator')
    return 'https://api.cognitive.microsofttranslator.com';
  return 'https://api.openai.com/v1';
}

function validateEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  if (url.protocol === 'https:') return;
  if (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    return;
  throw new ProviderError(
    'invalid-request',
    'Custom endpoints must use HTTPS unless they are local.',
  );
}

function errorForStatus(status: number): ProviderError {
  const category: ProviderErrorCategory =
    status === 401 || status === 403
      ? 'authentication'
      : status === 402
        ? 'quota'
        : status === 429
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
