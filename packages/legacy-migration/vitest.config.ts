import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: [
      'src/**/*.test.ts',
      '../api/src/routers/school/document/document.catalog.test.ts',
    ],
  },
});
