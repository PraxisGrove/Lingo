import {
  normalizeProviderModels,
  type ProviderModel,
  type ProviderProfile,
} from '../storage/settings-model';
import {
  isAiProvider,
  isQwenCompatibleEndpoint,
  providerRequiresCredential,
} from './config';
import { protocolsFromEndpoints } from './model-protocols';
import {
  errorForStatus,
  ProviderError,
  type ProviderErrorCategory,
  resolveEndpoint,
  validateEndpoint,
} from './provider';
import { customHeaderValues, joinEndpoint } from './request-options';

export type ProviderModelErrorCategory =
  | ProviderErrorCategory
  | 'unsupported'
  | 'empty'
  | 'timeout';

export type ProviderModelResult =
  | { ok: true; models: ProviderModel[]; resolvedEndpoint?: string }
  | {
      ok: false;
      category: ProviderModelErrorCategory;
      message: string;
      status?: number;
      requestUrl?: string;
    };

type DiscoveredModelCatalog = {
  models: ProviderModel[];
  resolvedEndpoint: string;
};
type ModelRequestDiagnostics = { status?: number; requestUrl?: string };

export class ProviderModelError extends Error {
  constructor(
    public readonly category: ProviderModelErrorCategory,
    message: string,
    public readonly status?: number,
    public readonly requestUrl?: string,
  ) {
    super(message);
    this.name = 'ProviderModelError';
  }
}

