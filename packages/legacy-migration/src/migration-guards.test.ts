import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_ISSUER,
  assertAllowedTarget,
  assertAllowedSourceSnapshot,
  assertSnapshotAdminRuntime,
  assertApprovedCredentials,
  assertApprovedRunArtifacts,
  assertApprovedTargetObjectKeys,
  assertCredentialPreserved,
  assertDistinctSourceAndTarget,
  assertMigrationHistory,
  assertTargetCredential,
  assertTargetVerifierCompatibility,
  databaseIdentity,
  resolveRunArtifact,
} from "./migration-guards.ts";
import { CANONICAL_DECISIONS, CANONICAL_DECISION_POLICY, CANONICAL_DECISION_SET_SHA256 } from './canonical-decisions.ts';

const userId = "usr_syntheticfixture0001";

async function syntheticCredential() {
  return {
    id: "acc_syntheticfixture0001",
    account_id: userId,
    provider_id: "credential",
    user_id: userId,
    password: await hashPassword("synthetic-password-only"),
  };
}

describe("migration target guards", () => {
  it("requires an exact non-secret target allowlist identity", () => {
    const connectionString = "postgresql://operator:secret@127.0.0.1:55432/campuspilot-plus?sslmode=require";
    expect(databaseIdentity(connectionString)).toBe("127.0.0.1:55432/campuspilot-plus");
    expect(() =>
      assertAllowedTarget({
        connectionString,
        environment: "production-campuspilot-plus",
        allowedDatabaseIdentities: "127.0.0.1:55432/campuspilot-plus",
      }),
    ).not.toThrow();
    expect(() =>
      assertAllowedTarget({
        connectionString,
        environment: "production-campuspilot-plus",
        allowedDatabaseIdentities: "127.0.0.1:55432/other",
      }),
    ).toThrow(/not explicitly allowlisted/);
    expect(() =>
      assertDistinctSourceAndTarget(
        'postgresql://reader:secret@127.0.0.1:55433/legacy_snapshot',
        connectionString,
      ),
    ).not.toThrow();
    expect(() =>
      assertDistinctSourceAndTarget(connectionString, connectionString),
    ).toThrow(/must be distinct/);
    expect(() =>
      assertAllowedSourceSnapshot({
        connectionString:
          'postgresql://reader:secret@127.0.0.1:55433/legacy_snapshot',
        environment: 'restored-snapshot',
        allowedDatabaseIdentities: '127.0.0.1:55433/legacy_snapshot',
      }),
    ).not.toThrow();
    expect(() =>
      assertAllowedSourceSnapshot({
        connectionString:
          'postgresql://reader:secret@legacy.example:5432/production',
        environment: 'production',
        allowedDatabaseIdentities: 'legacy.example:5432/production',
      }),
    ).toThrow(/must be restored-snapshot/);
  });

  it("requires exact repository and database migration histories", () => {
    const expected = [{ hash: "synthetic-hash", created_at: 123 }];
    expect(() => assertMigrationHistory(expected, expected)).not.toThrow();
    expect(() =>
      assertMigrationHistory(expected, [{ hash: "different", created_at: 123 }]),
    ).toThrow(/diverges/);
  });

  it('binds snapshot administration to an isolated allowlisted cluster runtime', () => {
    const options = {
      connectionString: 'postgresql://snapshot_admin:secret@127.0.0.1:55433/postgres',
      allowedDatabaseIdentities: '127.0.0.1:55433/postgres',
      expectedSystemIdentifier: 'synthetic-cluster',
      expectedRole: 'snapshot_admin',
      requireTls: false,
      runtime: {
        systemIdentifier: 'synthetic-cluster',
        currentUser: 'snapshot_admin',
        tls: { active: false },
      },
    };
    expect(() => assertSnapshotAdminRuntime(options)).not.toThrow();
    expect(() => assertSnapshotAdminRuntime({
      ...options,
      runtime: { ...options.runtime, systemIdentifier: 'different-cluster' },
    })).toThrow('does not match');
    expect(() => assertSnapshotAdminRuntime({
      ...options,
      connectionString: 'postgresql://snapshot_admin:secret@production.invalid:5432/postgres',
    })).toThrow('not explicitly allowlisted');
  });

  it('keeps manifest-referenced object bytes inside the private run directory', () => {
    expect(resolveRunArtifact('/tmp/synthetic-run', 'source-objects/item')).toBe(
      '/tmp/synthetic-run/source-objects/item',
    );
    expect(() =>
      resolveRunArtifact('/tmp/synthetic-run', '../outside'),
    ).toThrow(/escapes/);
    expect(() =>
      resolveRunArtifact('/tmp/synthetic-run', '/tmp/outside'),
    ).toThrow(/must be relative/);
  });

  it("requires pre-existing checksummed human approval and exact object keys", () => {
    const mapping = {
      status: "approved",
      schools: [{ sourceId: "sch_n6q4pmirqg7dpct1pr8pr", targetId: "sch_n6q4pmirqg7dpct1pr8pr" }],
      decisionsRequired: [...CANONICAL_DECISIONS],
      decisionPolicy: CANONICAL_DECISION_POLICY,
    };
    const approval = {
      runId: 'synthetic-run',
      approvedBy: "Synthetic Test Approver",
      approvedAt: "2030-01-01T00:00:00.000Z",
      scope: "sch_n6q4pmirqg7dpct1pr8pr",
      targetEnvironment: "local-rehearsal",
      mappingSha256: "mapping-hash",
      sourceDumpSha256: "dump-hash",
      sourceObjectManifestSha256: "objects-hash",
      sourceManifestSha256: 'source-manifest-hash',
      snapshotEvidenceSha256: 'snapshot-evidence-hash',
      exceptionsSha256: 'exceptions-hash',
      canonicalDecisionSetSha256: CANONICAL_DECISION_SET_SHA256,
      migrationDocsSha256: 'd'.repeat(64),
      sourceMigrationHistorySha256: 'history-hash',
      targetMigrationHistorySha256: 'target-history-hash',
      sourceTableDigestsSha256: 'tables-hash',
      sourceVersion: 'synthetic-version',
      sourceDatabaseIdentity: '127.0.0.1:55433/legacy_snapshot',
      targetDatabaseIdentity: '127.0.0.1:55432/campuspilot-plus',
      targetS3: { bucket: 'synthetic', region: 'test-1', endpoint: null, forcePathStyle: false },
      targetWritersDisabled: true,
      targetPostgresRuntimeIdentitySha256: 'postgres-runtime-hash',
      writerFenceSha256: 'writer-fence-hash',
      importerGitCommit: 'a'.repeat(40),
      importerChecksumSha256: 'importer-hash',
      targetObjectKeys: [
        "schools/sch_n6q4pmirqg7dpct1pr8pr/logos/synthetic.png",
      ],
    };
    const asserted = {
      targetEnvironment: 'local-rehearsal',
      mappingSha256: 'mapping-hash',
      sourceDumpSha256: 'dump-hash',
      sourceObjectManifestSha256: 'objects-hash',
      sourceManifestSha256: 'source-manifest-hash',
      snapshotEvidenceSha256: 'snapshot-evidence-hash',
      exceptionsSha256: 'exceptions-hash',
      sourceMigrationHistorySha256: 'history-hash',
      targetMigrationHistorySha256: 'target-history-hash',
      sourceTableDigestsSha256: 'tables-hash',
      sourceVersion: 'synthetic-version',
      sourceDatabaseIdentity: '127.0.0.1:55433/legacy_snapshot',
      targetDatabaseIdentity: '127.0.0.1:55432/campuspilot-plus',
      targetS3: { bucket: 'synthetic', region: 'test-1', endpoint: null, forcePathStyle: false },
      targetPostgresRuntimeIdentitySha256: 'postgres-runtime-hash',
      writerFenceSha256: 'writer-fence-hash',
      importerGitCommit: 'a'.repeat(40),
      importerChecksumSha256: 'importer-hash',
      migrationDocsSha256: 'd'.repeat(64),
    };
    expect(() =>
      assertApprovedRunArtifacts({
        mapping,
        approval,
        ...asserted,
      }),
    ).not.toThrow();
    expect(() =>
      assertApprovedTargetObjectKeys(approval, [
        "schools/sch_n6q4pmirqg7dpct1pr8pr/logos/synthetic.png",
      ]),
    ).not.toThrow();
    expect(() =>
      assertApprovedTargetObjectKeys(approval, [
        "schools/sch_other000000000000000/logo.png",
      ]),
    ).toThrow(/approved allowlist/);
    expect(() =>
      assertApprovedRunArtifacts({
        mapping,
        approval: { ...approval, approvedBy: "workspace user" },
        ...asserted,
      }),
    ).toThrow(/human approver/);
    expect(() =>
      assertApprovedRunArtifacts({
        mapping,
        approval: { ...approval, importerChecksumSha256: 'different' },
        ...asserted,
      }),
    ).toThrow(/importer checksum/);
    expect(() =>
      assertApprovedRunArtifacts({
        mapping,
        approval: { ...approval, migrationDocsSha256: 'e'.repeat(64) },
        ...asserted,
      }),
    ).toThrow(/migration documentation/);
    expect(() =>
      assertApprovedRunArtifacts({
        mapping: {
          ...mapping,
          decisionsRequired: [...CANONICAL_DECISIONS.slice(0, -1), 'SYNTHETIC-01'],
        },
        approval,
        ...asserted,
      }),
    ).toThrow(/canonical decision set/);
  });
});

