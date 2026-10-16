import { SUPPORTED_UI_LOCALES } from '../i18n/locales';
import type { MessageKey } from '../i18n/resources';
import type { TranslationPortClient } from '../messaging/translation-port';
import { composedClosest } from '../page-translation/composed-dom';
import {
  captureReadableSelection,
  readableRange,
  readParagraph,
} from '../page-translation/page-translation';
import type { RuleSelectors } from '../rules/rule-resolver';
import type { ExtensionSettings } from '../storage/settings-model';
import { protectLiteralMarkers } from '../translation/inline-markers';
import { createBrandSymbol } from './brand-symbol';
import { captureInput, type InputTranslation } from './input-translation';

export type TextAction = 'selection' | 'paragraph' | 'input' | 'open' | 'undo';
const KEY_ACTIONS: Partial<Record<string, TextAction>> = {
  KeyS: 'selection',
  KeyH: 'paragraph',
  KeyI: 'input',
  KeyT: 'open',
  KeyU: 'undo',
};
type Dependencies = {
  document: Document;
  client: TranslationPortClient;
  getSettings(): Promise<ExtensionSettings>;
  t(key: MessageKey): string;
  openSettings(): void;
  standalone?: boolean;
  getRuleSelectors?: () => Promise<RuleSelectors>;
};

