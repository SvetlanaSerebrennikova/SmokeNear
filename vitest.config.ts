import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /** Live NEAR / 1Click HTTP calls can exceed Vitest's 5s default. */
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
