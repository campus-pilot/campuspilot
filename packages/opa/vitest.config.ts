import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 45000,
    hookTimeout: 45000,
    env: {
      SKIP_ENV_VALIDATION: 'true',
    },
  },
});
