import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/integration.test.ts'],
    setupFiles: ['src/__tests__/integration.setup.ts'],
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
