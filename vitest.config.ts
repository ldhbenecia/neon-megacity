import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    // Layout generation takes about a second and stretches past the 5 s default on a loaded machine.
    testTimeout: 30_000,
  },
});
