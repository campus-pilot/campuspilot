import { afterAll, inject } from 'vitest';

/**
 * Per-file setup of the `integration` project. Runs before the test file's
 * imports, so the service's modules read the containers' URLs when they
 * validate the environment.
 */
process.env.ASSISTANT_DATABASE_URL = inject('ASSISTANT_DATABASE_URL');
process.env.REDIS_URL = inject('REDIS_URL');

// Ignore postgres pool connection termination on container shutdown (57P01 admin_shutdown)
process.on('uncaughtException', (err: unknown) => {
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '57P01') {
    return;
  }
  console.error('Uncaught Exception:', err);
});

/**
 * Vitest isolates test files, so every file gets its own pg pool and Redis
 * client. Nothing else closes them; left open they would outlive the file
 * and hold the worker (and the containers' connections) until it is killed.
 * The dynamic imports resolve to the instances the test file used.
 */
afterAll(async () => {
  const [{ db }, { getRedis }] = await Promise.all([import('../src/db/client'), import('../src/redis')]);
  getRedis().disconnect();
  await db.$client.end();
});
