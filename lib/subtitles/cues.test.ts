import { describe, expect, it } from 'vitest';
import {
  parseBilibiliSubtitle,
  parseTimedText,
  parseYouTubeJson3,
} from './cues';

describe('subtitle parsers', () => {
  it('reads WebVTT cues with settings, tags, entities, and hour-less times', () => {
    expect(
      parseTimedText(`WEBVTT

NOTE skipped

intro
00:01.000 --> 00:03.500 align:start position:10%
<v Speaker>Hello &amp; <b>welcome</b></v>

00:00:04.000 --> 00:00:06.000
Second
line
`),
    ).toEqual([
      { start: 1, end: 3.5, text: 'Hello & welcome' },
      { start: 4, end: 6, text: 'Second\nline' },
    ]);
  });

  it('reads SRT with comma milliseconds and CRLF line endings', () => {
    expect(
      parseTimedText(
        '1\r\n00:00:01,200 --> 00:00:02,000\r\nFirst\r\n\r\n2\r\n00:00:02,500 --> 00:00:04,000\r\nSecond\r\n',
      ),
    ).toEqual([
      { start: 1.2, end: 2, text: 'First' },
      { start: 2.5, end: 4, text: 'Second' },
    ]);
  });

  it('reads YouTube json3 and trims rolling ASR windows to the next line', () => {
    expect(
      parseYouTubeJson3({
        events: [
          {
            tStartMs: 0,
            dDurationMs: 5000,
            wWinId: 1,
            segs: [{ utf8: 'so' }, { utf8: ' today' }],
          },
          {
            tStartMs: 2000,
            dDurationMs: 3000,
            aAppend: 1,
            segs: [{ utf8: '\n' }],
          },
          { tStartMs: 2000, dDurationMs: 4000, segs: [{ utf8: 'we learn' }] },
          { tStartMs: 7000, dDurationMs: 0, segs: [{ utf8: 'empty' }] },
          { tStartMs: 8000 },
        ],
      }),
    ).toEqual([
      { start: 0, end: 2, text: 'so today' },
      { start: 2, end: 6, text: 'we learn' },
    ]);
    expect(parseYouTubeJson3(null)).toEqual([]);
  });

  it('reads Bilibili CC JSON and ignores malformed entries', () => {
    expect(
      parseBilibiliSubtitle({
        body: [
          { from: 1.5, to: 3, content: '你好' },
          { from: 'x', to: 4, content: 'bad' },
        ],
      }),
    ).toEqual([{ start: 1.5, end: 3, text: '你好' }]);
  });
});
