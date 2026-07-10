import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings } from './settings-model';

describe('resolveSettings', () => {
  it('returns defaults for empty values', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid settings', () => {
    expect(resolveSettings({ enabled: false, theme: 'dark' })).toEqual({
      enabled: false,
      theme: 'dark',
    });
  });

  it('falls back when values are invalid', () => {
    expect(resolveSettings({ enabled: 'yes', theme: 'blue' } as never)).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});
