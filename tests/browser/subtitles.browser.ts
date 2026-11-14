import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranslationPortClient } from '../../lib/messaging/translation-port';
import { createSubtitleController } from '../../lib/subtitles/controller';
import { GENERIC_PROFILE } from '../../lib/subtitles/site-profiles';
import sampleVideo from '../fixtures/sample-10s.webm?url';
import sampleCaptions from '../fixtures/sample-en.vtt?url';
import { waitFor } from '../wait';

const VTT = `WEBVTT

00:00.000 --> 00:02.500
The ship left the harbour

00:02.500 --> 00:04.000
before sunrise.

00:05.000 --> 00:08.000
Nobody knew where it was going.
`;

let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const step of cleanup.reverse()) step();
  cleanup = [];
  document.body.innerHTML = '';
});

async function mountVideo(withTrack: boolean) {
  const video = document.createElement('video');
  video.muted = true;
  video.width = 640;
  video.height = 360;
  video.src = sampleVideo;
  if (withTrack) {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.srclang = 'en';
    track.src = URL.createObjectURL(new Blob([VTT], { type: 'text/vtt' }));
    track.default = true;
    video.append(track);
  }
  document.body.append(video);
  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) resolve();
    else
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
  return video;
}

function fakeClient() {
  const requests: string[][] = [];
  const client: TranslationPortClient = {
    async translate(units, _target, onProgress) {
      requests.push(units.map((unit) => unit.text));
      const result = units.map((unit) => ({
        ...unit,
        text: `译:${unit.text}`,
      }));
      onProgress?.(result);
      return result;
    },
    cancel: vi.fn(),
    disconnect: vi.fn(),
  };
  return { client, requests };
}

function overlayText() {
  const host = document.querySelector('[data-lingo-owned="subtitles"]');
  const root = host?.shadowRoot;
  return {
    original: root?.querySelector('.original')?.textContent ?? '',
    translation: root?.querySelector('.translation')?.textContent ?? '',
    originalHidden: root?.querySelector<HTMLElement>('.original')?.hidden,
  };
}

