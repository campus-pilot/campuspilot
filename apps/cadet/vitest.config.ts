import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Component and helper tests run in jsdom. `@/` mirrors the tsconfig path;
 * `@campuspilot/components/notifications` points at its directory index,
 * which the package's `exports` fallback array names but Vite does not try,
 * and the public server URL is a fixed test value so the auth and oRPC
 * clients can be constructed; tests never reach a server.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      '@campuspilot/components/notifications': fileURLToPath(
        new URL('../../packages/components/src/notifications/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['{app,components,lib}/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    env: { NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000' },
  },
});
