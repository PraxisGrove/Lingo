/** Keep source literals separate from the protocol's formatting markers. */
export function protectLiteralMarkers(source: string) {
  const literals = new Map<string, string>();
  const text = source.replace(/⟦(?:\/?\d+|KEEP:\d+)⟧/g, (literal) => {
    const id = String(literals.size + 1);
    literals.set(id, literal);
    return `⟦KEEP:${id}⟧`;
  });
  return {
    text,
    restore(translated: string) {
      return translated.replace(
        /⟦KEEP:(\d+)⟧/g,
        (marker, id: string) => literals.get(id) ?? marker,
      );
    },
  };
}

export function preservesInlineMarkers(
  source: string,
  translated: string,
): boolean {
  const pattern = /⟦(?:\/?\d+|KEEP:\d+)⟧/g;
  const expected = source.match(pattern) ?? [];
  const actual = translated.match(pattern) ?? [];
  if (
    JSON.stringify([...expected].sort()) !== JSON.stringify([...actual].sort())
  )
    return false;
  const stack: string[] = [];
  for (const marker of actual) {
    if (marker.startsWith('⟦KEEP:')) continue;
    if (marker.startsWith('⟦/')) {
      if (stack.pop() !== marker.slice(2, -1)) return false;
    } else stack.push(marker.slice(1, -1));
  }
  return stack.length === 0;
}
