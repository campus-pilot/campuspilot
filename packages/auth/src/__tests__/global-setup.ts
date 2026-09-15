import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

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

let postgresContainer: StartedPostgreSqlContainer | undefined;
let redisContainer: StartedRedisContainer | undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../packages/db/src/migrations',
);

export default async function setup(project: TestProject) {
  const [pgContainer, rdContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6')
      .withDatabase('campuspilot_test')
      .withUsername('postgres')
      .withPassword('password')
      .start(),
    new RedisContainer('redis:8.10.1-alpine').start(),
  ]);

  postgresContainer = pgContainer;
  redisContainer = rdContainer;

  const databaseUrl = pgContainer.getConnectionUri();
  const redisUrl = rdContainer.getConnectionUrl();

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const migrationDb = drizzle(pool);
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_DIR });
  await pool.end();

  project.provide('DATABASE_URL', databaseUrl);
  project.provide('REDIS_URL', redisUrl);

  return async () => {
    await Promise.all([
      postgresContainer?.stop(),
      redisContainer?.stop(),
    ]);
  };
}