describe('video subtitles', () => {
  it('translates merged sentences from a text track and shows them over the video', async () => {
    const video = await mountVideo(true);
    const { client, requests } = fakeClient();
    const controller = createSubtitleController({
      document,
      profile: GENERIC_PROFILE,
      client,
      fetchText: async () => '',
      t: (key) => key,
    });
    cleanup.push(() => controller.stop());
    controller.configure({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
      fontScale: 1,
    });
    const snapshot = controller.start();
    expect(snapshot).toMatchObject({ active: true, hasVideo: true });
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    // Fragments merge into one sentence; nothing past the window is sent early.
    expect(requests[0]).toEqual([
      'The ship left the harbour before sunrise.',
      'Nobody knew where it was going.',
    ]);
    video.currentTime = 1;
    await waitFor(() =>
      expect(overlayText()).toMatchObject({
        original: 'The ship left the harbour before sunrise.',
        translation: '译:The ship left the harbour before sunrise.',
      }),
    );
    expect(controller.snapshot()).toMatchObject({
      source: 'track',
      status: 'translating',
    });
    const host = document.querySelector<HTMLElement>(
      '[data-lingo-owned="subtitles"]',
    );
    const rect = video.getBoundingClientRect();
    expect(Number.parseFloat(host?.style.width ?? '0')).toBeCloseTo(
      rect.width,
      0,
    );
  });

  it('shows only the translation in translation mode and clears between lines', async () => {
    const video = await mountVideo(true);
    const { client } = fakeClient();
    const controller = createSubtitleController({
      document,
      profile: GENERIC_PROFILE,
      client,
      fetchText: async () => '',
      t: (key) => key,
    });
    cleanup.push(() => controller.stop());
    controller.configure({
      targetLanguage: 'zh-CN',
      displayMode: 'translation',
      fontScale: 1.2,
    });
    controller.start();
    video.currentTime = 6;
    await waitFor(() =>
      expect(overlayText()).toMatchObject({
        translation: '译:Nobody knew where it was going.',
        originalHidden: true,
      }),
    );
    video.currentTime = 4.5;
    await waitFor(() => expect(overlayText().translation).toBe(''));
  });

  it('removes its overlay and restores page state when stopped', async () => {
    await mountVideo(true);
    const { client } = fakeClient();
    const before = document.body.innerHTML;
    const controller = createSubtitleController({
      document,
      profile: { ...GENERIC_PROFILE, nativeCaptions: '.native-captions' },
      client,
      fetchText: async () => '',
      t: (key) => key,
    });
    controller.start();
    expect(
      document.querySelector('[data-lingo-owned="subtitles-native"]'),
    ).not.toBeNull();
    controller.stop();
    expect(document.querySelector('[data-lingo-owned]')).toBeNull();
    expect(document.body.innerHTML).toBe(before);
    expect(client.cancel).toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({
      active: false,
      status: 'idle',
    });
  });

  it('reports waiting for captions on a video without any subtitle source', async () => {
    await mountVideo(false);
    const { client, requests } = fakeClient();
    const controller = createSubtitleController({
      document,
      profile: GENERIC_PROFILE,
      client,
      fetchText: async () => '',
      t: (key) => key,
    });
    cleanup.push(() => controller.stop());
    controller.start();
    await waitFor(
      () => expect(controller.snapshot().status).toBe('waiting-captions'),
      { timeout: 4000 },
    );
    expect(requests).toEqual([]);
  });

  it('translates on-screen captions line by line when no file is available', async () => {
    await mountVideo(false);
    const native = document.createElement('div');
    native.className = 'player-captions';
    document.body.append(native);
    const { client, requests } = fakeClient();
    const controller = createSubtitleController({
      document,
      profile: {
        ...GENERIC_PROFILE,
        captionRequest: undefined,
        nativeCaptions: '.player-captions',
        liveCaptions: '.player-captions',
      },
      client,
      fetchText: async () => '',
      t: (key) => key,
    });
    cleanup.push(() => controller.stop());
    controller.start();
    await waitFor(() => expect(controller.snapshot().source).toBe('live'), {
      timeout: 4000,
    });
    native.textContent = 'Where are we going?';
    await waitFor(() =>
      expect(overlayText().translation).toBe('译:Where are we going?'),
    );
    // A repeated line is served from memory instead of a new request.
    native.textContent = '';
    await waitFor(() => expect(overlayText().original).toBe(''));
    native.textContent = 'Where are we going?';
    await waitFor(() =>
      expect(overlayText().translation).toBe('译:Where are we going?'),
    );
    expect(requests).toEqual([['Where are we going?']]);
    expect(getComputedStyle(native).opacity).toBe('0');
  });

  it('uses a caption file the page loaded, fetched through the given fetcher', async () => {
    const video = await mountVideo(false);
    const vttUrl = new URL(`${sampleCaptions}?t=${Date.now()}`, location.href)
      .href;
    const fetched: string[] = [];
    const { client, requests } = fakeClient();
    const controller = createSubtitleController({
      document,
      profile: { ...GENERIC_PROFILE, captionRequest: /sample-en\.vtt/ },
      client,
      fetchText: async (url) => {
        fetched.push(url);
        return (await fetch(url)).text();
      },
      t: (key) => key,
    });
    cleanup.push(() => controller.stop());
    controller.start();
    // The page's player requests the file after Lingo started watching.
    await fetch(vttUrl);
    await waitFor(() => expect(controller.snapshot().source).toBe('file'), {
      timeout: 4000,
    });
    expect(fetched).toContain(vttUrl);
    video.currentTime = 6;
    await waitFor(() =>
      expect(overlayText().translation).toBe(
        '译:Nobody knew where it was going.',
      ),
    );
    expect(requests.flat()).toContain('Nobody knew where it was going.');
  });
});
