import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/regression/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
