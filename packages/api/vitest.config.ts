import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 45000,
    hookTimeout: 45000,
  },
});
