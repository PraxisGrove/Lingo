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
});