export function createTextTools({
  document,
  client,
  getSettings,
  t,
  openSettings,
  standalone = false,
  getRuleSelectors,
}: Dependencies) {
  const host = document.createElement('div');
  host.dataset.lingoOwned = 'text-tools';
  host.setAttribute('translate', 'no');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = TOOL_CSS;
  const panel = document.createElement('section');
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', t('tools.title'));
  const heading = document.createElement('h2');
  const headingLabel = document.createElement('span');
  headingLabel.textContent = t('tools.title');
  heading.append(createBrandSymbol(document), headingLabel);
  const localized: Array<() => void> = [];
  function button(key: MessageKey, click: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = t(key);
    localized.push(() => {
      element.textContent = t(key);
    });
    element.addEventListener('click', click);
    return element;
  }
  const close = button('tools.close', () => dismiss());
  close.hidden = standalone;
  const header = document.createElement('header');
  header.append(heading, close);
  const label = document.createElement('label');
  label.textContent = t('tools.source');
  const source = document.createElement('textarea');
  source.maxLength = 100_000;
  source.rows = 5;
  label.append(source);
  const languageLabel = document.createElement('label');
  languageLabel.textContent = t('tools.target');
  const language = document.createElement('input');
  language.value = 'zh-CN';
  languageLabel.append(language);
  const sourceLanguageLabel = document.createElement('label');
  sourceLanguageLabel.textContent = t('tools.sourceLanguage');
  const sourceLanguage = document.createElement('input');
  sourceLanguage.value = 'auto';
  sourceLanguageLabel.append(sourceLanguage);
  const choices = document.createElement('datalist');
  choices.id = 'lingo-language-codes';
  for (const code of SUPPORTED_UI_LOCALES) {
    const option = document.createElement('option');
    option.value = code;
    option.label = t(`language.${code}`);
    localized.push(() => {
      option.label = t(`language.${code}`);
    });
    choices.append(option);
  }
  const automatic = document.createElement('option');
  automatic.value = 'auto';
  automatic.label = t('tools.detect');
  localized.push(() => {
    automatic.label = t('tools.detect');
  });
  const sourceChoices = choices.cloneNode(true) as HTMLDataListElement;
  sourceChoices.id = 'lingo-source-language-codes';
  for (const option of sourceChoices.querySelectorAll('option'))
    localized.push(() => {
      option.label = t(
        `language.${option.value as (typeof SUPPORTED_UI_LOCALES)[number]}`,
      );
    });
  sourceChoices.append(automatic);
  language.setAttribute('list', choices.id);
  sourceLanguage.setAttribute('list', sourceChoices.id);
  const service = document.createElement('p');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const output = document.createElement('div');
  output.className = 'output';
  output.setAttribute('aria-label', t('tools.result'));
  output.setAttribute('aria-live', 'polite');
  const translate = button('tools.translate', () => void run());
  const cancel = button('tools.cancel', () => cancelRequest());
  cancel.hidden = true;
  const settings = button('common.openSettings', openSettings);
  const apply = button('tools.apply', () => {
    if (!input || !translatedText || !input.apply(translatedText)) {
      status.textContent = t('tools.changed');
      return;
    }
    lastInput = input;
    apply.disabled = true;
    undo.hidden = false;
    status.textContent = t('tools.applied');
  });
  const undo = button('tools.undo', () => restoreInput());
  apply.hidden = true;
  undo.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(translate, cancel, apply, undo, settings);
  const help = document.createElement('p');
  help.className = 'help';
  help.textContent = t('tools.shortcuts');
  panel.append(
    header,
    label,
    languageLabel,
    sourceLanguageLabel,
    choices,
    sourceChoices,
    service,
    actions,
    status,
    output,
    help,
  );
  const chip = button('tools.selection', () => {
    openSelection();
  });
  chip.className = 'selection';
  chip.hidden = true;
  chip.addEventListener('pointerdown', (event) => event.preventDefault());
  root.append(style, panel, chip);
  (standalone ? document.body : document.documentElement).append(host);
  if (standalone) host.dataset.standalone = '';
  let translationSettingsKey: string | undefined;
  let defaultTargetLanguage: string | undefined;
  let originFocus: Element | null = null;
  let token = 0;
  let enabled = true;
  let selectionButtonEnabled = true;
  let selected: string | undefined;
  let contextTarget: Element | null = null;
  let hoverTarget: Element | null = null;
  let input: InputTranslation | undefined;
  let lastInput: InputTranslation | undefined;
  let translatedText: string | undefined;
  let paragraph: ReturnType<typeof readParagraph>;
  let selectionContext:
    | { element: Element; range: Range; text: string }
    | undefined;

  function cancelRequest() {
    token += 1;
    client.cancel();
    translate.disabled = false;
    cancel.hidden = true;
    status.textContent = '';
  }
  function dismiss() {
    cancelRequest();
    panel.hidden = true;
    chip.hidden = true;
    if (
      originFocus instanceof HTMLElement &&
      originFocus.isConnected &&
      !standalone
    )
      originFocus.focus();
  }
  function restoreInput() {
    status.textContent = lastInput?.undo()
      ? t('tools.restored')
      : t('tools.changed');
    undo.hidden = true;
    apply.disabled = true;
  }
  function open(
    text: string,
    captured?: InputTranslation,
    auto = false,
    readable?: ReturnType<typeof readParagraph>,
  ) {
    cancelRequest();
    if (panel.hidden) {
      originFocus = document.activeElement;
      while (originFocus?.shadowRoot?.activeElement)
        originFocus = originFocus.shadowRoot.activeElement;
    }
    input = captured;
    paragraph = readable;
    selectionContext = undefined;
    translatedText = undefined;
    source.value = text;
    if (readable) {
      const preview = document.createElement('div');
      readable.render(preview, text);
      source.value = preview.textContent ?? '';
    }
    source.readOnly = !!readable;
    panel.hidden = false;
    chip.hidden = true;
    output.replaceChildren();
    status.textContent = '';
    apply.hidden = !captured;
    apply.disabled = true;
    undo.hidden = true;
    if (auto) void run();
    else source.focus();
  }
  function openSelection() {
    const selection = captureReadableSelection(document);
    if (!selection) return;
    const { text, range } = selection;
    const node = range.commonAncestorContainer;
    const element = node instanceof Element ? node : node.parentElement;
    const context = element ? { element, range, text } : undefined;
    open(text);
    selectionContext = context;
    void run();
  }

  async function run() {
    cancelRequest();
    const requestToken = token;
    const sourceAtStart = source.value;
    const literals = protectLiteralMarkers(sourceAtStart);
    const text = paragraph?.text ?? literals.text;
    translatedText = undefined;
    apply.disabled = true;
    output.replaceChildren();
    if (!text.trim()) {
      status.textContent = t('tools.empty');
      return;
    }
    if (
      sourceAtStart.length > 100_000 ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language.value) ||
      !/^(?:auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/.test(
        sourceLanguage.value,
      )
    ) {
      status.textContent = t('tools.invalid');
      return;
    }
    translate.disabled = true;
    cancel.hidden = false;
    status.textContent = t('tools.translating');
    try {
      const settings = await getSettings();
      if (requestToken !== token) return;
      if (!settings.enabled || !settings.activeProviderProfileId) {
        status.textContent = t('tools.configure');
        return;
      }
      if (
        paragraph &&
        readParagraph(paragraph.element)?.text !== paragraph.text
      ) {
        status.textContent = t('tools.protected');
        return;
      }
      if (getRuleSelectors && (paragraph || selectionContext)) {
        const rules = await getRuleSelectors();
        if (requestToken !== token) return;
        const element = paragraph?.element ?? selectionContext?.element;
        if (
          element &&
          (rules.exclude ?? []).some(
            (selector) =>
              composedClosest(element, selector) ||
              (selectionContext
                ? selectionContext.range.cloneContents().querySelector(selector)
                : element.querySelector(selector)),
          )
        ) {
          status.textContent = t('tools.protected');
          return;
        }
      }
      if (
        (paragraph &&
          readParagraph(paragraph.element)?.text !== paragraph.text) ||
        (selectionContext &&
          readableRange(selectionContext.range) !== selectionContext.text) ||
        (input && !input.isCurrent())
      ) {
        status.textContent = t('tools.protected');
        return;
      }
      const profile = settings.providerProfiles.find(
        (item) => item.id === settings.activeProviderProfileId,
      );
      service.textContent = `${t('tools.service')}: ${profile?.name ?? ''}`;
      const result = await client.translate(
        [{ id: 'text-tool', number: 1, text }],
        language.value,
        undefined,
        { sourceLanguage: sourceLanguage.value },
      );
      if (requestToken !== token || source.value !== sourceAtStart) return;
      const translations = Array.isArray(result) ? result : result.translations;
      const translated = translations[0]?.text;
      if (!translated) throw new Error(t('tools.failed'));
      translatedText = paragraph ? translated : literals.restore(translated);
      if (paragraph) paragraph.render(output, translated);
      else output.textContent = translatedText;
      apply.disabled = !input?.isCurrent();
      status.textContent =
        input && !input.isCurrent() ? t('tools.changed') : '';
    } catch (error) {
      if (requestToken === token)
        status.textContent = `${t('tools.failed')} ${error instanceof Error ? error.message : ''}`;
    } finally {
      if (requestToken === token) {
        translate.disabled = false;
        cancel.hidden = true;
      }
    }
  }
  function execute(action: TextAction) {
    if (!enabled && action !== 'undo' && action !== 'open') return;
    if (action === 'undo') {
      restoreInput();
      return;
    }
    if (action === 'open') {
      if (source.value && !paragraph && !input) {
        panel.hidden = false;
        chip.hidden = true;
        source.focus();
      } else open('');
      return;
    }
    if (action === 'selection') {
      openSelection();
    } else if (action === 'paragraph') {
      const readable = hoverTarget ? readParagraph(hoverTarget) : undefined;
      if (readable) open(readable.text, undefined, true, readable);
    } else {
      let focused = document.activeElement;
      while (focused?.shadowRoot?.activeElement)
        focused = focused.shadowRoot.activeElement;
      const captured = captureInput(contextTarget) ?? captureInput(focused);
      contextTarget = null;
      if (captured) open(captured.original, captured, true);
    }
  }
  const onPointer = (event: PointerEvent) => {
    const target = event.composedPath().find((node) => node instanceof Element);
    if (
      target instanceof Element &&
      !composedClosest(target, '[data-lingo-owned]')
    )
      hoverTarget = target;
  };
  const onContext = (event: MouseEvent) => {
    contextTarget =
      (event.composedPath().find((node) => node instanceof Element) as
        | Element
        | undefined) ?? null;
  };
  const onSelection = () => {
    const selection =
      enabled && selectionButtonEnabled && panel.hidden
        ? captureReadableSelection(document)
        : undefined;
    selected = selection?.text;
    chip.hidden = !selected;
    if (!selection) return;
    const rect = selection.range.getBoundingClientRect();
    chip.style.left = `${Math.max(8, Math.min(rect.right, (document.defaultView?.innerWidth ?? 800) - 180))}px`;
    chip.style.top = `${Math.max(8, Math.min(rect.bottom + 8, (document.defaultView?.innerHeight ?? 600) - 50))}px`;
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !panel.hidden && !standalone) {
      dismiss();
      return;
    }
    if (
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat
    )
      return;
    const action = KEY_ACTIONS[event.code];
    if (!action || (!enabled && action !== 'undo' && action !== 'open')) return;
    event.preventDefault();
    // Keyboard actions target the focused field, not an old context menu target.
    contextTarget = null;
    execute(action);
  };
  document.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('contextmenu', onContext);
  document.addEventListener('selectionchange', onSelection);
  document.addEventListener('keydown', onKey);
  source.addEventListener('input', () => {
    paragraph = undefined;
    selectionContext = undefined;
    cancelRequest();
    translatedText = undefined;
    apply.disabled = true;
    output.replaceChildren();
  });
  const onLanguageChange = () => {
    cancelRequest();
    translatedText = undefined;
    apply.disabled = true;
    output.replaceChildren();
  };
  language.addEventListener('input', onLanguageChange);
  sourceLanguage.addEventListener('input', onLanguageChange);

  return {
    execute,
    update(settings: ExtensionSettings) {
      for (const refresh of localized) refresh();
      headingLabel.textContent = t('tools.title');
      panel.setAttribute('aria-label', t('tools.title'));
      output.setAttribute('aria-label', t('tools.result'));
      if (label.firstChild) label.firstChild.textContent = t('tools.source');
      if (languageLabel.firstChild)
        languageLabel.firstChild.textContent = t('tools.target');
      if (sourceLanguageLabel.firstChild)
        sourceLanguageLabel.firstChild.textContent = t('tools.sourceLanguage');
      help.textContent = t('tools.shortcuts');
      const nextKey = JSON.stringify([
        settings.enabled,
        settings.activeProviderProfileId,
        settings.providerProfiles,
        settings.fallbackProviderProfileIds,
        settings.translationQuality,
        settings.siteGlossaries,
        settings.targetLanguage,
      ]);
      if (nextKey !== translationSettingsKey) {
        cancelRequest();
        translatedText = undefined;
        apply.disabled = true;
        output.replaceChildren();
        translationSettingsKey = nextKey;
      }
      if (defaultTargetLanguage !== settings.targetLanguage) {
        language.value = settings.targetLanguage;
        defaultTargetLanguage = settings.targetLanguage;
      }
      if (translate.disabled) status.textContent = t('tools.translating');
      host.dataset.theme = settings.theme;
      enabled = settings.enabled;
      selectionButtonEnabled = settings.selectionButtonEnabled;
      const profile = settings.providerProfiles.find(
        (item) => item.id === settings.activeProviderProfileId,
      );
      service.textContent = `${t('tools.service')}: ${profile?.name ?? t('popup.noServiceSelected')}`;
      if (!enabled) dismiss();
      if (!selectionButtonEnabled) chip.hidden = true;
    },
    suspend: dismiss,
    dispose() {
      dismiss();
      document.removeEventListener('pointermove', onPointer);
      document.removeEventListener('contextmenu', onContext);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('keydown', onKey);
      host.remove();
      client.disconnect();
    },
  };
}