describe("credential migration guards", () => {
  it("accepts one synthetic Prem-scoped credential and the target verifier", async () => {
    const account = await syntheticCredential();
    assertApprovedCredentials([account], new Set([userId]));
    await expect(
      verifyPassword({ hash: account.password!, password: "synthetic-password-only" }),
    ).resolves.toBe(true);
    await expect(
      assertTargetVerifierCompatibility(account, "definitely-not-the-password", verifyPassword),
    ).resolves.toBeUndefined();
  });

  it("rejects missing, duplicate, and out-of-scope credentials", async () => {
    const account = await syntheticCredential();
    expect(() => assertApprovedCredentials([], new Set([userId]))).toThrow(/exactly 1/);
    expect(() => assertApprovedCredentials([account], new Set(["usr_someoneelse00001"]))).toThrow(
      /outside approved Prem Chandra/,
    );
    expect(() => assertApprovedCredentials([account, { ...account, id: "acc_secondsynthetic001" }], new Set([userId]))).toThrow(
      /exactly 1/,
    );
  });

  it("requires every provider token, expiry, and scope field to remain null", async () => {
    const account = await syntheticCredential();
    const target = {
      ...account,
      issuer: CREDENTIAL_ISSUER,
      access_token: null,
      refresh_token: null,
      id_token: null,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
      scope: null,
    };
    expect(() => assertTargetCredential(target)).not.toThrow();
    expect(() => assertTargetCredential({ ...target, scope: "openid" })).toThrow(/retained scope/);
    expect(() =>
      assertTargetCredential({ ...target, access_token_expires_at: "2099-01-01T00:00:00Z" }),
    ).toThrow(/retained access_token_expires_at/);
    const altered = `${target.password!.slice(0, -1)}${target.password!.endsWith('0') ? '1' : '0'}`;
    expect(altered).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(() =>
      assertCredentialPreserved(account, { ...target, password: altered }),
    ).toThrow(/exactly preserve/);
  });
});
