import type { TranslationPortClient } from '../messaging/translation-port';
import {
  createSubtitleOverlay,
  type SubtitleDisplayMode,
  type SubtitleOverlay,
} from './overlay';
import { createSubtitleScheduler } from './scheduler';
import { type Sentence, segmentCues, sentenceAt } from './segment';
import type { SiteProfile } from './site-profiles';
import {
  type CaptionFile,
  type CaptionRequestWatcher,
  loadCaptionFile,
  readLiveCaption,
  readTextTrack,
  watchCaptionRequests,
} from './sources';

export type SubtitleStatus =
  | 'idle'
  | 'waiting-captions'
  | 'translating'
  | 'live'
  | 'failed';

export type SubtitleSnapshot = {
  active: boolean;
  hasVideo: boolean;
  status: SubtitleStatus;
  source?: 'file' | 'track' | 'live';
  displayMode: SubtitleDisplayMode;
  missingCaptionsHint?: 'signIn';
};

export type SubtitleControllerOptions = {
  document: Document;
  profile: SiteProfile;
  client: TranslationPortClient;
  fetchText(url: string): Promise<string>;
  t(key: SubtitleMessage): string;
  onChange?(snapshot: SubtitleSnapshot): void;
};

export type SubtitleMessage =
  | 'subtitles.status.waiting'
  | 'subtitles.status.signIn'
  | 'subtitles.status.translating'
  | 'subtitles.status.failed';

export type SubtitleSettings = {
  targetLanguage: string;
  displayMode: SubtitleDisplayMode;
  fontScale: number;
};

/** The largest playing or visible video is the one a reader is watching. */
export function mainVideo(document: Document): HTMLVideoElement | undefined {
  const videos = [...document.querySelectorAll('video')].filter((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width >= 200 && rect.height >= 100;
  });
  return videos.sort((a, b) => {
    const playing = Number(!b.paused) - Number(!a.paused);
    if (playing) return playing;
    const area = (video: HTMLVideoElement) => {
      const rect = video.getBoundingClientRect();
      return rect.width * rect.height;
    };
    return area(b) - area(a);
  })[0];
}