export async function discoverProviderModels(
  profile: ProviderProfile,
  credential: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ProviderModel[]> {
  return (
    await discoverProviderModelCatalog(profile, credential, fetcher, timeoutMs)
  ).models;
}

export async function discoverProviderModelCatalog(
  profile: ProviderProfile,
  credential: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
  headerSecrets: Record<string, string> = {},
): Promise<DiscoveredModelCatalog> {
  if (!isAiProvider(profile.provider))
    throw new ProviderModelError(
      'unsupported',
      'This translation service does not use selectable AI models.',
    );
  const endpoint = resolveEndpoint(profile);
  validateEndpoint(endpoint, profile.provider);
  credential = credential.trim();
  if (providerRequiresCredential(profile) && !credential)
    throw new ProviderError(
      'authentication',
      'Enter an API key before loading models.',
    );

  const controller = new AbortController();
  const diagnostics: ModelRequestDiagnostics = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new ProviderModelError(
          'timeout',
          'Loading models timed out. Try again or enter a model manually.',
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      discoverPages(
        profile,
        endpoint,
        credential,
        fetcher,
        controller.signal,
        diagnostics,
        customHeaderValues(profile.headers, headerSecrets),
      ),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof ProviderError || error instanceof ProviderModelError)
      throw new ProviderModelError(
        error.category,
        error.message,
        error.status ?? diagnostics.status,
        diagnostics.requestUrl,
      );
    throw new ProviderModelError(
      'network',
      'The model catalog could not be reached. Check the endpoint or enter a model manually.',
      diagnostics.status,
      diagnostics.requestUrl,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function discoverPages(
  profile: ProviderProfile,
  endpoint: string,
  credential: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  diagnostics: ModelRequestDiagnostics,
  extraHeaders: Record<string, string>,
): Promise<DiscoveredModelCatalog> {
  const headers: Record<string, string> = {
    ...extraHeaders,
    accept: 'application/json',
  };
  if (profile.provider === 'anthropic') {
    if (credential) headers['x-api-key'] = credential;
    headers['anthropic-version'] = '2023-06-01';
    if (new URL(endpoint).hostname === 'api.anthropic.com')
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (profile.provider === 'gemini') {
    if (credential) headers['x-goog-api-key'] = credential;
  } else if (credential) {
    if (profile.credentialHeader === 'api-key') headers['api-key'] = credential;
    else headers.authorization = `Bearer ${credential}`;
  }
  const models: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor = '';
  const qwen =
    (profile.provider === 'openai-compatible' ||
      profile.provider === 'openai-responses') &&
    isQwenCompatibleEndpoint(endpoint);
  const mistralChat =
    profile.provider === 'openai-compatible' &&
    new URL(endpoint).hostname === 'api.mistral.ai';
  let received = 0;
  for (let page = 0; page < 20; page += 1) {
    const url = qwen
      ? new URL('/api/v1/models', endpoint)
      : new URL(joinEndpoint(endpoint, 'models'));
    if (qwen) {
      url.searchParams.set('page_no', String(page + 1));
      url.searchParams.set('page_size', '20');
      url.searchParams.append('capabilities', 'TG');
      url.searchParams.append('capabilities', 'Reasoning');
    } else if (
      (profile.provider === 'openai-compatible' ||
        profile.provider === 'openai-responses') &&
      new URL(endpoint).hostname === 'api.siliconflow.cn'
    ) {
      url.searchParams.set('sub_type', 'chat');
    } else if (profile.provider === 'anthropic') {
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('after_id', cursor);
    } else if (profile.provider === 'gemini') {
      url.searchParams.set('pageSize', '1000');
      if (cursor) url.searchParams.set('pageToken', cursor);
    }
    diagnostics.requestUrl = sanitizedRequestUrl(url, credential);
    diagnostics.status = undefined;
    const response = await fetcher(url.href, {
      method: 'GET',
      headers,
      signal,
      redirect: 'error',
    });
    diagnostics.status = response.status;
    if (
      [404, 405].includes(response.status) &&
      (profile.provider === 'openai-compatible' ||
        profile.provider === 'openai-responses') &&
      new URL(endpoint).pathname === '/'
    ) {
      endpoint = new URL('/v1', endpoint).href;
      page -= 1;
      continue;
    }
    if ([404, 405, 501].includes(response.status))
      throw new ProviderModelError(
        'unsupported',
        'This endpoint does not provide a model catalog. Enter a model manually.',
      );
    if (!response.ok) throw errorForStatus(response.status, profile.provider);
    let data: Record<string, unknown>;
    try {
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error();
      data = value as Record<string, unknown>;
    } catch {
      throw new ProviderModelError(
        'invalid-response',
        'The service returned an invalid model catalog. Enter a model manually.',
      );
    }
    const output =
      qwen && data.output && typeof data.output === 'object'
        ? (data.output as Record<string, unknown>)
        : undefined;
    const items = qwen
      ? output?.models
      : profile.provider === 'gemini'
        ? data.models
        : data.data;
    if (!Array.isArray(items))
      throw new ProviderModelError(
        'invalid-response',
        'The service returned an invalid model catalog. Enter a model manually.',
      );
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (qwen) {
        if (typeof entry.model !== 'string' || !isTextModel(entry.model))
          continue;
        if (
          Array.isArray(entry.capabilities) &&
          !entry.capabilities.some(
            (capability) =>
              capability === 'TG' ||
              capability === 'Reasoning' ||
              capability === 'VU',
          )
        )
          continue;
        models.push({ id: entry.model, name: entry.name });
      } else if (profile.provider === 'gemini') {
        if (
          !Array.isArray(entry.supportedGenerationMethods) ||
          !entry.supportedGenerationMethods.includes('generateContent')
        )
          continue;
        const id =
          typeof entry.name === 'string'
            ? entry.name.replace(/^models\//, '')
            : '';
        if (textOutputCapability(entry) !== false)
          models.push({ id, name: entry.displayName });
      } else if (
        entry.lifecycle !== 'retired' &&
        typeof entry.id === 'string' &&
        (textOutputCapability(entry) ?? isTextModel(entry.id)) &&
        (!mistralChat || isMistralChatModel(entry)) &&
        !(
          profile.provider === 'openai-compatible' &&
          new URL(endpoint).hostname === 'api.openai.com' &&
          /(?:^|[-/])codex(?:[-/]|$)/i.test(entry.id)
        )
      ) {
        models.push({
          id: entry.id,
          name: entry.display_name ?? entry.name ?? entry.id,
          protocols: protocolsFromEndpoints(entry.native_endpoints),
        });
      }
    }
    received += items.length;
    if (
      qwen &&
      (typeof output?.total !== 'number' ||
        !Number.isSafeInteger(output.total) ||
        output.total < received ||
        (items.length === 0 && output.total > received))
    )
      throw new ProviderModelError(
        'invalid-response',
        'The model catalog has invalid pagination. Enter a model manually.',
      );
    const next = qwen
      ? (output?.total as number) > received
        ? String(page + 2)
        : ''
      : profile.provider === 'anthropic'
        ? data.has_more === true
          ? data.last_id
          : ''
        : profile.provider === 'gemini'
          ? (data.nextPageToken ?? '')
          : '';
    if (!next) {
      const normalized = normalizeProviderModels(models).filter(
        (model) => !containsCredential(model, credential),
      );
      if (normalized.length === 0)
        throw new ProviderModelError(
          'empty',
          'No text generation models were returned for this account. Enter a model manually or check API access.',
        );
      return { models: normalized, resolvedEndpoint: endpoint };
    }
    if (typeof next !== 'string' || next.length > 2000 || seenCursors.has(next))
      throw new ProviderModelError(
        'invalid-response',
        'The model catalog has invalid pagination. Enter a model manually.',
      );
    seenCursors.add(next);
    cursor = next;
  }
  throw new ProviderModelError(
    'invalid-response',
    'The model catalog has too many pages. Enter a model manually.',
  );
}

function isTextModel(id: string): boolean {
  return !/(?:embed|rerank|whisper|speech|tts|audio|realtime|dall-e|dalle|image|imagen|sora|video|flux|stable-diffusion|sdxl|moderation|transcri|computer-use|search-preview)/i.test(
    id,
  );
}

function isMistralChatModel(entry: Record<string, unknown>): boolean {
  if (entry.archived === true) return false;
  return (
    !entry.capabilities ||
    typeof entry.capabilities !== 'object' ||
    (entry.capabilities as Record<string, unknown>).completion_chat !== false
  );
}

function textOutputCapability(
  entry: Record<string, unknown>,
): boolean | undefined {
  const outputs = Array.isArray(entry.output_modalities)
    ? entry.output_modalities
    : entry.architecture && typeof entry.architecture === 'object'
      ? (entry.architecture as Record<string, unknown>).output_modalities
      : undefined;
  return Array.isArray(outputs) ? outputs.includes('text') : undefined;
}

function containsCredential(model: ProviderModel, credential: string): boolean {
  if (!credential) return false;
  return [model.id, model.name].some(
    (value) =>
      value === credential ||
      (credential.length >= 8 && value.includes(credential)),
  );
}

function sanitizedRequestUrl(url: URL, credential: string): string {
  const requestUrl = `${url.origin}${url.pathname}`;
  if (!credential) return requestUrl;
  return requestUrl
    .split(encodeURIComponent(credential))
    .join('[redacted]')
    .split(credential)
    .join('[redacted]');
}
