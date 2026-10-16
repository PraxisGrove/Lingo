import type { ProviderKind, ProviderProfile } from '../storage/settings-model';

export const DEFAULT_PROVIDER_ENDPOINTS: Record<ProviderKind, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepl: 'https://api-free.deepl.com',
  'google-cloud': 'https://translation.googleapis.com',
  'azure-translator': 'https://api.cognitive.microsofttranslator.com',
  'built-in': '',
};

export function isAiProvider(provider: ProviderKind): boolean {
  return [
    'openai-compatible',
    'openai-responses',
    'anthropic',
    'gemini',
  ].includes(provider);
}

/** Gateway deployments such as Azure OpenAI carry `?api-version=` here. */
export function acceptsEndpointQuery(provider: ProviderKind): boolean {
  return ['openai-compatible', 'openai-responses', 'anthropic'].includes(
    provider,
  );
}

export function isQwenCompatibleEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.pathname.replace(/\/+$/, '') === '/compatible-mode/v1' &&
      (['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith('.maas.aliyuncs.com'))
    );
  } catch {
    return false;
  }
}

export function isLocalProviderEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function providerRequiresCredential(profile: ProviderProfile): boolean {
  if (profile.provider === 'built-in') return false;
  return !(
    isAiProvider(profile.provider) &&
    isLocalProviderEndpoint(
      profile.endpoint ?? DEFAULT_PROVIDER_ENDPOINTS[profile.provider],
    )
  );
}

export type ProviderField =
  | 'endpoint'
  | 'model'
  | 'region'
  | 'nativeGlossaryId';
export const PROVIDER_DEFINITIONS: Array<{
  value: ProviderKind;
  label: string;
  fields: ProviderField[];
  maxBatchSize: number;
}> = [
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible',
    fields: ['endpoint', 'model'],
    maxBatchSize: 50,
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses',
    fields: ['endpoint', 'model'],
    maxBatchSize: 50,
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    fields: ['endpoint', 'model'],
    maxBatchSize: 50,
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    fields: ['endpoint', 'model'],
    maxBatchSize: 50,
  },
  {
    value: 'deepl',
    label: 'DeepL',
    fields: ['endpoint', 'nativeGlossaryId'],
    maxBatchSize: 50,
  },
  {
    value: 'google-cloud',
    label: 'Google Cloud Translation',
    fields: ['endpoint'],
    maxBatchSize: 100,
  },
  {
    value: 'azure-translator',
    label: 'Azure Translator',
    fields: ['endpoint', 'region'],
    maxBatchSize: 100,
  },
  {
    value: 'built-in',
    label: 'Browser on-device translation',
    fields: [],
    maxBatchSize: 20,
  },
];
