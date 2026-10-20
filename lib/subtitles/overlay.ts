export type SubtitleDisplayMode = 'bilingual' | 'translation';

export type SubtitleLine = { original: string; translation?: string };

export type SubtitleOverlay = {
  show(line: SubtitleLine | undefined): void;
  setStatus(text: string | undefined): void;
  configure(options: {
    displayMode: SubtitleDisplayMode;
    fontScale: number;
  }): void;
  dispose(): void;
};

export type PlayerButton = {
  setActive(active: boolean): void;
  dispose(): void;
};

/**
 * A start/stop toggle drawn over the video's top corner. It appears while
 * the pointer is over the video, like the player's own controls.
 */
export function createPlayerButton(
  video: HTMLVideoElement,
  label: { start: string; stop: string },
  onToggle: () => void,
): PlayerButton {
  const document = video.ownerDocument;
  const view = document.defaultView;
  const host = document.createElement('div');
  host.dataset.lingoOwned = 'subtitles-button';
  host.setAttribute('translate', 'no');
  host.style.cssText = 'position:fixed;z-index:2147483001;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BUTTON_CSS;
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 11h4M7 14.5h7M15 11h2"/></svg><span></span>';
  const text = button.querySelector('span') as HTMLSpanElement;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onToggle();
  });
  root.append(style, button);
  let active = false;
  let visible = false;

  function render() {
    text.textContent = active ? label.stop : label.start;
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? label.stop : label.start;
    host.style.opacity = visible || active ? '1' : '0';
  }

  function place() {
    const fullscreen = document.fullscreenElement;
    const container = fullscreen?.contains(video)
      ? fullscreen
      : document.documentElement;
    if (host.parentNode !== container) container.append(host);
    const rect = video.getBoundingClientRect();
    host.style.left = `${rect.left + 12}px`;
    host.style.top = `${rect.top + 12}px`;
    host.style.display = rect.width >= 200 && rect.height >= 100 ? '' : 'none';
  }

  const show = () => {
    visible = true;
    render();
  };
  const hide = (event: Event) => {
    const next = (event as PointerEvent).relatedTarget;
    if (next instanceof Node && host.contains(next)) return;
    visible = false;
    render();
  };
  video.addEventListener('pointerenter', show);
  video.addEventListener('pointerleave', hide);
  host.addEventListener('pointerenter', show);
  button.addEventListener('focus', show);
  const resize = new ResizeObserver(place);
  resize.observe(video);
  document.addEventListener('fullscreenchange', place);
  view?.addEventListener('scroll', place, { passive: true, capture: true });
  view?.addEventListener('resize', place);
  place();
  render();

  return {
    setActive(next) {
      active = next;
      render();
    },
    dispose() {
      resize.disconnect();
      video.removeEventListener('pointerenter', show);
      video.removeEventListener('pointerleave', hide);
      document.removeEventListener('fullscreenchange', place);
      view?.removeEventListener('scroll', place, { capture: true });
      view?.removeEventListener('resize', place);
      host.remove();
    },
  };
}

const BUTTON_CSS = `
  :host { all: initial; transition: opacity 120ms ease; }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px 5px 8px;
    font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
    color: #fff;
    background: rgb(8 8 8 / 0.7);
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 999px;
    cursor: pointer;
  }
  button[aria-pressed="true"] { color: #171a17; background: #dfff45; border-color: #dfff45; }
  button:focus-visible { outline: 2px solid #dfff45; outline-offset: 2px; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  @media (prefers-reduced-motion: reduce) { :host { transition: none; } }
`;

/**
 * Draws bilingual captions over a video in a shadow root, so page styles and
 * page translation cannot change them. Follows the video into fullscreen.
 */
export function createSubtitleOverlay(
  video: HTMLVideoElement,
  hideSelector?: string,
): SubtitleOverlay {
  const document = video.ownerDocument;
  const view = document.defaultView;
  const host = document.createElement('div');
  host.dataset.lingoOwned = 'subtitles';
  host.setAttribute('translate', 'no');
  host.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  const box = document.createElement('div');
  box.className = 'box';
  box.setAttribute('aria-live', 'off');
  const translation = document.createElement('div');
  translation.className = 'translation';
  const original = document.createElement('div');
  original.className = 'original';
  const status = document.createElement('div');
  status.className = 'status';
  status.hidden = true;
  box.append(original, translation);
  root.append(style, box, status);

  let displayMode: SubtitleDisplayMode = 'bilingual';
  let hidden: HTMLStyleElement | undefined;
  if (hideSelector) {
    // Opacity keeps the native caption text readable for the DOM fallback.
    hidden = document.createElement('style');
    hidden.dataset.lingoOwned = 'subtitles-native';
    hidden.textContent = `${hideSelector}{opacity:0!important}`;
    (document.head ?? document.documentElement).append(hidden);
  }

  function attach() {
    const fullscreen = document.fullscreenElement;
    const container = fullscreen?.contains(video)
      ? fullscreen
      : document.documentElement;
    if (host.parentNode !== container) container.append(host);
  }

  function place() {
    const rect = video.getBoundingClientRect();
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.width = `${rect.width}px`;
    host.style.height = `${rect.height}px`;
    host.style.display = rect.width > 0 && rect.height > 0 ? '' : 'none';
    host.style.setProperty(
      '--lingo-subtitle-size',
      `${Math.max(14, Math.min(40, rect.height * 0.045))}px`,
    );
  }

  const resize = new ResizeObserver(place);
  resize.observe(video);
  const onLayout = () => {
    attach();
    place();
  };
  document.addEventListener('fullscreenchange', onLayout);
  view?.addEventListener('scroll', place, { passive: true, capture: true });
  view?.addEventListener('resize', place);
  onLayout();

  return {
    show(line) {
      original.textContent = line?.original ?? '';
      translation.textContent = line?.translation ?? '';
      original.hidden =
        !line || (displayMode === 'translation' && Boolean(line.translation));
      translation.hidden = !line?.translation;
      box.hidden = !line;
      place();
    },
    setStatus(text) {
      status.textContent = text ?? '';
      status.hidden = !text;
    },
    configure(options) {
      displayMode = options.displayMode;
      host.style.setProperty(
        '--lingo-subtitle-scale',
        String(options.fontScale),
      );
    },
    dispose() {
      resize.disconnect();
      document.removeEventListener('fullscreenchange', onLayout);
      view?.removeEventListener('scroll', place, { capture: true });
      view?.removeEventListener('resize', place);
      hidden?.remove();
      host.remove();
    },
  };
}

const OVERLAY_CSS = `
  :host { all: initial; }
  [hidden] { display: none !important; }
  .box {
    position: absolute;
    left: 50%;
    bottom: 8%;
    transform: translateX(-50%);
    max-width: 88%;
    display: grid;
    gap: 2px;
    justify-items: center;
    text-align: center;
    font: 500 calc(var(--lingo-subtitle-size, 20px) * var(--lingo-subtitle-scale, 1))/1.35
      -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  .box > div {
    padding: 1px 8px;
    color: #fff;
    background: rgb(8 8 8 / 0.72);
    border-radius: 4px;
    white-space: pre-line;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.6);
  }
  .original { font-size: 0.82em; color: #e8e8e8; }
  .translation { color: #f4ff9f; }
  .status {
    position: absolute;
    top: 12px;
    right: 12px;
    padding: 4px 10px;
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #fff;
    background: rgb(8 8 8 / 0.72);
    border-radius: 999px;
  }
  @media (forced-colors: active) {
    .box > div { forced-color-adjust: none; background: Canvas; color: CanvasText; }
  }
`;
