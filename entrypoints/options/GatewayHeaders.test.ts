import { describe, expect, it } from 'vitest';
import {
  headerDraftError,
  headerDraftsFor,
  splitHeaderDrafts,
} from './GatewayHeaders';

describe('gateway header drafts', () => {
  it('keeps secret values out of profile headers', () => {
    expect(
      splitHeaderDrafts([
        { name: 'X-Route', value: 'fast', secret: false },
        { name: 'X-Token', value: 'abc', secret: true },
        { name: 'X-Saved', value: '', secret: true, stored: true },
        { name: 'X-Empty', value: '', secret: true },
        { name: '', value: '', secret: false },
      ]),
    ).toEqual({
      headers: [
        { name: 'X-Route', value: 'fast' },
        { name: 'X-Token' },
        { name: 'X-Saved' },
      ],
      secrets: { 'X-Token': 'abc' },
    });
  });

  it('marks saved secret headers so an empty field keeps the stored value', () => {
    expect(
      headerDraftsFor({
        id: 'p',
        name: 'P',
        provider: 'openai-compatible',
        headers: [{ name: 'X-Token' }, { name: 'X-Route', value: 'fast' }],
      }),
    ).toEqual([
      { name: 'X-Token', value: '', secret: true, stored: true },
      { name: 'X-Route', value: 'fast', secret: false },
    ]);
  });

  it('rejects reserved or malformed names but ignores empty rows', () => {
    expect(
      headerDraftError({ name: 'Authorization', value: 'x', secret: true }),
    ).toBe(true);
    expect(
      headerDraftError({ name: 'bad name', value: '', secret: false }),
    ).toBe(true);
    expect(headerDraftError({ name: '', value: '', secret: false })).toBe(
      false,
    );
  });
});
