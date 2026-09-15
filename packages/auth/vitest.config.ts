import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/__tests__/global-setup.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 45000,
    hookTimeout: 45000,
  },
});
