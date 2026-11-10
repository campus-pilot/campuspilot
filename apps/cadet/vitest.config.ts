import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Component and helper tests run in jsdom. `@/` and
 * `@campuspilot/components/` mirror the tsconfig paths (Vite does not follow
 * the package's array-valued `exports` fallbacks),
 * and the public server URL is a fixed test value so the auth and oRPC
 * clients can be constructed; tests never reach a server.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) },
      { find: /^@campuspilot\/components\//, replacement: fileURLToPath(new URL('../../packages/components/src/', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['{app,components,lib}/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    env: { NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000' },
  },
});
