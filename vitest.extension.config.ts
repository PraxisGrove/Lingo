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
    // paths; one retry on CI separates a slow frame from a real regression.
    retry: process.env.CI ? 1 : 0,
  },
});
