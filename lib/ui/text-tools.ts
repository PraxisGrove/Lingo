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
  :host { all: initial; --surface: #fff; --text: #1e293b; --button: #f8fafc; --muted: #64748b; font: 14px/1.5 system-ui, sans-serif; color: var(--text); }
  :host([data-theme="dark"]) { --surface: #172033; --text: #e2e8f0; --button: #28354b; --muted: #a8b8cc; }
  [hidden] { display: none !important; }
  section { position: fixed; z-index: 2147483100; inset: 16px 16px 16px auto; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; padding: 20px; overflow: auto; background: var(--surface); border: 1px solid #cbd5e1; border-radius: 12px; box-shadow: 0 8px 40px #0003; }
  :host([data-standalone]) section { position: relative; inset: auto; width: min(700px, calc(100vw - 32px)); margin: 24px auto; }
  header, .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  header { justify-content: space-between; } h2 { align-items: center; display: flex; gap: 6px; font-size: 18px; } h2 svg { width: 28px; height: 28px; flex-shrink: 0; }
  label { display: block; margin-block: 12px; }
  textarea, input { display: block; box-sizing: border-box; width: 100%; padding: 10px; margin-top: 6px; border: 1px solid #94a3b8; border-radius: 6px; font: inherit; color: inherit; background: inherit; }
  textarea { resize: vertical; } button { padding: 8px 12px; border: 1px solid #94a3b8; border-radius: 6px; background: var(--button); color: var(--text); font: inherit; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; } :focus-visible { outline: 3px solid #818cf8; outline-offset: 2px; }
  .output { white-space: pre-wrap; overflow-wrap: anywhere; } .help { font-size: 12px; color: var(--muted); } .selection { position: fixed; z-index: 2147483101; background: #4f46e5; color: white; }
  @media (prefers-color-scheme: dark) { :host([data-theme="system"]) { --surface: #172033; --text: #e2e8f0; --button: #28354b; --muted: #a8b8cc; } }
`;
