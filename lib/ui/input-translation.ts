import {
  composedClosest,
  isComposedVisible,
} from '../page-translation/composed-dom';

export type InputTranslation = {
  original: string;
  isCurrent(): boolean;
  apply(text: string): boolean;
  undo(): boolean;
};

/** Capture only the explicitly targeted plain text field. Never overwrite
 * subsequent user edits when a slow request completes or undo is pressed. */
export function captureInput(
  element: Element | null,
): InputTranslation | undefined {
  if (!isWritableInput(element)) return;
  const target = element;
  const field =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? element
      : undefined;
  const read = () => (field ? field.value : (element.textContent ?? ''));
  const original = read();
  if (!original.trim()) return;
  let applied: string | undefined;
  const isCurrent = () =>
    isWritableInput(target) &&
    target.isConnected &&
    read() === original &&
    applied === undefined;
  function write(text: string) {
    if (field) {
      const prototype =
        field instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
        field,
        text,
      );
    } else target.textContent = text;
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return {
    original,
    isCurrent,
    apply(text) {
      if (!isCurrent()) return false;
      write(text);
      applied = text;
      return true;
    },
    undo() {
      if (
        !isWritableInput(target) ||
        !target.isConnected ||
        applied === undefined ||
        read() !== applied
      )
        return false;
      write(original);
      applied = undefined;
      return true;
    },
  };
}

function isWritableInput(element: Element | null): element is HTMLElement {
  if (
    !(element instanceof HTMLElement) ||
    !isComposedVisible(element) ||
    composedClosest(
      element,
      '[translate="no"], [data-lingo-content="exclude"], [hidden], [aria-hidden="true"], [data-lingo-owned], [class*="payment" i], [id*="payment" i]',
    )
  )
    return false;
  const field =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? element
      : undefined;
  if (field?.disabled || field?.readOnly) return false;
  if (
    element instanceof HTMLInputElement &&
    !['text', 'search'].includes(element.type)
  )
    return false;
  const identifying = [
    'name',
    'id',
    'autocomplete',
    'aria-label',
    'placeholder',
  ]
    .map((name) => element.getAttribute(name) ?? '')
    .join(' ');
  if (
    /password|credit|card|cc-|cvc|cvv|payment|one-time-code|\bssn\b/i.test(
      identifying,
    )
  )
    return false;
  return (
    !!field ||
    (element.getAttribute('contenteditable') === 'plaintext-only' &&
      element.childElementCount === 0)
  );
}
