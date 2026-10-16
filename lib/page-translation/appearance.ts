export type TranslationAppearance = {
  fontFamily: 'inherit' | 'sans-serif' | 'serif';
  fontScale: number;
  lineHeight: number | null;
  paragraphGap: number;
  color: string | null;
  separator: 'none' | 'line' | 'dashed' | 'border';
};

export const DEFAULT_TRANSLATION_APPEARANCE: TranslationAppearance = {
  fontFamily: 'inherit',
  fontScale: 1,
  lineHeight: null,
  paragraphGap: 0.35,
  color: null,
  separator: 'none',
};

export const TRANSLATION_APPEARANCE_PRESETS = {
  page: DEFAULT_TRANSLATION_APPEARANCE,
  comfortable: {
    ...DEFAULT_TRANSLATION_APPEARANCE,
    fontScale: 1.05,
    lineHeight: 1.8,
    paragraphGap: 0.5,
  },
  separated: {
    ...DEFAULT_TRANSLATION_APPEARANCE,
    paragraphGap: 0.45,
    separator: 'line',
  },
} satisfies Record<string, TranslationAppearance>;

export type TranslationAppearancePreset =
  keyof typeof TRANSLATION_APPEARANCE_PRESETS;

export function resolveTranslationAppearance(
  value: unknown,
): TranslationAppearance {
  const candidate =
    value !== null && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    fontFamily:
      candidate.fontFamily === 'sans-serif' || candidate.fontFamily === 'serif'
        ? candidate.fontFamily
        : 'inherit',
    fontScale: boundedNumber(candidate.fontScale, 0.8, 1.4, 1),
    lineHeight:
      typeof candidate.lineHeight === 'number' &&
      Number.isFinite(candidate.lineHeight)
        ? boundedNumber(candidate.lineHeight, 1.2, 2.2, 1.6)
        : null,
    paragraphGap: boundedNumber(candidate.paragraphGap, 0, 1.5, 0.35),
    color:
      typeof candidate.color === 'string' &&
      /^#[\da-f]{6}$/i.test(candidate.color)
        ? candidate.color.toLowerCase()
        : null,
    separator:
      candidate.separator === 'line' ||
      candidate.separator === 'dashed' ||
      candidate.separator === 'border'
        ? candidate.separator
        : 'none',
  };
}

export function translationAppearancePreset(
  appearance: TranslationAppearance,
): TranslationAppearancePreset | 'custom' {
  return (
    (Object.entries(TRANSLATION_APPEARANCE_PRESETS).find(([, preset]) =>
      (Object.keys(preset) as Array<keyof TranslationAppearance>).every(
        (key) => appearance[key] === preset[key],
      ),
    )?.[0] as TranslationAppearancePreset | undefined) ?? 'custom'
  );
}

export const TRANSLATION_FONT_FAMILIES = {
  'sans-serif': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
} as const;

/** Only bounded values reach the page; this does not accept user CSS. */
export function applyTranslationAppearance(
  source: HTMLElement,
  translation: HTMLElement,
  appearance: TranslationAppearance,
): void {
  const cellHidden = source.hasAttribute('data-lingo-cell-original-hidden');
  const pairedSource = source.hasAttribute('data-lingo-source');
  if (cellHidden) source.removeAttribute('data-lingo-cell-original-hidden');
  if (pairedSource) source.removeAttribute('data-lingo-source');
  const computed = source.ownerDocument.defaultView?.getComputedStyle(source);
  const fontSize = Number.parseFloat(computed?.fontSize ?? '') || 16;
  const sourceLineHeight = Number.parseFloat(computed?.lineHeight ?? '');
  const set = (property: string, value: string) =>
    translation.style.setProperty(property, value, 'important');
  set('font-size', `${fontSize * appearance.fontScale}px`);
  set(
    'font-family',
    appearance.fontFamily === 'inherit'
      ? computed?.fontFamily || 'inherit'
      : TRANSLATION_FONT_FAMILIES[appearance.fontFamily],
  );
  set('color', appearance.color ?? computed?.color ?? 'inherit');
  // Headings keep the source's rhythm. A paragraph preference should not make
  // a two-line title as loose as body copy.
  const heading = /^H[1-6]$/.test(source.tagName);
  set(
    'line-height',
    appearance.lineHeight !== null && !heading
      ? String(appearance.lineHeight)
      : Number.isFinite(sourceLineHeight)
        ? `${sourceLineHeight * appearance.fontScale}px`
        : 'normal',
  );
  set('font-weight', computed?.fontWeight || 'inherit');
  translation.style.setProperty(
    '--lingo-source-margin-after',
    computed?.marginBlockEnd || '0px',
  );
  translation.style.setProperty(
    '--lingo-paragraph-gap',
    `${appearance.paragraphGap}em`,
  );
  translation.dataset.lingoSeparator = appearance.separator;
  translation.dataset.lingoLayout = heading
    ? 'heading'
    : ['TD', 'TH', 'LI', 'FIGCAPTION'].includes(source.tagName)
      ? 'compact'
      : 'body';
  if (cellHidden) source.setAttribute('data-lingo-cell-original-hidden', '');
  if (pairedSource) source.setAttribute('data-lingo-source', '');
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(maximum, Math.max(minimum, value)) * 100) / 100
    : fallback;
}
