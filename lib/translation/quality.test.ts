import { describe, expect, it } from 'vitest';
import { instructionForQuality, resolveTranslationQuality } from './quality';

describe('translation quality', () => {
  it('normalizes glossary constraints and changes the cache version when they change', () => {
    const initial = resolveTranslationQuality({
      template: 'natural',
      instruction: '  Write for engineers.  ',
      glossary: [
        { source: 'Lingo', target: '灵译' },
        { source: 'lingo', target: 'ignored duplicate' },
        { source: '  ', target: 'ignored empty term' },
      ],
    });
    const changed = resolveTranslationQuality({
      ...initial,
      glossary: [{ source: 'Lingo', target: 'Lingo' }],
    });

    expect(initial.glossary).toEqual([{ source: 'Lingo', target: '灵译' }]);
    expect(instructionForQuality(initial)).toContain('Write for engineers.');
    expect(changed.version).not.toBe(initial.version);
  });
});
