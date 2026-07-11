import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings } from './settings-model';

describe('resolveSettings', () => {
  it('returns defaults for empty values', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid settings', () => {
    expect(
      resolveSettings({ schemaVersion: 1, enabled: false, theme: 'dark' }),
    ).toEqual({
      schemaVersion: 1,
      enabled: false,
      theme: 'dark',
    });
  });

  it('migrates settings saved before schema versioning', () => {
    expect(resolveSettings({ enabled: false, theme: 'light' })).toEqual({
      schemaVersion: 1,
      enabled: false,
      theme: 'light',
    });
  });

  it('falls back safely for an unknown future schema', () => {
    expect(
      resolveSettings({
        schemaVersion: 99,
        enabled: false,
        theme: 'dark',
      } as never),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back when values are invalid', () => {
    expect(resolveSettings({ enabled: 'yes', theme: 'blue' } as never)).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});
