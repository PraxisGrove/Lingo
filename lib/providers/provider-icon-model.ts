export const PROVIDER_ICON_IDS = [
  'openai',
  'deepseek',
  'siliconflow',
  'anthropic',
  'gemini',
  'qwen',
  'doubao',
  'zhipu',
  'moonshot',
  'minimax',
  'openrouter',
  'groq',
  'mistral',
  'ollama',
  'custom',
  'deepl',
  'google-cloud',
  'azure-translator',
  'built-in',
  'xai',
  'together',
  'fireworks',
  'lmstudio',
  'hunyuan',
  'qianfan',
  'azure-openai',
  'local-gateway',
] as const;

export type ProviderIconId = (typeof PROVIDER_ICON_IDS)[number];

export type ProviderIconPreference =
  | { type: 'provider'; providerId: ProviderIconId }
  | { type: 'image'; dataUrl: string };

export const MAX_PROVIDER_ICON_DATA_URL_LENGTH = 32_768;

export function parseProviderIconPreference(
  value: unknown,
): ProviderIconPreference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== 2 || !keys.includes('type')) return;
  if (
    candidate.type === 'provider' &&
    keys.includes('providerId') &&
    PROVIDER_ICON_IDS.includes(candidate.providerId as ProviderIconId)
  )
    return {
      type: 'provider',
      providerId: candidate.providerId as ProviderIconId,
    };
  if (
    candidate.type !== 'image' ||
    !keys.includes('dataUrl') ||
    typeof candidate.dataUrl !== 'string' ||
    candidate.dataUrl.length > MAX_PROVIDER_ICON_DATA_URL_LENGTH
  )
    return;
  const match = candidate.dataUrl.match(
    /^data:image\/(png|webp|jpeg);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/,
  );
  if (!match?.[2]) return;
  try {
    const bytes = atob(match[2]);
    if (btoa(bytes) !== match[2] || !matchesImageSignature(match[1], bytes))
      return;
    return { type: 'image', dataUrl: candidate.dataUrl };
  } catch {
    return;
  }
}

export function isProviderIconPreference(
  value: unknown,
): value is ProviderIconPreference {
  return parseProviderIconPreference(value) !== undefined;
}

function matchesImageSignature(format: string, bytes: string): boolean {
  if (format === 'png') return bytes.startsWith('\x89PNG\r\n\x1a\n');
  if (format === 'jpeg')
    return bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9');
  return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
}
