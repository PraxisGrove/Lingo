import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['tests/extension/**/*.extension.ts'],
    // A single spec can wait on several cold extension pages; each individual
    // wait is bounded by tests/extension/wait.ts, and this bounds the whole test.
    testTimeout: 90_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // These specs drive a real browser against timed caption and streaming
    // paths. The known-flaky subtitle specs (issue #9) get two CI retries so a
    // slow video or caption frame does not block an unrelated dependency bump.
    retry: process.env.CI ? 2 : 0,
  },
});