export function createSubtitleController(options: SubtitleControllerOptions) {
  const { document, profile, client } = options;
  const view = document.defaultView;
  let settings: SubtitleSettings = {
    targetLanguage: 'zh-CN',
    displayMode: 'bilingual',
    fontScale: 1,
  };
  let active = false;
  let status: SubtitleStatus = 'idle';
  let source: SubtitleSnapshot['source'];
  let video: HTMLVideoElement | undefined;
  let overlay: SubtitleOverlay | undefined;
  let watcher: CaptionRequestWatcher | undefined;
  let sentences: Sentence[] = [];
  let scheduler: ReturnType<typeof createSubtitleScheduler> | undefined;
  let frameHandle: number | undefined;
  let liveObserver: MutationObserver | undefined;
  let loading = 0;
  const liveCache = new Map<string, Promise<string | undefined>>();

  function snapshot(): SubtitleSnapshot {
    return {
      active,
      hasVideo: Boolean(mainVideo(document)),
      status,
      ...(source ? { source } : {}),
      displayMode: settings.displayMode,
      ...(profile.missingCaptionsHint
        ? { missingCaptionsHint: profile.missingCaptionsHint }
        : {}),
    };
  }

  function setStatus(next: SubtitleStatus) {
    status = next;
    overlay?.setStatus(
      next === 'waiting-captions'
        ? options.t(
            profile.missingCaptionsHint === 'signIn'
              ? 'subtitles.status.signIn'
              : 'subtitles.status.waiting',
          )
        : next === 'failed'
          ? options.t('subtitles.status.failed')
          : undefined,
    );
    options.onChange?.(snapshot());
  }

  function render() {
    if (!video || !overlay || source === 'live') return;
    const sentence = sentenceAt(sentences, video.currentTime);
    overlay.show(
      sentence
        ? {
            original: sentence.text,
            translation: scheduler?.translation(sentence.id),
          }
        : undefined,
    );
  }

  function frameLoop() {
    if (!video || !active) return;
    render();
    scheduler?.update(video.currentTime);
    // Older Firefox lacks frame callbacks; paused video only needs slow polling.
    frameHandle =
      typeof video.requestVideoFrameCallback === 'function' && !video.paused
        ? video.requestVideoFrameCallback(frameLoop)
        : view?.setTimeout(frameLoop, 250);
  }

  function applyCaptions(file: CaptionFile, kind: 'file' | 'track') {
    sentences = segmentCues(file.cues);
    source = kind;
    scheduler?.stop();
    const language = file.language;
    const sameLanguage =
      language &&
      language.split('-')[0].toLowerCase() ===
        settings.targetLanguage.split('-')[0].toLowerCase();
    scheduler = sameLanguage
      ? undefined
      : createSubtitleScheduler({
          sentences,
          translate: client.translate,
          cancel: client.cancel,
          targetLanguage: settings.targetLanguage,
          sourceLanguage: language,
          onTranslated: () => render(),
          onFailure: () => setStatus('failed'),
        });
    setStatus('translating');
    if (video) scheduler?.update(video.currentTime);
    render();
  }

  async function translateLine(text: string): Promise<string | undefined> {
    const key = `${settings.targetLanguage}\u0000${text}`;
    let pending = liveCache.get(key);
    if (!pending) {
      pending = client
        .translate([{ id: 'live', number: 1, text }], settings.targetLanguage)
        .then((result) => {
          const list = Array.isArray(result) ? result : result.translations;
          return list[0]?.text;
        })
        .catch(() => {
          liveCache.delete(key);
          return undefined;
        });
      liveCache.set(key, pending);
    }
    return pending;
  }

  function startLive() {
    if (!profile.liveCaptions || source === 'live') return false;
    source = 'live';
    setStatus('live');
    let last = '';
    const update = async () => {
      const text = readLiveCaption(document, profile.liveCaptions as string);
      if (text === last) return;
      last = text;
      if (!text) {
        overlay?.show(undefined);
        return;
      }
      overlay?.show({ original: text });
      const translated = await translateLine(text);
      if (last === text && translated)
        overlay?.show({ original: text, translation: translated });
    };
    liveObserver = new MutationObserver(() => void update());
    liveObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    void update();
    return true;
  }

  async function findCaptions() {
    const attempt = ++loading;
    const tryFile = async (url: string) => {
      const file = await loadCaptionFile(url, profile, options.fetchText).catch(
        () => undefined,
      );
      if (attempt !== loading || !active || !file) return false;
      liveObserver?.disconnect();
      applyCaptions(file, 'file');
      return true;
    };
    if (profile.captionRequest && view) {
      watcher?.dispose();
      watcher = watchCaptionRequests(view, profile.captionRequest, (url) => {
        void tryFile(url);
      });
      const latest = watcher.latest();
      if (latest && (await tryFile(latest))) return;
      // YouTube loads caption files only after captions are switched on.
      const button = profile.captionButton
        ? document.querySelector<HTMLElement>(profile.captionButton)
        : null;
      if (button && button.getAttribute('aria-pressed') !== 'true')
        button.click();
    }
    if (attempt !== loading || !active || !video) return;
    const track = await readTextTrack(video);
    if (attempt !== loading || !active) return;
    if (track) {
      applyCaptions(track, 'track');
      return;
    }
    if (source === 'file') return;
    if (!startLive()) setStatus('waiting-captions');
  }

  function reset() {
    loading += 1;
    scheduler?.stop();
    scheduler = undefined;
    sentences = [];
    source = undefined;
    liveObserver?.disconnect();
    liveObserver = undefined;
    overlay?.show(undefined);
  }

  const onSeek = () => {
    if (video) scheduler?.seek(video.currentTime);
    render();
  };
  const onPlay = () => frameLoop();
  const onNewMedia = () => {
    if (!active) return;
    reset();
    void findCaptions();
  };

  function bind(next: HTMLVideoElement) {
    video = next;
    overlay = createSubtitleOverlay(next, profile.nativeCaptions);
    overlay.configure(settings);
    next.addEventListener('seeked', onSeek);
    next.addEventListener('play', onPlay);
    next.addEventListener('loadstart', onNewMedia);
    next.addEventListener('emptied', onNewMedia);
  }

  function unbind() {
    if (frameHandle !== undefined) {
      view?.clearTimeout(frameHandle);
      video?.cancelVideoFrameCallback?.(frameHandle);
    }
    if (video) {
      video.removeEventListener('seeked', onSeek);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('loadstart', onNewMedia);
      video.removeEventListener('emptied', onNewMedia);
    }
    overlay?.dispose();
    overlay = undefined;
    video = undefined;
  }

  return {
    snapshot,
    configure(next: SubtitleSettings) {
      const languageChanged = next.targetLanguage !== settings.targetLanguage;
      settings = next;
      overlay?.configure(next);
      if (active && languageChanged) {
        liveCache.clear();
        onNewMedia();
      } else render();
    },
    start(): SubtitleSnapshot {
      const next = mainVideo(document);
      if (!next) return snapshot();
      if (active && next === video) return snapshot();
      if (active) this.stop();
      active = true;
      bind(next);
      setStatus('waiting-captions');
      frameLoop();
      void findCaptions();
      return snapshot();
    },
    stop() {
      if (!active) return;
      active = false;
      reset();
      client.cancel();
      watcher?.dispose();
      watcher = undefined;
      unbind();
      setStatus('idle');
    },
    /** SPA navigation replaced the video; find captions again. */
    navigate() {
      if (!active) return;
      const next = mainVideo(document);
      if (next && next !== video) {
        unbind();
        bind(next);
      }
      onNewMedia();
    },
  };
}
