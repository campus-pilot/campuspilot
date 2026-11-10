import { defineConfig } from 'vitest/config';

import { ASSISTANT_TEST_ENV } from './test/env.ts';

/** Tests that need Postgres and Redis; everything else is a pure unit test. */
const INTEGRATION_TESTS = 'src/**/*.integration.test.ts';

/**
 * Two projects, so the pure tests stay runnable without Docker:
 * - `unit` (`pnpm test:unit`): no containers, no network.
 * - `integration` (`pnpm test:integration`): starts a Postgres and a Redis
 *   container once (test/global-setup.ts) and points each test file at them
 *   (test/setup.ts). Its global setup only runs when the project is selected.
 * `pnpm test` runs both.
 *
 * Both get the placeholder environment (test/env.ts), so no test reads a
 * developer's `.env` or its API keys.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [INTEGRATION_TESTS],
          env: ASSISTANT_TEST_ENV,
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: [INTEGRATION_TESTS],
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/setup.ts'],
          // Run events carry the model and token usage only with diagnostics
          // on, and the turn tests assert what subscribers are told.
          env: { ...ASSISTANT_TEST_ENV, ASSISTANT_DIAGNOSTICS: 'true' },
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
