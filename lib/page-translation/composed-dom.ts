/** Walk accessible roots without entering Lingo's own UI. Closed roots stay private. */
export function accessibleRoots(
  root: Document | ShadowRoot | Element,
): Array<Document | ShadowRoot | Element> {
  const roots: Array<Document | ShadowRoot | Element> = [root];
  for (let index = 0; index < roots.length; index += 1) {
    const current = roots[index];
    const elements =
      current instanceof Element
        ? [current, ...current.querySelectorAll('*')]
        : [...current.querySelectorAll('*')];
    for (const element of elements) {
      if (
        element.shadowRoot &&
        !composedClosest(
          element,
          '[data-lingo-owned], [data-lingo-floating-control]',
        )
      ) {
        roots.push(element.shadowRoot);
      }
    }
  }
  return roots;
}

export function composedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function composedClosest(
  element: Element,
  selector: string,
): Element | null {
  let current: Element | null = element;
  while (current) {
    if (current.matches(selector)) return current;
    current = composedParent(current);
  }
  return null;
}

export function composedContains(parent: Element, child: Element): boolean {
  let current: Element | null = child;
  while (current) {
    if (current === parent) return true;
    current = composedParent(current);
  }
  return false;
}

export function isComposedVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  let current: Element | null = element;
  while (current) {
    if (
      current.parentElement instanceof HTMLSlotElement &&
      current.parentElement.assignedNodes().length > 0
    )
      return false;
    if (current.parentElement?.shadowRoot && !current.assignedSlot)
      return false;
    const style = view.getComputedStyle(current);
    if (
      style.opacity === '0' ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.getPropertyValue('content-visibility') === 'hidden'
    ) {
      return false;
    }
    current = composedParent(current);
  }
  return true;
}
