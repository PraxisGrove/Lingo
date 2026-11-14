/**
 * Default action timeout for the installed-extension suites.
 *
 * These specs drive a real browser with the unpacked extension loaded: the
 * first paint of a panel or options page waits for the service worker, storage
 * hydration, and localized resources. Ten seconds was occasionally too tight on
 * cold workers and turned a slow first render into a failure, so actions get the
 * same budget as the enclosing test.
 */
export const EXTENSION_ACTION_TIMEOUT = 30_000;
