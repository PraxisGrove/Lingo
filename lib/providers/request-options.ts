/**
 * Extra headers for gateways such as OneAPI, Portkey, or Cloudflare AI
 * Gateway. Settings hold only the header name and an optional non-secret
 * value; secret values live in the local credential store.
 */
export type CustomHeader = { name: string; value?: string };

export const MAX_CUSTOM_HEADERS = 8;
const MAX_HEADER_VALUE = 2048;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

// Fetch forbids some of these; the rest are set by Lingo for each protocol and
// stay tied to the provider credential.
const RESERVED_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
]);

export function forbiddenHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    RESERVED_HEADERS.has(lower) ||
    lower.startsWith('proxy-') ||
    lower.startsWith('sec-') ||
    lower.startsWith('ocp-apim-')
  );
}

export function validHeaderValue(value: string): boolean {
  return value.length <= MAX_HEADER_VALUE && !/[\r\n\0]/.test(value);
}

export function resolveCustomHeaders(value: unknown): CustomHeader[] {
  if (!Array.isArray(value)) return [];
  const headers: CustomHeader[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { name, value: headerValue } = item as Record<string, unknown>;
    if (
      typeof name !== 'string' ||
      !HEADER_NAME.test(name) ||
      forbiddenHeaderName(name) ||
      seen.has(name.toLowerCase())
    )
      continue;
    if (
      headerValue !== undefined &&
      (typeof headerValue !== 'string' || !validHeaderValue(headerValue))
    )
      continue;
    seen.add(name.toLowerCase());
    headers.push(
      typeof headerValue === 'string' && headerValue
        ? { name, value: headerValue }
        : { name },
    );
    if (headers.length >= MAX_CUSTOM_HEADERS) break;
  }
  return headers;
}

/** Merge settings headers with locally stored secret values. */
export function customHeaderValues(
  headers: CustomHeader[] | undefined,
  secrets: Record<string, string> = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const header of headers ?? []) {
    const value = secrets[header.name.toLowerCase()] ?? header.value;
    if (value && validHeaderValue(value)) values[header.name] = value;
  }
  return values;
}

/** Append an API path to a base URL without dropping its query string. */
export function joinEndpoint(endpoint: string, path: string): string {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return url.href;
}

export function secretQueryParameter(endpoint: string): string | undefined {
  try {
    return [...new URL(endpoint).searchParams.keys()].find((key) =>
      /key|token|secret|sig|password|auth/i.test(key),
    );
  } catch {
    return undefined;
  }
}
