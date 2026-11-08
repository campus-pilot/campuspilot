import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Test files that assert platform-wide aggregates (counts across every
 * school). Every other file writes rows for its own schools in parallel, so
 * these files can only be deterministic while nothing else writes: they run in
 * a later project group, after the parallel group has finished.
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
    // Root-level, so one container stack serves both project groups; projects
    // inherit the values it provides.
    globalSetup: ['./test/global-setup.ts'],
    projects: [
      {
        test: {
          ...sharedTestOptions,
          name: 'school-scoped',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...PLATFORM_WIDE_TEST_FILES],
        },
      },
      {
        test: {
          ...sharedTestOptions,
          name: 'platform-wide',
          include: PLATFORM_WIDE_TEST_FILES,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
