import path from 'node:path';

import {
  CANONICAL_DECISIONS,
  CANONICAL_DECISION_POLICY,
  CANONICAL_DECISION_SET_SHA256,
  trackedMigrationContractSha256,
} from './canonical-decisions.ts';

export const APPROVED_SCHOOL_ID = "sch_n6q4pmirqg7dpct1pr8pr";
export const APPROVED_CREDENTIAL_COUNT = 1;
export const CREDENTIAL_ISSUER = "local:credential";
export const LEGACY_PASSWORD_HASH = /^[0-9a-f]{32}:[0-9a-f]{128}$/;

export type CredentialAccount = {
  id: string;
  account_id: string;
  provider_id: string;
  user_id: string;
  password: string | null;
};

export type TargetCredentialAccount = CredentialAccount & {
  issuer: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scope: string | null;
};

export type MigrationRecord = {
  hash: string;
  created_at: string | number;
};

export type ApprovedMapping = {
  status?: unknown;
  schools?: unknown;
  decisionsRequired?: unknown;
  decisionPolicy?: unknown;
};

export type ApprovalBundle = {
  runId?: unknown;
  approvedBy?: unknown;
  approvedAt?: unknown;
  scope?: unknown;
  targetEnvironment?: unknown;
  mappingSha256?: unknown;
  sourceDumpSha256?: unknown;
  sourceObjectManifestSha256?: unknown;
  sourceManifestSha256?: unknown;
  exceptionsSha256?: unknown;
  canonicalDecisionSetSha256?: unknown;
  migrationDocsSha256?: unknown;
  sourceMigrationHistorySha256?: unknown;
  targetMigrationHistorySha256?: unknown;
  sourceTableDigestsSha256?: unknown;
  sourceVersion?: unknown;
  sourceDatabaseIdentity?: unknown;
  targetDatabaseIdentity?: unknown;
  targetS3?: unknown;
  targetWritersDisabled?: unknown;
  snapshotEvidenceSha256?: unknown;
  targetPostgresRuntimeIdentitySha256?: unknown;
  writerFenceSha256?: unknown;
  importerGitCommit?: unknown;
  importerChecksumSha256?: unknown;
  targetObjectKeys?: unknown;
};

