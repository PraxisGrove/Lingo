import { vi } from 'vitest';

/**
 * `vi.waitFor` defaults to a one-second timeout, which is shorter than the first
 * paint of an options page or side panel that is waiting for the extension
 * service worker and storage hydration. Polling with a budget that matches a
 * cold worker keeps a slow render from being reported as a broken feature.
 */
export function waitFor<T>(
  condition: () => T | Promise<T>,
  options: { timeout?: number; interval?: number } = {},
): Promise<T> {
  return vi.waitFor(condition, { timeout: 15_000, interval: 100, ...options });
}
