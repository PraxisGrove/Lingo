/**
 * How Lingo finds and replaces captions on a video site. Full caption files
 * allow translation ahead of playback; on-screen caption text is the fallback
 * for players that do not expose files (DRM streaming services).
 */
export type SiteProfile = {
  id: string;
  hosts: RegExp;
  /** Native caption layer hidden while Lingo shows its own. */
  nativeCaptions?: string;
  /** On-screen caption text read when no caption file is available. */
  liveCaptions?: string;
  /** Caption requests sniffed from resource timing. */
  captionRequest?: RegExp;
  /** Toggle that makes the player load captions (YouTube). */
  captionButton?: string;
  /** Element whose fullscreen state contains the video. */
  player?: string;
  /** Shown when no captions are found, if the site needs a specific step. */
  missingCaptionsHint?: 'signIn';
};

export const SITE_PROFILES: SiteProfile[] = [
  {
    id: 'youtube',
    hosts: /(^|\.)youtube(-nocookie)?\.com$/,
    nativeCaptions: '.ytp-caption-window-container',
    liveCaptions: '.ytp-caption-segment',
    captionRequest: /\/api\/timedtext\?/,
    captionButton: '.ytp-subtitles-button',
    player: '#movie_player, .html5-video-player',
  },
  {
    id: 'bilibili',
    hosts: /(^|\.)bilibili\.com$/,
    nativeCaptions: '.bpx-player-subtitle-wrap',
    liveCaptions: '.bpx-player-subtitle-panel-text',
    captionRequest: /\/\/(aisubtitle|i\d)\.hdslb\.com\/bfs\/(ai_)?subtitle\//,
    player: '.bpx-player-container',
    // Bilibili only serves AI subtitles to signed-in viewers.
    missingCaptionsHint: 'signIn',
  },
  {
    id: 'netflix',
    hosts: /(^|\.)netflix\.com$/,
    nativeCaptions: '.player-timedtext',
    liveCaptions: '.player-timedtext-text-container',
    player: '.watch-video--player-view, .watch-video',
  },
  {
    id: 'prime-video',
    // Prime Video plays on primevideo.com and inside amazon.* storefronts.
    hosts:
      /(^|\.)(primevideo\.com|amazon\.(com|co\.uk|de|co\.jp|fr|it|es|ca|in|com\.au))$/,
    nativeCaptions: '.atvwebplayersdk-captions-overlay',
    liveCaptions: '.atvwebplayersdk-captions-text',
    player: '.webPlayerSDKContainer, .dv-player-fullscreen',
  },
  {
    id: 'disney-plus',
    hosts: /(^|\.)disneyplus\.com$/,
    nativeCaptions: '.dss-subtitle-renderer-wrapper',
    liveCaptions: '.dss-subtitle-renderer-cue',
  },
  {
    id: 'max',
    hosts: /(^|\.)(max|hbomax)\.com$/,
    nativeCaptions: '[data-testid="CueBoxContainer"]',
    liveCaptions: '[data-testid="CueBoxContainer"]',
  },
  {
    id: 'vimeo',
    hosts: /(^|\.)vimeo\.com$/,
    nativeCaptions: '.vp-captions',
    liveCaptions: '.vp-captions',
    captionRequest: /\.vtt(\?|$)/,
  },
  {
    id: 'udemy',
    hosts: /(^|\.)udemy\.com$/,
    nativeCaptions: '[data-purpose="captions-cue-text"]',
    liveCaptions: '[data-purpose="captions-cue-text"]',
    captionRequest: /\.vtt(\?|$)/,
  },
  {
    id: 'coursera',
    hosts: /(^|\.)coursera\.org$/,
    nativeCaptions: '.vjs-text-track-display',
    captionRequest: /subtitleAssetProxy|\.vtt(\?|$)/,
  },
];

/** Players such as video.js and plain <track> sites share these. */
export const GENERIC_PROFILE: SiteProfile = {
  id: 'generic',
  hosts: /.*/,
  nativeCaptions: '.vjs-text-track-display, .plyr__captions, .jw-captions',
  // Bilibili's player is also embedded on other sites.
  captionRequest:
    /\.(vtt|srt)(\?|$)|\/\/(aisubtitle|i\d)\.hdslb\.com\/bfs\/(ai_)?subtitle\//i,
};

export function profileForHost(hostname: string): SiteProfile {
  return (
    SITE_PROFILES.find((profile) => profile.hosts.test(hostname)) ??
    GENERIC_PROFILE
  );
}
