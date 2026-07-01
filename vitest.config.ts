import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    exclude: [
      'src/__tests__/integration.test.ts',
      'src/__tests__/regression/**',
      'node_modules/**',
      'dist/**',
    ],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
