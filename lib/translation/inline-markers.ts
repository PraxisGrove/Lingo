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
