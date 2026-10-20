import { GENERIC_PROFILE, SITE_PROFILES } from './site-profiles';

const MAX_CAPTION_BYTES = 2 * 1024 * 1024;

/** Only URLs that look like caption files; this is not a general proxy. */
export function isCaptionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      return false;
    if (parsed.username || parsed.password) return false;
  } catch {
    return false;
  }
  return [...SITE_PROFILES, GENERIC_PROFILE].some(
    (profile) => profile.captionRequest?.test(url) ?? false,
  );
}

/**
 * Fetch a caption file for a content script whose page origin cannot read
 * it. Cookies are never sent, so only public caption files are reachable.
 */
export async function fetchCaptionFile(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!isCaptionUrl(url)) return { ok: false };
  try {
    const response = await fetcher(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const type = response.headers.get('content-type') ?? '';
    const length = Number(response.headers.get('content-length') ?? 0);
    if (
      !response.ok ||
      length > MAX_CAPTION_BYTES ||
      /^(image|video|audio|font)\//.test(type)
    )
      return { ok: false };
    const text = await response.text();
    return text.length > MAX_CAPTION_BYTES ? { ok: false } : { ok: true, text };
  } catch {
    return { ok: false };
  }
}
