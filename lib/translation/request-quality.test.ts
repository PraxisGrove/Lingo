import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import { resolveRequestQuality } from './request-quality';

describe('resolveRequestQuality', () => {
  it('applies matching site terms before global glossary entries', () => {
    const quality = resolveRequestQuality(
      {
        ...DEFAULT_SETTINGS,
        translationQuality: {
          ...DEFAULT_SETTINGS.translationQuality,
          glossary: [
            { source: 'API', target: 'global API' },
            { source: 'Lingo', target: 'Lingo' },
          ],
        },
        siteGlossaries: {
          'docs.example.com': [{ source: 'API', target: '接口' }],
        },
      },
      'docs.example.com',
    );

    expect(quality.glossary).toEqual([
      { source: 'API', target: '接口' },
      { source: 'Lingo', target: 'Lingo' },
    ]);
  });
});
