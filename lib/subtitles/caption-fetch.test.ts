import { describe, expect, it, vi } from 'vitest';
import { fetchCaptionFile, isCaptionUrl } from './caption-fetch';

describe('background caption fetch', () => {
  it('accepts only caption-like http(s) URLs', () => {
    expect(isCaptionUrl('https://cdn.example/subs/en.vtt?sig=1')).toBe(true);
    expect(
      isCaptionUrl('https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1.json'),
    ).toBe(true);
    expect(isCaptionUrl('https://bank.example/account')).toBe(false);
    expect(isCaptionUrl('file:///etc/passwd.vtt')).toBe(false);
    expect(isCaptionUrl('https://user:pw@cdn.example/a.vtt')).toBe(false);
    expect(isCaptionUrl('not a url')).toBe(false);
  });

  it('fetches without cookies and rejects oversized or media responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('WEBVTT', { headers: { 'content-type': 'text/vtt' } }),
      )
      .mockResolvedValueOnce(
        new Response('x', {
          headers: { 'content-length': String(3 * 1024 * 1024) },
        }),
      )
      .mockResolvedValueOnce(
        new Response('x', { headers: { 'content-type': 'video/mp4' } }),
      )
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    const url = 'https://cdn.example/en.vtt';
    expect(await fetchCaptionFile(url, fetcher)).toEqual({
      ok: true,
      text: 'WEBVTT',
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    expect(await fetchCaptionFile(url, fetcher)).toEqual({ ok: false });
    expect(await fetchCaptionFile(url, fetcher)).toEqual({ ok: false });
    expect(await fetchCaptionFile(url, fetcher)).toEqual({ ok: false });
    expect(await fetchCaptionFile('https://bank.example/', fetcher)).toEqual({
      ok: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
