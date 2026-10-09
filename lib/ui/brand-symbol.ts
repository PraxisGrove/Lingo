import symbolSource from '@/assets/brand/lingo-symbol.svg?raw';

/** Decorative product mark; the enclosing control supplies its accessible name. */
export function createBrandSymbol(document: Document): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = symbolSource;
  const symbol = template.content.firstElementChild as SVGSVGElement;
  symbol.removeAttribute('role');
  symbol.removeAttribute('aria-label');
  symbol.setAttribute('aria-hidden', 'true');
  symbol.setAttribute('focusable', 'false');
  return symbol;
}
