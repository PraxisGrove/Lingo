export type GlossaryEntry = {
  source: string;
  target: string;
};

export type TranslationInstructionTemplate = 'faithful' | 'natural' | 'concise';

export type TranslationQualitySettings = {
  template: TranslationInstructionTemplate;
  instruction: string;
  glossary: GlossaryEntry[];
};

export type TranslationQuality = TranslationQualitySettings & {
  version: string;
};

export const DEFAULT_TRANSLATION_QUALITY: TranslationQualitySettings = {
  template: 'faithful',
  instruction: '',
  glossary: [],
};

const TEMPLATE_INSTRUCTIONS: Record<TranslationInstructionTemplate, string> = {
  faithful: 'Preserve the meaning, tone, and inline markers of the original.',
  natural:
    'Write natural target-language prose while preserving the meaning and inline markers.',
  concise:
    'Use concise target-language prose without omitting meaning or inline markers.',
};

export function resolveTranslationQuality(value?: unknown): TranslationQuality {
  const candidate = isRecord(value) ? value : {};
  const template = isTemplate(candidate.template)
    ? candidate.template
    : DEFAULT_TRANSLATION_QUALITY.template;
  const instruction =
    typeof candidate.instruction === 'string'
      ? candidate.instruction.trim()
      : '';
  const glossary = normalizeGlossary(candidate.glossary);
  return {
    template,
    instruction,
    glossary,
    version: `quality-v1:${stableHash(
      JSON.stringify({ template, instruction, glossary }),
    )}`,
  };
}

export function instructionForQuality(quality: TranslationQuality): string {
  return [TEMPLATE_INSTRUCTIONS[quality.template], quality.instruction]
    .filter(Boolean)
    .join(' ');
}

function isTemplate(value: unknown): value is TranslationInstructionTemplate {
  return value === 'faithful' || value === 'natural' || value === 'concise';
}

function normalizeGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: GlossaryEntry[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.source !== 'string' ||
      typeof entry.target !== 'string'
    )
      continue;
    const source = entry.source.trim();
    const target = entry.target.trim();
    const key = source.toLocaleLowerCase();
    if (!source || !target || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ source, target });
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
