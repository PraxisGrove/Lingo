import { preservesInlineMarkers } from './inline-markers';
import type { TranslationUnit } from './types';

type Piece = {
  unit: TranslationUnit;
  prefix: string[];
  suffix: string[];
  source: string;
};

/** Split text without breaking code points or opaque tokens. Reopen formatting
 * at chunk boundaries; remove only those synthetic markers on reassembly. */
export function splitLongUnit(unit: TranslationUnit, budget: number): Piece[] {
  if (unit.text.length <= budget)
    return [{ unit, prefix: [], suffix: [], source: unit.text }];
  const stack: string[] = [];
  const pieces: Piece[] = [];
  let source = '';
  let prefix: string[] = [];
  const closeMarkers = () => [...stack].reverse().map((id) => `⟦/${id}⟧`);
  const finish = () => {
    if (!source) return;
    const suffix = closeMarkers();
    pieces.push({
      unit: {
        ...unit,
        id: `${unit.id}:part:${pieces.length}`,
        text: prefix.join('') + source + suffix.join(''),
      },
      prefix,
      suffix,
      source,
    });
    source = '';
    prefix = stack.map((id) => `⟦${id}⟧`);
  };
  const atoms = unit.text.match(/⟦(?:\/?\d+|KEEP:\d+)⟧|[^\s⟦]+|\s+|⟦/gu) ?? [];
  for (const atom of atoms) {
    const tokens =
      atom.startsWith('⟦') && /^⟦(?:\/?\d+|KEEP:\d+)⟧$/.test(atom)
        ? [atom]
        : atom.length > budget / 2
          ? [...atom]
          : [atom];
    for (const token of tokens) {
      const closing = /^⟦\/(\d+)⟧$/.exec(token);
      const opening = /^⟦(\d+)⟧$/.exec(token);
      // Reserve space for closing all markers, including a new opening.
      const extra = opening ? `⟦/${opening[1]}⟧`.length : 0;
      const removed = closing ? token.length : 0;
      if (
        prefix.join('').length +
          source.length +
          token.length +
          closeMarkers().join('').length +
          extra -
          removed >
        budget
      )
        finish();
      if (
        prefix.join('').length +
          token.length +
          closeMarkers().join('').length +
          extra -
          removed >
        budget
      ) {
        throw Object.assign(
          new Error('Inline formatting exceeds the service text budget.'),
          { category: 'invalid-request' },
        );
      }
      source += token;
      if (opening) stack.push(opening[1]);
      if (closing) stack.pop();
    }
  }
  finish();
  return pieces;
}

export function joinLongUnit(
  pieces: Piece[],
  results: Map<string, string>,
): string | undefined {
  let joined = '';
  for (const piece of pieces) {
    let text = results.get(piece.unit.id);
    if (
      text === undefined ||
      (!text.trim() && piece.unit.text.trim().length > 0) ||
      !preservesInlineMarkers(piece.unit.text, text)
    )
      return undefined;
    for (const marker of [...piece.prefix, ...piece.suffix])
      text = text.replace(marker, '');
    const leading = /^\s+/.exec(piece.source)?.[0] ?? '';
    const trailing = /\s+$/.exec(piece.source)?.[0] ?? '';
    if (leading && !/^\s/.test(text)) text = leading + text;
    if (trailing && !/\s$/.test(text)) text += trailing;
    joined += text;
  }
  return joined;
}
