import fs from 'node:fs';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

import { ASSISTANT_TEST_ENV } from './env';

/**
 * Global setup of the `integration` project: one Postgres and one Redis
 * container for the whole run, with the assistant's own migrations applied.
 * Modelled on packages/api/test/global-setup.ts (same images).
 */

// Auto-detect Docker Desktop for Linux or host Docker socket
if (!process.env.DOCKER_HOST && !fs.existsSync('/var/run/docker.sock')) {
  const desktopSock = `${process.env.HOME}/.docker/desktop/docker.sock`;
  if (fs.existsSync(desktopSock)) {
    process.env.DOCKER_HOST = `unix://${desktopSock}`;
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    ASSISTANT_DATABASE_URL: string;
    REDIS_URL: string;
  }
}

export default async function setup(project: TestProject) {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6')
      .withDatabase('campuspilot_assistant_test')
      .withUsername('postgres')
      .withPassword('password')
      .start(),
    new RedisContainer('redis:8.10.1-alpine').start(),
  ]);
  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  // The migrations are applied by the service's own `migrateAssistantDatabase`
  // (same folder, schema and journal table as at boot), not by a copy of it.
  // That module validates the environment when it is imported, and this file
  // runs in Vitest's main process where `test.env` does not apply, so the
  // placeholders are set here first; set variables also keep dotenv from
  // loading a developer's `.env` over them.
  Object.assign(process.env, ASSISTANT_TEST_ENV, {
    ASSISTANT_DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
  });
  const { db, migrateAssistantDatabase } = await import('../src/db/client');
  try {
    await migrateAssistantDatabase();
  } finally {
    await db.$client.end();
  }

  project.provide('ASSISTANT_DATABASE_URL', databaseUrl);
  project.provide('REDIS_URL', redisUrl);

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
