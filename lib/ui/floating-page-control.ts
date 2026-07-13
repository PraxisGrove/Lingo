import type { MessageKey } from '../i18n/resources';
import type {
  PageTranslation,
  SessionSnapshot,
} from '../page-translation/page-translation';
import type { ExtensionSettings } from '../storage/settings-model';

type FloatingPageControlDependencies = {
  document: Document;
  isTopFrame: boolean;
  pageTranslation: PageTranslation;
  translate(key: MessageKey): string;
};

export function createFloatingPageControl({
  document,
  isTopFrame,
  pageTranslation,
  translate,
}: FloatingPageControlDependencies) {
  let settings: ExtensionSettings | undefined;
  let host: HTMLElement | undefined;
  let button: HTMLButtonElement | undefined;
  const unsubscribe = pageTranslation.subscribe(({ snapshot }) => {
    updateButton(button, snapshot, translate);
  });

  function remove() {
    host?.remove();
    host = undefined;
    button = undefined;
  }

  return {
    update(nextSettings: ExtensionSettings) {
      settings = nextSettings;
      if (
        !isTopFrame ||
        !nextSettings.enabled ||
        !nextSettings.floatingButtonEnabled
      ) {
        remove();
        return;
      }
      if (!host) {
        const control = createControlElement(document, translate, async () => {
          if (!settings) return;
          const snapshot = pageTranslation.snapshot();
          if (snapshot.status === 'idle') {
            await start(pageTranslation, settings.targetLanguage);
          } else if (snapshot.status === 'failed') {
            await pageTranslation.stop();
            await start(pageTranslation, settings.targetLanguage);
          } else {
            await pageTranslation.stop();
          }
        });
        host = control.host;
        button = control.button;
        document.documentElement.append(host);
      }
      updateButton(button, pageTranslation.snapshot(), translate);
    },
    dispose() {
      unsubscribe();
      remove();
    },
  };
}

function start(pageTranslation: PageTranslation, targetLanguage: string) {
  return pageTranslation.start({
    targetLanguage,
    displayMode: 'bilingual',
    translateImmediately: false,
  });
}

function createControlElement(
  document: Document,
  translate: (key: MessageKey) => string,
  onClick: () => Promise<void>,
): { host: HTMLElement; button: HTMLButtonElement } {
  const host = document.createElement('div');
  host.dataset.lingoFloatingControl = '';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = FLOATING_CONTROL_CSS;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'L';
  button.title = translate('floating.translate');
  button.setAttribute('aria-label', translate('floating.translate'));
  button.addEventListener('click', () => void onClick());
  root.append(style, button);
  return { host, button };
}

function updateButton(
  button: HTMLButtonElement | undefined,
  snapshot: SessionSnapshot,
  translate: (key: MessageKey) => string,
) {
  if (!button) return;
  const active = snapshot.status !== 'idle' && snapshot.status !== 'failed';
  button.setAttribute('aria-pressed', String(active));
  button.dataset.state = snapshot.status;
  const label =
    snapshot.status === 'failed'
      ? translate('floating.retry')
      : active
        ? translate('floating.restore')
        : translate('floating.translate');
  button.title = label;
  button.setAttribute('aria-label', label);
}

const FLOATING_CONTROL_CSS = `
  :host { all: initial; }
  button {
    align-items: center;
    background: #4f46e5;
    border: 0;
    border-radius: 50%;
    bottom: 24px;
    box-shadow: 0 4px 8px rgb(0 0 0 / 22%);
    color: #fff;
    cursor: pointer;
    display: flex;
    font: 700 17px/1 system-ui, sans-serif;
    height: 44px;
    justify-content: center;
    position: fixed;
    right: 24px;
    width: 44px;
    z-index: 2147483000;
  }
  button:hover { background: #4338ca; }
  button:focus-visible {
    outline: 3px solid #a5b4fc;
    outline-offset: 3px;
  }
  button[aria-pressed='true'] { background: #13795b; }
  button[data-state='failed'] { background: #b42318; }
  @media (prefers-color-scheme: dark) {
    button { background: #8b83ff; color: #111218; }
    button:hover { background: #a59fff; }
    button[aria-pressed='true'] { background: #5fd0a8; }
    button[data-state='failed'] { background: #ff8a80; }
  }
  @media (max-width: 480px) {
    button { bottom: 16px; right: 16px; }
  }
`;
