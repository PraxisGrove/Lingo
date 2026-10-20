import {
  type Cue,
  cleanText,
  finish,
  parseBilibiliSubtitle,
  parseTimedText,
  parseYouTubeJson3,
} from './cues';
import type { SiteProfile } from './site-profiles';

export type CaptionFile = { url: string; cues: Cue[]; language?: string };

/** Pick a parser from the response body rather than trusting the URL. */
export function parseCaptionBody(body: string): Cue[] {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      if (Array.isArray(value.events)) return parseYouTubeJson3(value);
      if (Array.isArray(value.body)) return parseBilibiliSubtitle(value);
    } catch {
      return [];
    }
    return [];
  }
  return parseTimedText(trimmed);
}

/**
 * YouTube only answers caption requests made by its player (they carry a
 * proof-of-origin token). Reuse that exact request, asking for json3.
 */
export function youtubeCaptionUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('fmt', 'json3');
  parsed.searchParams.delete('xosf');
  return parsed.href;
}

export function captionLanguage(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const language =
      parsed.searchParams.get('tlang') ?? parsed.searchParams.get('lang');
    return language && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i.test(language)
      ? language
      : undefined;
  } catch {
    return undefined;
  }
}

export type CaptionRequestWatcher = {
  latest(): string | undefined;
  dispose(): void;
};

/**
 * Remember the most recent caption file the page loaded. Resource timing is
 * shared with content scripts, so no page-world hook is needed.
 */
export function watchCaptionRequests(
  view: Window,
  pattern: RegExp,
  onRequest: (url: string) => void,
): CaptionRequestWatcher {
  let latest: string | undefined;
  const consider = (name: string) => {
    if (!pattern.test(name) || name === latest) return;
    latest = name;
    onRequest(name);
  };
  for (const entry of view.performance.getEntriesByType('resource'))
    consider(entry.name);
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) consider(entry.name);
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch {
    // Older engines without resource observation fall back to polling.
  }
  const poll = view.setInterval(() => {
    for (const entry of view.performance.getEntriesByType('resource'))
      consider(entry.name);
  }, 1500);
  return {
    latest: () => latest,
    dispose() {
      observer?.disconnect();
      view.clearInterval(poll);
    },
  };
}

export async function loadCaptionFile(
  url: string,
  profile: SiteProfile,
  fetchText: (url: string) => Promise<string>,
): Promise<CaptionFile | undefined> {
  const target = profile.id === 'youtube' ? youtubeCaptionUrl(url) : url;
  const cues = parseCaptionBody(await fetchText(target));
  return cues.length
    ? { url, cues, language: captionLanguage(url) }
    : undefined;
}

/** Cues from an HTML5 text track; `hidden` makes the browser load them. */
export async function readTextTrack(
  video: HTMLVideoElement,
): Promise<CaptionFile | undefined> {
  const tracks = [...video.textTracks].filter(
    (track) => track.kind === 'subtitles' || track.kind === 'captions',
  );
  const track = tracks.find((item) => item.mode === 'showing') ?? tracks.at(0);
  if (!track) return undefined;
  const previousMode = track.mode;
  if (track.mode === 'disabled') track.mode = 'hidden';
  for (let attempt = 0; attempt < 20 && !track.cues?.length; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const cues = finish(
    [...(track.cues ?? [])].flatMap((cue) =>
      'text' in cue && typeof cue.text === 'string'
        ? [
            {
              start: cue.startTime,
              end: cue.endTime,
              text: cleanText(cue.text),
            },
          ]
        : [],
    ),
  );
  // Lingo draws the captions itself, so a showing track is hidden.
  if (previousMode === 'showing') track.mode = 'hidden';
  if (!cues.length) {
    track.mode = previousMode;
    return undefined;
  }
  return { url: '', cues, language: track.language || undefined };
}

/** Text currently shown by a player that does not expose caption files. */
export function readLiveCaption(root: ParentNode, selector: string): string {
  const parts = [...root.querySelectorAll<HTMLElement>(selector)]
    .filter((element) => !element.closest('[data-lingo-owned]'))
    .map((element) => (element.innerText || element.textContent || '').trim())
    .filter(Boolean);
  return [...new Set(parts)].join('\n');
}
