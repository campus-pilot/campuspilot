import { afterAll, inject } from 'vitest';
import { TEST_S3_ACCESS_KEY_ID, TEST_S3_SECRET_ACCESS_KEY } from './storage-config';

process.env.DATABASE_URL = inject('DATABASE_URL');
process.env.REDIS_URL = inject('REDIS_URL');
process.env.OPA_URL = inject('OPA_URL');
process.env.S3_ENDPOINT = inject('S3_ENDPOINT');
process.env.S3_BUCKET = inject('S3_BUCKET');
process.env.S3_REGION = 'us-east-1';
process.env.S3_ACCESS_KEY_ID = TEST_S3_ACCESS_KEY_ID;
process.env.S3_SECRET_ACCESS_KEY = TEST_S3_SECRET_ACCESS_KEY;
process.env.S3_FORCE_PATH_STYLE = 'true';

process.env.NODE_ENV = 'test';
process.env.SYSTEM_ADMIN_EMAIL = 'admin@campuspilot.test';
process.env.BETTER_AUTH_SECRET =
  'a-super-secret-key-that-is-at-least-32-chars-long!';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.MCP_RESOURCE_URL = 'http://localhost:3000/mcp';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.PUBLIC_APP_URL = 'http://localhost:3001';
process.env.CORS_ORIGIN = 'http://localhost:3001';
process.env.GOTENBERG_URL = inject('GOTENBERG_URL');
process.env.RESTATE_ADMIN_URL = 'http://localhost:9070';
process.env.RESTATE_FABRIC_URL = 'http://localhost:8080';
process.env.RESTATE_INGRESS_URL = 'http://localhost:8080';

// Ignore postgres pool connection termination on container shutdown (57P01 admin_shutdown)
process.on('uncaughtException', (err: unknown) => {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === '57P01'
  ) {
    return;
  }
  console.error('Uncaught Exception:', err);
});

/**
 * Vitest isolates test files, so every file re-imports `@campuspilot/db` and
 * `@campuspilot/auth/server` and gets fresh pg pools (max 10 connections
 * each). Nothing else ends them, so their idle connections would outlive the
 * file and, with one worker per core, exhaust the test database's
 * connections. The dynamic imports resolve to the instances this file used.
 */
afterAll(async () => {
  const [{ db }, { authDb }] = await Promise.all([
    import('@campuspilot/db'),
    import('@campuspilot/auth/server'),
  ]);
  await Promise.all([db.$client.end(), authDb.$client.end()]);
});
