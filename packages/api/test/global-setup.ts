import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
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
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
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
    GOTENBERG_URL: string;
    DATABASE_URL: string;
    REDIS_URL: string;
    OPA_URL: string;
    S3_ENDPOINT: string;
    S3_BUCKET: string;
  }
}

let postgresContainer: StartedPostgreSqlContainer | undefined;
let redisContainer: StartedRedisContainer | undefined;
let opaContainer: StartedTestContainer | undefined;
let minioContainer: StartedTestContainer | undefined;
let gotenbergContainer: StartedTestContainer | undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICIES_DIR = path.resolve(
  __dirname,
  '../../../packages/opa/src/policies',
);
const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../packages/db/src/migrations',
);
const TEST_BUCKET = 'campuspilot';

export default async function setup(project: TestProject) {
  // Spin up all dev-stack testcontainers in parallel
  const [pgContainer, rdContainer, opContainer, mnContainer, pdfContainer] =
    await Promise.all([
      new PostgreSqlContainer('postgres:18.6')
        .withDatabase('campuspilot_test')
        .withUsername('postgres')
        .withPassword('password')
        .start(),
      new RedisContainer('redis:8.10.1-alpine').start(),
      new GenericContainer('openpolicyagent/opa:1.20.2')
        .withCommand(['run', '--server', '--addr=0.0.0.0:8181', '/policies'])
        .withExposedPorts(8181)
        .withBindMounts([
          {
            source: POLICIES_DIR,
            target: '/policies',
            mode: 'ro',
          },
        ])
        .withWaitStrategy(Wait.forHttp('/health', 8181))
        .start(),
      new GenericContainer('minio/minio:latest')
        .withCommand(['server', '/data'])
        .withEnvironment({
          MINIO_ROOT_USER: 'minioadmin',
          MINIO_ROOT_PASSWORD: 'minioadmin',
        })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
        .start(),
      new GenericContainer('gotenberg/gotenberg:8.36.0')
        .withEnvironment({
          CHROMIUM_DISABLE_JAVASCRIPT: 'true',
          CHROMIUM_DENY_PRIVATE_IPS: 'true',
          CHROMIUM_DENY_PUBLIC_IPS: 'true',
        })
        .withExposedPorts(3000)
        .withWaitStrategy(Wait.forHttp('/health', 3000))
        .start(),
    ]);

  postgresContainer = pgContainer;
  redisContainer = rdContainer;
  opaContainer = opContainer;
  minioContainer = mnContainer;
  gotenbergContainer = pdfContainer;

  const databaseUrl = pgContainer.getConnectionUri();
  const redisUrl = rdContainer.getConnectionUrl();
  const opaUrl = `http://${opContainer.getHost()}:${opContainer.getMappedPort(8181)}`;
  const s3Endpoint = `http://${mnContainer.getHost()}:${mnContainer.getMappedPort(9000)}`;

  // 1. Run database migrations
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const migrationDb = drizzle(pool);
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_DIR });
  await pool.end();

  // 2. Initialize S3 Bucket in MinIO
  const s3 = new S3Client({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    },
    forcePathStyle: true,
  });
  await s3
    .send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
    .catch(() => {});

  // 3. Provide connection information to Vitest workers
  project.provide(
    'GOTENBERG_URL',
    `http://${pdfContainer.getHost()}:${pdfContainer.getMappedPort(3000)}`,
  );
  project.provide('DATABASE_URL', databaseUrl);
  project.provide('REDIS_URL', redisUrl);
  project.provide('OPA_URL', opaUrl);
  project.provide('S3_ENDPOINT', s3Endpoint);
  project.provide('S3_BUCKET', TEST_BUCKET);

  return async () => {
    await Promise.all([
      postgresContainer?.stop(),
      redisContainer?.stop(),
      opaContainer?.stop(),
      minioContainer?.stop(),
      gotenbergContainer?.stop(),
    ]);
  };
}