const TOOL_CSS = `
  :host {
    all: initial;
    --ink: #171a17;
    --lime: #dfff45;
    --paper: #f4f4ef;
    --surface: #fff;
    --text: #171a17;
    --button: #ebede5;
    --muted: #70756a;
    --border: #e0e3d8;
    font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: var(--text);
  }
  :host([data-theme="dark"]) {
    --paper: #171a17;
    --surface: #20251f;
    --text: #f4f4ef;
    --button: #2b3128;
    --muted: #a6afa0;
    --border: #363e32;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  section {
    position: fixed;
    z-index: 2147483100;
    inset: 16px 16px 16px auto;
    width: min(420px, calc(100vw - 32px));
    display: grid;
    align-content: start;
    gap: 16px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 20px;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 20px 70px #171a172b;
  }
  header {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 17px 20px;
    margin: -20px -20px 3px;
    background: var(--ink);
    border-radius: 11px 11px 0 0;
    color: #f4f4ef;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: 18px;
    font-weight: 650;
    letter-spacing: -.025em;
    line-height: 1.4;
  }
  h2 svg { width: 32px; height: 32px; flex-shrink: 0; color: var(--lime); }
  header button { min-height: 30px; padding: 3px 9px; background: transparent; border-color: #f4f4ef30; color: #f4f4ef; font-size: 11px; }
  header button:hover { border-color: var(--lime); color: var(--lime); background: #ffffff0d; }
  label {
    display: block;
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .02em;
  }
  section > label:first-of-type { grid-column: 1 / -1; }
  textarea, input {
    display: block;
    width: 100%;
    padding: 12px 13px;
    margin-top: 7px;
    border: 1px solid var(--border);
    border-radius: 9px;
    font: 13px/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--text);
    background: var(--paper);
  }
  input { min-height: 43px; }
  textarea { resize: vertical; min-height: 170px; }
  textarea:focus, input:focus { background: var(--surface); }
  button {
    min-height: 39px;
    padding: 8px 13px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: var(--button); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  :focus-visible { outline: 3px solid #91a828; outline-offset: 3px; }
  .actions {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .actions button:first-child, .actions button:nth-child(3) {
    background: var(--lime);
    border-color: transparent;
    color: var(--ink);
    min-width: 102px;
    font-weight: 700;
  }
  .actions button:first-child:hover, .actions button:nth-child(3):hover { background: #d1f02f; border-color: #a8be2b; }
  .actions button:last-child { margin-left: auto; color: var(--muted); font-weight: 400; }
  section > p { grid-column: 1 / -1; margin: 0; font-size: 11px; color: var(--muted); }
  section > p[role="status"] { color: var(--text); background: var(--paper); padding: 10px 12px; border-radius: 8px; }
  section > p[role="status"]:empty { display: none; }
  .output {
    grid-column: 1 / -1;
    min-height: 150px;
    padding: 14px 16px;
    background: var(--paper);
    border: 1px solid var(--border);
    border-radius: 9px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 14px;
    line-height: 1.85;
  }
  .output::before {
    content: attr(aria-label);
    display: block;
    margin-bottom: 13px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .04em;
    line-height: 1.5;
  }
  .help { padding-top: 14px; border-top: 1px solid var(--border); font-size: 10px; color: var(--muted); }
  .selection {
    position: fixed;
    z-index: 2147483101;
    min-height: 34px;
    padding: 6px 12px;
    background: var(--lime);
    border: 1px solid var(--ink);
    border-radius: 8px;
    box-shadow: 0 4px 18px #171a1729;
    color: var(--ink);
    font-weight: 700;
  }
  .selection:hover { background: #d1f02f; }
  :host([data-standalone]) section {
    position: relative;
    inset: auto;
    width: min(980px, calc(100vw - 48px));
    margin: 40px auto;
    padding: 26px;
    gap: 20px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    box-shadow: 0 8px 40px #171a1708;
  }
  :host([data-standalone]) header { padding: 23px 26px; margin: -26px -26px 2px; }
  :host([data-standalone]) h2 { font-size: 23px; }
  :host([data-standalone]) h2 svg { width: 39px; height: 39px; }
  :host([data-standalone]) section > label:first-of-type { grid-column: 1 / 3; grid-row: 2; }
  :host([data-standalone]) section > label:nth-of-type(2) { grid-column: 1; grid-row: 3; }
  :host([data-standalone]) section > label:nth-of-type(3) { grid-column: 2; grid-row: 3; }
  :host([data-standalone]) textarea { min-height: 250px; }
  :host([data-standalone]) section > p:not(.help):not([role="status"]) { grid-column: 1 / 3; grid-row: 4; }
  :host([data-standalone]) .output { grid-column: 3 / 5; grid-row: 2 / 5; min-height: 350px; }
  :host([data-standalone]) .actions { grid-row: 5; }
  :host([data-standalone]) section > p[role="status"] { grid-row: 6; }
  :host([data-standalone]) .help { grid-row: 7; }
  @media (max-width: 640px) {
    :host([data-standalone]) section { width: calc(100vw - 24px); margin: 12px auto; padding: 18px; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    :host([data-standalone]) header { padding: 18px; margin: -18px -18px 2px; }
    :host([data-standalone]) h2 { font-size: 18px; }
    :host([data-standalone]) section > label:first-of-type { grid-column: 1 / -1; grid-row: 2; }
    :host([data-standalone]) section > label:nth-of-type(2) { grid-column: 1; grid-row: 3; }
    :host([data-standalone]) section > label:nth-of-type(3) { grid-column: 2; grid-row: 3; }
    :host([data-standalone]) section > p:not(.help):not([role="status"]) { grid-column: 1 / -1; grid-row: 4; }
    :host([data-standalone]) .output { grid-column: 1 / -1; grid-row: 7; min-height: 180px; }
    :host([data-standalone]) .help { grid-row: 8; }
  }
  @media (prefers-color-scheme: dark) {
    :host([data-theme="system"]) { --paper: #171a17; --surface: #20251f; --text: #f4f4ef; --button: #2b3128; --muted: #a6afa0; --border: #363e32; }
  }
`;
