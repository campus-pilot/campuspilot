import { afterEach, describe, expect, it } from 'vitest';

import {
  assertTargetWritersDisabled,
  kubernetesWriterFenceConfig,
  sourceS3Config,
  sourceDatabaseUrl,
} from './config.ts';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('migration runtime configuration', () => {
  it('has no implicit source database or object-store credentials', () => {
    delete process.env.LEGACY_SNAPSHOT_DATABASE_URL;
    expect(() => sourceDatabaseUrl()).toThrow(
      /LEGACY_SNAPSHOT_DATABASE_URL is required/,
    );

    delete process.env.LEGACY_S3_BUCKET;
    expect(() => sourceS3Config()).toThrow(/LEGACY_S3_BUCKET is required/);
  });

  it('supports AWS defaults and explicit S3-compatible overrides', () => {
    Object.assign(process.env, {
      LEGACY_S3_BUCKET: 'synthetic-bucket',
      LEGACY_S3_REGION: 'ap-south-1',
      LEGACY_S3_ACCESS_KEY_ID: 'synthetic-access-key',
      LEGACY_S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
    });
    delete process.env.LEGACY_S3_ENDPOINT;
    delete process.env.LEGACY_S3_FORCE_PATH_STYLE;
    expect(sourceS3Config()).toEqual({
      bucket: 'synthetic-bucket',
      region: 'ap-south-1',
      endpoint: undefined,
      forcePathStyle: false,
      accessKeyId: 'synthetic-access-key',
      secretAccessKey: 'synthetic-secret-key',
    });

    Object.assign(process.env, {
      LEGACY_S3_ENDPOINT: 'http://127.0.0.1:9000',
      LEGACY_S3_FORCE_PATH_STYLE: 'true',
    });
    expect(sourceS3Config()).toMatchObject({
      endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true,
    });
  });

  it('requires an explicit target writer-disable declaration', () => {
    delete process.env.MIGRATION_TARGET_WRITERS_DISABLED;
    expect(() => assertTargetWritersDisabled()).toThrow(/is required/);
    process.env.MIGRATION_TARGET_WRITERS_DISABLED = 'false';
    expect(() => assertTargetWritersDisabled()).toThrow(/must be true/);
    process.env.MIGRATION_TARGET_WRITERS_DISABLED = 'true';
    expect(() => assertTargetWritersDisabled()).not.toThrow();
  });

  it('requires the release-pinned Kubernetes writer deployment set', () => {
    Object.assign(process.env, {
      MIGRATION_KUBECONFIG_FILE: '/tmp/synthetic-kubeconfig',
      MIGRATION_WRITER_FENCE_NAMESPACE: 'campuspilot-plus',
      MIGRATION_WRITER_FENCE_DEPLOYMENTS: 'api',
    });
    expect(kubernetesWriterFenceConfig().deployments).toEqual(['api']);
    process.env.MIGRATION_WRITER_FENCE_NAMESPACE = 'other';
    expect(() => kubernetesWriterFenceConfig()).toThrow('must be campuspilot-plus');
    process.env.MIGRATION_WRITER_FENCE_NAMESPACE = 'campuspilot-plus';
    process.env.MIGRATION_WRITER_FENCE_DEPLOYMENTS = 'api,worker';
    expect(() => kubernetesWriterFenceConfig()).toThrow('release-pinned writer set');
    process.env.MIGRATION_WRITER_FENCE_DEPLOYMENTS = 'api,api';
    expect(() => kubernetesWriterFenceConfig()).toThrow('non-empty unique');
  });
});
