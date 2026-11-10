import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

import { ASSISTANT_TEST_ENV } from './env';

/**
 * Global setup of the `integration` project: one Postgres and one Redis
 * container for the whole run, with the main database's migrations applied
 * (the assistant's tables are part of them). Modelled on
 * packages/api/test/global-setup.ts (same images).
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
    DATABASE_URL: string;
    REDIS_URL: string;
  }
}

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/src/migrations');

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

  // The platform's own migration runner, which validates its environment
  // when imported; this file runs in Vitest's main process where `test.env`
  // does not apply, so the placeholders are set here first.
  Object.assign(process.env, ASSISTANT_TEST_ENV, { DATABASE_URL: databaseUrl, REDIS_URL: redisUrl });
  const { runMigrations } = await import('@campuspilot/db/migrate');
  await runMigrations({ databaseUrl, migrationsFolder: MIGRATIONS_DIR });

  project.provide('DATABASE_URL', databaseUrl);
  project.provide('REDIS_URL', redisUrl);

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
