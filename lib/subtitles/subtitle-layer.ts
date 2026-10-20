import type { MessageKey } from '../i18n/resources';
import type { TranslationPortClient } from '../messaging/translation-port';
import type { ExtensionSettings } from '../storage/settings-model';
import {
  createSubtitleController,
  mainVideo,
  type SubtitleSnapshot,
} from './controller';
import { createPlayerButton, type PlayerButton } from './overlay';
import { profileForHost } from './site-profiles';
import type { SubtitlePreferences } from './subtitle-model';

export type SubtitleLayerDependencies = {
  document: Document;
  hostname: string;
  client: TranslationPortClient;
  t(key: MessageKey): string;
  /** Caption files on another origin are fetched by the background. */
  fetchCrossOrigin(url: string): Promise<string>;
};

/** Connects one frame's main video to subtitle translation. */
export function createSubtitleLayer(dependencies: SubtitleLayerDependencies) {
  const { document, hostname } = dependencies;
  const profile = profileForHost(hostname);
  let preferences: SubtitlePreferences | undefined;
  let settings: ExtensionSettings | undefined;
  let button: PlayerButton | undefined;
  let buttonVideo: HTMLVideoElement | undefined;
  let autoStarted = false;

  const controller = createSubtitleController({
    document,
    profile,
    client: dependencies.client,
    t: dependencies.t,
    async fetchText(url) {
      if (new URL(url, document.baseURI).origin === document.location.origin) {
        const response = await fetch(url, { credentials: 'include' });
        if (response.ok) return response.text();
      }
      return dependencies.fetchCrossOrigin(url);
    },
    onChange: (snapshot) => button?.setActive(snapshot.active),
  });

  function usable() {
    return Boolean(
      settings?.enabled && settings.activeProviderProfileId && preferences,
    );
  }

  function syncButton() {
    const video =
      usable() && preferences?.playerButton ? mainVideo(document) : undefined;
    if (video === buttonVideo) return;
    button?.dispose();
    button = undefined;
    buttonVideo = video;
    if (!video) return;
    button = createPlayerButton(
      video,
      {
        start: dependencies.t('subtitles.button.start'),
        stop: dependencies.t('subtitles.button.stop'),
      },
      () => {
        if (controller.snapshot().active) controller.stop();
        else controller.start();
      },
    );
    button.setActive(controller.snapshot().active);
  }

  function apply() {
    if (!settings || !preferences) return;
    if (!usable()) {
      controller.stop();
      syncButton();
      return;
    }
    controller.configure({
      targetLanguage: settings.targetLanguage,
      displayMode: preferences.displayMode,
      fontScale: preferences.fontScale,
    });
    syncButton();
    if (
      !autoStarted &&
      preferences.autoStartHosts.includes(hostname) &&
      mainVideo(document)
    ) {
      autoStarted = true;
      controller.start();
    }
  }

  // Players often insert the <video> after load; look again when it appears.
  let scheduled = false;
  const watcher = new MutationObserver(() => {
    if (scheduled || !usable()) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (mainVideo(document) !== buttonVideo) apply();
    });
  });
  watcher.observe(document.documentElement, { childList: true, subtree: true });

  return {
    updateSettings(next: ExtensionSettings) {
      settings = next;
      apply();
    },
    updatePreferences(next: SubtitlePreferences) {
      preferences = next;
      apply();
    },
    snapshot: (): SubtitleSnapshot => controller.snapshot(),
    start(): SubtitleSnapshot {
      if (!usable()) return controller.snapshot();
      return controller.start();
    },
    stop(): SubtitleSnapshot {
      controller.stop();
      return controller.snapshot();
    },
    navigate() {
      autoStarted = false;
      controller.navigate();
      apply();
    },
    dispose() {
      watcher.disconnect();
      controller.stop();
      button?.dispose();
    },
  };
}