const APPROVED_TARGET_ENVIRONMENTS = new Set([
  "local-rehearsal",
  "production-campuspilot-plus",
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Return the non-secret database endpoint identity used by the operator's
 * allowlist. Credentials and query parameters are deliberately excluded.
 */
export function databaseIdentity(connectionString: string) {
  const url = new URL(connectionString);
  const port = url.port ||
    (url.protocol === 'postgresql:' || url.protocol === 'postgres:' ? '5432' : '');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:")
    throw new Error("Target database URL must use PostgreSQL");
  if (!url.hostname || !port || !database)
    throw new Error("Target database URL must include hostname, port, and database");
  return `${url.hostname}:${port}/${database}`;
}

/**
 * Require an explicit environment and exact endpoint allowlist entry before a
 * target connection is allowed to make migration writes.
 */
export function assertAllowedTarget(options: {
  connectionString: string;
  environment: string | undefined;
  allowedDatabaseIdentities: string | undefined;
}) {
  const { environment, allowedDatabaseIdentities, connectionString } = options;
  if (!environment || !APPROVED_TARGET_ENVIRONMENTS.has(environment))
    throw new Error("MIGRATION_TARGET_ENVIRONMENT is missing or unapproved");
  if (!allowedDatabaseIdentities)
    throw new Error("MIGRATION_ALLOWED_TARGET_DATABASES is required");

  const identity = databaseIdentity(connectionString);
  const allowlist = new Set(
    allowedDatabaseIdentities
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (!allowlist.has(identity))
    throw new Error(`Target database ${identity} is not explicitly allowlisted`);

  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (environment === "production-campuspilot-plus" && database !== "campuspilot-plus")
    throw new Error("Production migration target must be the campuspilot-plus database");
  if (
    environment === "local-rehearsal" &&
    !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)
  ) {
    throw new Error("Local rehearsal target must use a loopback endpoint");
  }
  return { environment, identity };
}

/** Require an exact allowlist identity explicitly labelled as a restored snapshot. */
export function assertAllowedSourceSnapshot(options: {
  connectionString: string;
  environment: string | undefined;
  allowedDatabaseIdentities: string | undefined;
}) {
  if (options.environment !== 'restored-snapshot')
    throw new Error('MIGRATION_SOURCE_ENVIRONMENT must be restored-snapshot');
  if (!options.allowedDatabaseIdentities)
    throw new Error('MIGRATION_ALLOWED_SOURCE_DATABASES is required');
  const identity = databaseIdentity(options.connectionString);
  const allowlist = new Set(
    options.allowedDatabaseIdentities
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (!allowlist.has(identity))
    throw new Error(`Source snapshot database ${identity} is not explicitly allowlisted`);
  const url = new URL(options.connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  if (!new Set(['127.0.0.1', 'localhost', '[::1]']).has(url.hostname) ||
    ['postgres', 'campuspilot', 'campuspilot-plus'].includes(database) ||
    database.includes('production') || !/^legacy_(snapshot|fixture)(?:_|$)/.test(database))
    throw new Error('Source snapshot must use an isolated loopback restore database, never a production-like endpoint');
  return { environment: options.environment, identity };
}

/** Validate the cluster on which snapshot creates and drops its temporary DB. */
export function assertSnapshotAdminRuntime(options: {
  connectionString: string;
  allowedDatabaseIdentities: string;
  expectedSystemIdentifier: string;
  expectedRole: string;
  requireTls: boolean;
  runtime: {
    systemIdentifier: string;
    currentUser: string;
    tls: { active: boolean };
  };
}) {
  const identity = databaseIdentity(options.connectionString);
  const allowlist = new Set(options.allowedDatabaseIdentities.split(',').map((item) => item.trim()).filter(Boolean));
  const url = new URL(options.connectionString);
  if (!allowlist.has(identity)) throw new Error('Snapshot admin endpoint is not explicitly allowlisted');
  if (!new Set(['127.0.0.1', 'localhost', '[::1]']).has(url.hostname))
    throw new Error('Snapshot admin endpoint must be an isolated loopback cluster');
  if (options.runtime.systemIdentifier !== options.expectedSystemIdentifier ||
    options.runtime.currentUser !== options.expectedRole ||
    (options.requireTls && !options.runtime.tls.active))
    throw new Error('Snapshot admin runtime identity does not match the operator-bound isolated cluster');
}

/** Refuse an import whose frozen source snapshot resolves to the target database. */
export function assertDistinctSourceAndTarget(
  sourceConnectionString: string,
  targetConnectionString: string,
) {
  const source = databaseIdentity(sourceConnectionString);
  const target = databaseIdentity(targetConnectionString);
  if (source === target)
    throw new Error('Legacy snapshot database and migration target must be distinct');
}

/** Resolve a manifest path without allowing it to escape the private run directory. */
export function resolveRunArtifact(runDirectory: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath))
    throw new Error('Run artifact path must be relative');
  const root = path.resolve(runDirectory);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    throw new Error('Run artifact path escapes the run directory');
  return resolved;
}

/**
 * Enforce the frozen Prem Chandra credential scope before any target write or
 * object upload. The approved source contains exactly one credential account.
 */
export function assertApprovedCredentials(
  accounts: CredentialAccount[],
  approvedStaffUserIds: ReadonlySet<string>,
) {
  if (accounts.length !== APPROVED_CREDENTIAL_COUNT) {
    throw new Error(
      `Approved Prem Chandra scope requires exactly ${APPROVED_CREDENTIAL_COUNT} credential account; found ${accounts.length}`,
    );
  }

  const ids = new Set<string>();
  const issuerAccountIds = new Set<string>();
  const userIds = new Set<string>();
  for (const account of accounts) {
    if (account.provider_id !== "credential")
      throw new Error(`Account ${account.id} is not a credential account`);
    if (!approvedStaffUserIds.has(account.user_id))
      throw new Error(`Credential account ${account.id} is outside approved Prem Chandra staff scope`);
    if (account.account_id !== account.user_id)
      throw new Error(`Credential account ${account.id} does not use userId as accountId`);
    if (!account.password || !LEGACY_PASSWORD_HASH.test(account.password))
      throw new Error(`Credential account ${account.id} has an incompatible password hash`);
    if (ids.has(account.id))
      throw new Error(`Credential account primary key ${account.id} is duplicated`);
    const issuerAccountId = `${CREDENTIAL_ISSUER}\u0000${account.account_id}`;
    if (issuerAccountIds.has(issuerAccountId))
      throw new Error(`Credential account ${account.id} duplicates the target issuer/accountId`);
    if (userIds.has(account.user_id))
      throw new Error(`Staff user ${account.user_id} has multiple credential accounts`);
    ids.add(account.id);
    issuerAccountIds.add(issuerAccountId);
    userIds.add(account.user_id);
  }
}

/**
 * Parse an approved source hash with the target Better Auth verifier. A random
 * unknown password must fail; success would indicate an unusable safety probe.
 */
export async function assertTargetVerifierCompatibility(
  account: CredentialAccount,
  randomProbe: string,
  verify: (input: { hash: string; password: string }) => Promise<boolean>,
) {
  if (!account.password || !LEGACY_PASSWORD_HASH.test(account.password))
    throw new Error(`Credential account ${account.id} has an incompatible password hash`);
  if (await verify({ hash: account.password, password: randomProbe }))
    throw new Error(`Random verifier probe unexpectedly matched credential account ${account.id}`);
}

/** Ensure a migrated local credential contains no provider token state. */
export function assertTargetCredential(account: TargetCredentialAccount) {
  if (
    account.issuer !== CREDENTIAL_ISSUER ||
    account.provider_id !== "credential" ||
    account.account_id !== account.user_id ||
    !account.password ||
    !LEGACY_PASSWORD_HASH.test(account.password)
  ) {
    throw new Error(`Target credential account ${account.id} has invalid identity or password state`);
  }
  for (const field of [
    "access_token",
    "refresh_token",
    "id_token",
    "access_token_expires_at",
    "refresh_token_expires_at",
    "scope",
  ] as const) {
    if (account[field] !== null)
      throw new Error(`Target credential account ${account.id} retained ${field}`);
  }
}

/** Require the sole credential identity and Scrypt bytes to be unchanged. */
export function assertCredentialPreserved(
  source: CredentialAccount,
  target: TargetCredentialAccount,
) {
  assertTargetCredential(target);
  if (source.id !== target.id || source.account_id !== target.account_id ||
    source.user_id !== target.user_id || source.password !== target.password)
    throw new Error(`Target credential ${target.id} does not exactly preserve source identity/hash bytes`);
}

/** Require the database's Drizzle history to exactly match the repository. */
export function assertMigrationHistory(
  expected: MigrationRecord[],
  actual: MigrationRecord[],
) {
  if (actual.length !== expected.length)
    throw new Error(`Target migration history length mismatch: expected ${expected.length}, found ${actual.length}`);
  for (const [index, expectedEntry] of expected.entries()) {
    const actualEntry = actual[index];
    if (
      !actualEntry ||
      actualEntry.hash !== expectedEntry.hash ||
      String(actualEntry.created_at) !== String(expectedEntry.created_at)
    ) {
      throw new Error(`Target migration history diverges at index ${index}`);
    }
  }
}

/**
 * Require immutable run evidence bound to the repository's executable migration
 * contract before any write. The importer never accepts operator-defined policy.
 */
export function assertApprovedRunArtifacts(options: {
  mapping: ApprovedMapping;
  approval: ApprovalBundle;
  targetEnvironment: string;
  mappingSha256: string;
  sourceDumpSha256: string;
  sourceObjectManifestSha256: string;
  sourceManifestSha256: string;
  snapshotEvidenceSha256: string;
  exceptionsSha256: string;
  sourceMigrationHistorySha256: string;
  targetMigrationHistorySha256: string;
  sourceTableDigestsSha256: string;
  sourceVersion: string;
  sourceDatabaseIdentity: string;
  targetDatabaseIdentity: string;
  targetS3: {
    bucket: string;
    region: string;
    endpoint: string | null;
    forcePathStyle: boolean;
  };
  targetPostgresRuntimeIdentitySha256: string;
  writerFenceSha256: string;
  importerGitCommit: string;
  importerChecksumSha256: string;
  migrationDocsSha256: string;
}) {
  const {
    mapping,
    approval,
    targetEnvironment,
    mappingSha256,
    sourceDumpSha256,
    sourceObjectManifestSha256,
    sourceManifestSha256,
    snapshotEvidenceSha256,
    exceptionsSha256,
    sourceMigrationHistorySha256,
    targetMigrationHistorySha256,
    sourceTableDigestsSha256,
    sourceVersion,
    sourceDatabaseIdentity,
    targetDatabaseIdentity,
    targetS3,
    targetPostgresRuntimeIdentitySha256,
    writerFenceSha256,
    importerGitCommit,
    importerChecksumSha256,
    migrationDocsSha256,
  } = options;
  if (mapping.status !== "approved")
    throw new Error("mapping.json must be generated from the tracked contract before import");
  if (
    typeof approval.runId !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(approval.runId)
  ) {
    throw new Error('approval.json must contain a stable runId');
  }
  const schools = Array.isArray(mapping.schools)
    ? (mapping.schools as Array<{ sourceId?: unknown; targetId?: unknown }>)
    : null;
  if (
    !schools ||
    schools.length !== 1 ||
    schools[0]?.sourceId !== APPROVED_SCHOOL_ID ||
    schools[0]?.targetId !== APPROVED_SCHOOL_ID
  ) {
    throw new Error("Approved mapping must contain only Prem Chandra Public School");
  }
  const decisionsRequired = Array.isArray(mapping.decisionsRequired)
    ? mapping.decisionsRequired.map(String)
    : null;
  if (!decisionsRequired || !mapping.decisionPolicy)
    throw new Error('Approved mapping must contain its typed decision policy');
  if (
    decisionsRequired.length !== CANONICAL_DECISIONS.length ||
    decisionsRequired.some(
      (decisionId, index) => decisionId !== CANONICAL_DECISIONS[index],
    )
  ) {
    throw new Error('Approved mapping decision list is not the canonical decision set');
  }
  if (stableJson(mapping.decisionPolicy) !== stableJson(CANONICAL_DECISION_POLICY))
    throw new Error('Approved mapping typed decision policy is not executable by this importer release');
  if (
    typeof approval.approvedBy !== "string" ||
    !approval.approvedBy.trim() ||
    approval.approvedBy.trim().toLowerCase() === "workspace user"
  ) {
    throw new Error("approval.json must name the human approver");
  }
  if (
    typeof approval.approvedAt !== "string" ||
    Number.isNaN(Date.parse(approval.approvedAt))
  ) {
    throw new Error("approval.json must contain a valid approval timestamp");
  }
  if (approval.scope !== APPROVED_SCHOOL_ID)
    throw new Error("approval.json scope is not Prem Chandra Public School");
  if (approval.targetEnvironment !== targetEnvironment)
    throw new Error("approval.json target environment does not match this run");
  if (approval.mappingSha256 !== mappingSha256)
    throw new Error("approval.json does not approve the current mapping checksum");
  if (approval.sourceDumpSha256 !== sourceDumpSha256)
    throw new Error("approval.json does not approve the current source dump checksum");
  if (approval.sourceObjectManifestSha256 !== sourceObjectManifestSha256)
    throw new Error("approval.json does not approve the current object manifest checksum");
  if (approval.sourceManifestSha256 !== sourceManifestSha256)
    throw new Error('approval.json does not approve the current source manifest checksum');
  if (approval.snapshotEvidenceSha256 !== snapshotEvidenceSha256)
    throw new Error('approval.json does not approve the exact-cutoff snapshot evidence');
  if (approval.exceptionsSha256 !== exceptionsSha256)
    throw new Error('approval.json does not approve the current exception report checksum');
  if (approval.canonicalDecisionSetSha256 !== CANONICAL_DECISION_SET_SHA256)
    throw new Error('approval.json does not approve the canonical decision set');
  if (approval.migrationDocsSha256 !== migrationDocsSha256)
    throw new Error('approval.json does not bind the tracked migration documentation');
  trackedMigrationContractSha256(migrationDocsSha256);
  if (approval.sourceMigrationHistorySha256 !== sourceMigrationHistorySha256)
    throw new Error('approval.json does not approve the exact source migration history');
  if (approval.targetMigrationHistorySha256 !== targetMigrationHistorySha256)
    throw new Error('approval.json does not approve the exact target migration history');
  if (approval.sourceTableDigestsSha256 !== sourceTableDigestsSha256)
    throw new Error('approval.json does not approve the source table digests');
  if (approval.sourceVersion !== sourceVersion)
    throw new Error('approval.json does not approve the source version');
  if (approval.sourceDatabaseIdentity !== sourceDatabaseIdentity)
    throw new Error('approval.json does not approve the source database identity');
  if (approval.targetDatabaseIdentity !== targetDatabaseIdentity)
    throw new Error('approval.json does not approve the target database identity');
  if (stableJson(approval.targetS3) !== stableJson(targetS3))
    throw new Error('approval.json does not approve the target S3 identity');
  if (approval.targetWritersDisabled !== true)
    throw new Error('approval.json must bind the writers-disabled target gate');
  if (approval.targetPostgresRuntimeIdentitySha256 !== targetPostgresRuntimeIdentitySha256)
    throw new Error('approval.json does not approve the target PostgreSQL runtime identity');
  if (approval.writerFenceSha256 !== writerFenceSha256)
    throw new Error('approval.json does not approve the verified Kubernetes writer fence');
  if (approval.importerGitCommit !== importerGitCommit)
    throw new Error('approval.json does not approve the importer Git commit');
  if (approval.importerChecksumSha256 !== importerChecksumSha256)
    throw new Error('approval.json does not approve the importer checksum');
}

/**
 * The tracked contract must name every pre-existing shared-bucket key retained
 * by target rows. The importer never creates, replaces, or deletes these keys.
 */
export function assertApprovedTargetObjectKeys(
  approval: ApprovalBundle,
  plannedKeys: string[],
) {
  if (!Array.isArray(approval.targetObjectKeys))
    throw new Error("approval.json must contain the exact target object-key allowlist");
  const approved = approval.targetObjectKeys.map(String).toSorted();
  const planned = plannedKeys.toSorted();
  if (new Set(approved).size !== approved.length)
    throw new Error("approval.json target object-key allowlist contains duplicates");
  if (new Set(planned).size !== planned.length)
    throw new Error("Planned target object keys contain duplicates");
  if (
    approved.length !== planned.length ||
    approved.some((key, index) => key !== planned[index])
  ) {
    throw new Error("Planned target object keys do not match the approved allowlist");
  }
  if (planned.some((key) => !key || key.startsWith('/') || key.includes('..')))
    throw new Error('A retained shared-bucket object key is malformed');
}
