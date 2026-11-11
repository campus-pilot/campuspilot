import { afterAll, inject } from 'vitest';

/**
 * Per-file setup of the `integration` project. Runs before the test file's
 * imports, so every module reads the containers' URLs when it validates the
 * environment.
 */
process.env.DATABASE_URL = inject('DATABASE_URL');
process.env.REDIS_URL = inject('REDIS_URL');

// Ignore postgres pool connection termination on container shutdown (57P01 admin_shutdown)
process.on('uncaughtException', (err: unknown) => {
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '57P01') {
    return;
  }
  console.error('Uncaught Exception:', err);
});

/**
 * Vitest isolates test files, so every file gets its own pg pools and Redis
 * client. Nothing else closes them; left open they would outlive the file
 * and hold the worker (and the containers' connections) until it is killed.
 * The dynamic imports resolve to the instances the test file used.
 */
afterAll(async () => {
  const [{ db }, { authDb }, { getRedis }, { getRedisClient }] = await Promise.all([
    import('@campuspilot/db'),
    import('@campuspilot/auth/server'),
    import('../src/redis'),
    import('@campuspilot/redis/client'),
  ]);
  getRedis().disconnect();
  // The API's own client (spend and usage caches), when a test used it.
  getRedisClient().disconnect();
  await Promise.all([db.$client.end(), authDb.$client.end()]);
});
