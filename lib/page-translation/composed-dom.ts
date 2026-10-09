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
