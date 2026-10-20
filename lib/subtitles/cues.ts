/** A timed caption in seconds. Text is plain, with line breaks preserved. */
export type Cue = { start: number; end: number; text: string };

function timestamp(value: string): number | undefined {
  const match = value
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return undefined;
  const [, hours = '0', minutes, seconds, fraction] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(fraction.padEnd(3, '0')) / 1000
  );
}

export function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function finish(cues: Cue[]): Cue[] {
  return cues
    .filter(
      (cue) =>
        Number.isFinite(cue.start) && cue.end > cue.start && cue.text !== '',
    )
    .sort((a, b) => a.start - b.start);
}

/** WebVTT and SRT share the `start --> end` block structure. */
export function parseTimedText(source: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = source
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const index = lines.findIndex((line) => line.includes('-->'));
    if (index < 0) continue;
    const [from, rest = ''] = lines[index].split('-->');
    const start = timestamp(from);
    const end = timestamp(rest.trim().split(/\s+/)[0] ?? '');
    if (start === undefined || end === undefined) continue;
    cues.push({
      start,
      end,
      text: cleanText(lines.slice(index + 1).join('\n')),
    });
  }
  return finish(cues);
}

type Json3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Array<{ utf8?: string }>;
};

/** YouTube's `fmt=json3` timedtext, including auto-generated (ASR) tracks. */
export function parseYouTubeJson3(value: unknown): Cue[] {
  const events = (value as { events?: Json3Event[] } | null)?.events;
  if (!Array.isArray(events)) return [];
  const cues: Cue[] = [];
  for (const event of events) {
    // ASR tracks interleave append-only events that repeat a line break.
    if (event.aAppend || !Array.isArray(event.segs)) continue;
    const text = cleanText(event.segs.map((seg) => seg.utf8 ?? '').join(''));
    const start = (event.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (event.dDurationMs ?? 0) / 1000, text });
  }
  // ASR windows overlap the next line; end each cue when the next one starts.
  const sorted = finish(cues);
  for (let index = 0; index < sorted.length - 1; index += 1)
    sorted[index].end = Math.min(sorted[index].end, sorted[index + 1].start);
  return sorted.filter((cue) => cue.end > cue.start);
}

/** Bilibili CC subtitle JSON: `{ body: [{ from, to, content }] }`. */
export function parseBilibiliSubtitle(value: unknown): Cue[] {
  const body = (value as { body?: unknown } | null)?.body;
  if (!Array.isArray(body)) return [];
  return finish(
    body.flatMap((item) => {
      const { from, to, content } = (item ?? {}) as Record<string, unknown>;
      return typeof from === 'number' &&
        typeof to === 'number' &&
        typeof content === 'string'
        ? [{ start: from, end: to, text: cleanText(content) }]
        : [];
    }),
  );
}
