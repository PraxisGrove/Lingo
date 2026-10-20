import { describe, expect, it, vi } from 'vitest';
import { profileForHost } from './site-profiles';
import {
  captionLanguage,
  loadCaptionFile,
  parseCaptionBody,
  youtubeCaptionUrl,
} from './sources';

describe('caption sources', () => {
  it('detects caption formats from the response body', () => {
    expect(
      parseCaptionBody(
        JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hi' }] }],
        }),
      ),
    ).toEqual([{ start: 0, end: 1, text: 'Hi' }]);
    expect(
      parseCaptionBody(
        JSON.stringify({ body: [{ from: 0, to: 1, content: '嗨' }] }),
      ),
    ).toEqual([{ start: 0, end: 1, text: '嗨' }]);
    expect(parseCaptionBody('WEBVTT\n\n00:00.000 --> 00:01.000\nHi')).toEqual([
      { start: 0, end: 1, text: 'Hi' },
    ]);
    expect(parseCaptionBody('')).toEqual([]);
    expect(parseCaptionBody('{broken')).toEqual([]);
  });

  it('reuses the player request for YouTube while asking for json3', () => {
    const url = youtubeCaptionUrl(
      'https://www.youtube.com/api/timedtext?v=x&lang=en&pot=TOKEN&fmt=srv3&xosf=1',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('fmt')).toBe('json3');
    expect(parsed.searchParams.get('pot')).toBe('TOKEN');
    expect(parsed.searchParams.has('xosf')).toBe(false);
    expect(captionLanguage(url)).toBe('en');
    expect(
      captionLanguage('https://www.youtube.com/api/timedtext?lang=en&tlang=ja'),
    ).toBe('ja');
  });

  it('loads a sniffed caption file through the given fetcher', async () => {
    const fetchText = vi
      .fn()
      .mockResolvedValue('WEBVTT\n\n00:00.000 --> 00:02.000\nHello there.');
    expect(
      await loadCaptionFile(
        'https://cdn.example/sub/en.vtt',
        profileForHost('example.com'),
        fetchText,
      ),
    ).toEqual({
      url: 'https://cdn.example/sub/en.vtt',
      cues: [{ start: 0, end: 2, text: 'Hello there.' }],
      language: undefined,
    });
    fetchText.mockResolvedValue('');
    expect(
      await loadCaptionFile(
        'https://cdn.example/empty.vtt',
        profileForHost('example.com'),
        fetchText,
      ),
    ).toBeUndefined();
  });
});
