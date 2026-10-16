import { describe, expect, it } from 'vitest';
import {
  isProviderIconPreference,
  MAX_PROVIDER_ICON_DATA_URL_LENGTH,
  PROVIDER_ICON_IDS,
  parseProviderIconPreference,
} from './provider-icon-model';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=';

describe('provider icon preference', () => {
  it.each(PROVIDER_ICON_IDS)('accepts the predefined %s icon', (providerId) => {
    expect(
      parseProviderIconPreference({ type: 'provider', providerId }),
    ).toEqual({ type: 'provider', providerId });
  });

  it.each([
    png,
    `data:image/webp;base64,${btoa('RIFF\x04\x00\x00\x00WEBP')}`,
    `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xd9')}`,
  ])('accepts a bounded raster data URL with matching MIME and signature', (dataUrl) => {
    expect(isProviderIconPreference({ type: 'image', dataUrl })).toBe(true);
    expect(parseProviderIconPreference({ type: 'image', dataUrl })).toEqual({
      type: 'image',
      dataUrl,
    });
  });

  it.each([
    undefined,
    null,
    [],
    { type: 'provider', providerId: 'unknown' },
    { type: 'provider', providerId: 'openai', endpoint: 'https://example.com' },
    { type: 'provider', providerId: 1 },
    { type: 'image', dataUrl: 'https://example.com/logo.png' },
    { type: 'image', dataUrl: 'javascript:alert(1)' },
    { type: 'image', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    { type: 'image', dataUrl: 'data:image/gif;base64,R0lGODlh' },
    { type: 'image', dataUrl: 'data:image/png;base64,' },
    { type: 'image', dataUrl: 'data:image/png;base64,abc*' },
    { type: 'image', dataUrl: 'data:image/png;base64,abcd===' },
    { type: 'image', dataUrl: 'data:image/png;base64,abc\n' },
    { type: 'image', dataUrl: 'data:image/png;base64,你' },
    {
      type: 'image',
      dataUrl: `data:image/png;base64,${btoa('<svg onload="alert(1)"></svg>')}`,
    },
    { type: 'image', dataUrl: png, secret: 'key' },
  ])('rejects an invalid icon preference %j', (value) => {
    expect(parseProviderIconPreference(value)).toBeUndefined();
    expect(isProviderIconPreference(value)).toBe(false);
  });

  it('rejects oversized image preferences before decoding them', () => {
    const dataUrl = `data:image/png;base64,${btoa(`\x89PNG\r\n\x1a\n${'a'.repeat(MAX_PROVIDER_ICON_DATA_URL_LENGTH)}`)}`;
    expect(dataUrl.length).toBeGreaterThan(MAX_PROVIDER_ICON_DATA_URL_LENGTH);
    expect(
      parseProviderIconPreference({ type: 'image', dataUrl }),
    ).toBeUndefined();
  });

  it('returns an independent object rather than preserving external mutation references', () => {
    const original = { type: 'provider', providerId: 'openai' };
    const parsed = parseProviderIconPreference(original);
    original.providerId = 'unknown';
    expect(parsed).toEqual({ type: 'provider', providerId: 'openai' });
  });
});
