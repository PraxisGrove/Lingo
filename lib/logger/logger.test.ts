import { describe, expect, it } from 'vitest';
import { shouldLog } from './logger';

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
