import { configDefaults, defineConfig } from 'vitest/config';

/**
 * TEST-ONLY WORKAROUND, not a fix. These files post finance facts in
 * SERIALIZABLE transactions. In the small test database every school's rows
 * share the same heap and index pages, so PostgreSQL's predicate (SIREAD)
 * locks, taken at page or relation granularity there, make transactions of
 * different schools look dependent and abort each other with serialization
 * failures (40001) when these files run in parallel. Each file passes alone.
 *
 * Production has the same exposure in principle and no backoff yet: billing
 * runs are not retried and ledger operations retry three times immediately.
 * Until that is decided, these files run one at a time in their own group
 * (file parallelism off), after the parallel group.
 */
const SERIAL_FINANCE_TEST_FILES = [
  'src/routers/school/billing/billing-operations.router.integration.test.ts',
  'src/routers/school/billing/ledger-operations.router.integration.test.ts',
  'src/routers/school/document/finance-document.integration.test.ts',
  'src/workflows/demo-school/demo-seed.integration.test.ts',
];

/**
 * Test files that assert platform-wide aggregates (counts across every
 * school). Every other file writes rows for its own schools, so these files
 * can only be deterministic while nothing else writes: they run last, after
 * every other group has finished.
 */
const PLATFORM_WIDE_TEST_FILES = [
  'src/routers/system-admin/stats/stats.router.integration.test.ts',
];

const sharedTestOptions = {
  environment: 'node' as const,
  setupFiles: ['./test/setup.ts'],
  testTimeout: 45000,
  hookTimeout: 45000,
};

export default defineConfig({
  test: {
    // Root-level, so one container stack serves every project group; projects
    // inherit the values it provides.
    globalSetup: ['./test/global-setup.ts'],
    projects: [
      {
        test: {
          ...sharedTestOptions,
          name: 'school-scoped',
          include: ['src/**/*.test.ts'],
          exclude: [
            ...configDefaults.exclude,
            ...SERIAL_FINANCE_TEST_FILES,
            ...PLATFORM_WIDE_TEST_FILES,
          ],
        },
      },
      {
        test: {
          ...sharedTestOptions,
          name: 'serial-finance',
          include: SERIAL_FINANCE_TEST_FILES,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          ...sharedTestOptions,
          name: 'platform-wide',
          include: PLATFORM_WIDE_TEST_FILES,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
