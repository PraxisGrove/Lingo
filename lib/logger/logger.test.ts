import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, shouldLog } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldLog', () => {
  it('allows logs at or above the configured level', () => {
    expect(shouldLog('warn', 'warn')).toBe(true);
    expect(shouldLog('error', 'warn')).toBe(true);
  });

  it('filters logs below the configured level', () => {
    expect(shouldLog('debug', 'warn')).toBe(false);
    expect(shouldLog('info', 'warn')).toBe(false);
  });

  it('filters all logs when configured as silent', () => {
    expect(shouldLog('error', 'silent')).toBe(false);
  });
});

describe('createLogger', () => {
  it('keeps error details visible when console arguments are stringified', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('background', 'error');

    logger.error('Translation request failed.', {
      error: Object.assign(new Error('Provider unavailable.'), {
        category: 'network',
      }),
    });

    const rendered = write.mock.calls[0]?.map(String).join(' ');
    expect(rendered).toContain('Provider unavailable.');
    expect(rendered).toContain('network');
    expect(rendered).not.toContain('[object Object]');
  });

  it('redacts private translation context and URLs', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('translation', 'error');

    logger.error('Provider request failed.', {
      endpoint: 'https://private.example/v1',
      credential: 'secret-key',
      units: [{ id: 'one', text: 'private paragraph' }],
      siteGlossaries: {
        'private.example': [{ source: 'Codename', target: '机密代号' }],
      },
      error: new Error('Request to https://private.example/v1 failed.'),
      category: 'network',
    });

    const rendered = write.mock.calls[0]?.map(String).join(' ');
    expect(rendered).toContain('network');
    expect(rendered).toContain('[Redacted]');
    expect(rendered).not.toContain('private.example');
    expect(rendered).not.toContain('secret-key');
    expect(rendered).not.toContain('private paragraph');
  });
});
