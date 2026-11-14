import { fileURLToPath, URL } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['tests/browser/**/*.browser.ts'],
    // Real browsers on a shared runner need more than the 5s default before a
    // media element reports progress; waits are bounded in ../wait.ts.
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }],
    },
  },
});
