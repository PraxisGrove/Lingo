import { composedClosest } from '../page-translation/composed-dom';

export type InputTranslation = {
  original: string;
  apply(text: string): boolean;
  undo(): boolean;
};

/** Capture only the explicitly targeted plain text field. Never overwrite
 * subsequent user edits when a slow request completes or undo is pressed. */
export function captureInput(
  element: Element | null,
): InputTranslation | undefined {
  if (
    !(element instanceof HTMLElement) ||
    composedClosest(
      element,
      '[translate="no"], [data-lingo-owned], [class*="payment" i], [id*="payment" i]',
    )
  )
    return;
  const target = element;
  const field =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? element
      : undefined;
  if (field?.disabled || field?.readOnly) return;
  if (
    element instanceof HTMLInputElement &&
    !['text', 'search'].includes(element.type)
  )
    return;
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
    return;
  if (
    !field &&
    !(
      element.getAttribute('contenteditable') === 'plaintext-only' ||
      (element.isContentEditable && element.childElementCount === 0)
    )
  )
    return;
  const read = () => (field ? field.value : (element.textContent ?? ''));
  const original = read();
  if (!original.trim()) return;
  let applied: string | undefined;
  function write(text: string) {
    if (field) {
      // Native setter also works with controlled React inputs.
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
    apply(text) {
      if (!element.isConnected || read() !== original || applied !== undefined)
        return false;
      write(text);
      applied = text;
      return true;
    },
    undo() {
      if (!element.isConnected || applied === undefined || read() !== applied)
        return false;
      write(original);
      applied = undefined;
      return true;
    },
  };
}
