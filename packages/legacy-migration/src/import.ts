import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from 'node:url';

import pg from 'pg';
import { SAMPLE_DOCUMENT_CONTEXT } from '@campuspilot/api/routers/school/document/document.catalog';
import { renderDocument } from '@campuspilot/api/routers/school/document/document.render';
import { verifyPassword } from 'better-auth/crypto';
import {
  approvedInputFiles,
  assertTargetWritersDisabled,
  legacyMigrationDirectory,
  kubernetesWriterFenceConfig,
  migrationSourceVersion,
  runDirectory,
  sourceDatabaseUrl,
  sourceAuthorization,
  sourceS3Config,
  targetAuthorization,
  targetDatabaseUrl,
  targetDatabaseRole,
  targetDatabaseLoginRole,
} from './config.ts';
import { CANONICAL_DECISION_POLICY, trackedMigrationContractSha256 } from './canonical-decisions.ts';
import {
  APPROVED_CREDENTIAL_COUNT,
  APPROVED_SCHOOL_ID,
  CREDENTIAL_ISSUER,
  assertAllowedTarget,
  assertAllowedSourceSnapshot,
  assertApprovedCredentials,
  assertCredentialPreserved,
  assertApprovedRunArtifacts,
  assertApprovedTargetObjectKeys,
  assertDistinctSourceAndTarget,
  assertMigrationHistory,
  assertTargetCredential,
  assertTargetVerifierCompatibility,
  databaseIdentity,
  resolveRunArtifact,
  type ApprovalBundle,
  type ApprovedMapping,
  type CredentialAccount,
  type MigrationRecord,
  type TargetCredentialAccount,
} from "./migration-guards.ts";
import { importerProvenance } from './provenance.ts';
import { migrationDocsSha256 } from './tracked-contract.ts';
import { captureSourceEvidence, assertSourceEvidence, type SourceEvidence } from './source-evidence.ts';
import {
  assertApprovedObject,
  buildSharedObjectContracts,
  type ApprovedLogoObject,
  type ApprovedTemplateObject,
} from './object-contract.ts';
import { validateSourceRows } from './source-validation.ts';
import { assertPreservedIds } from './id-validation.ts';
import { assertCanonicalExceptionArtifact, type ExceptionArtifact } from './exception-contract.ts';
import { buildTargetMigrationPlan } from './target-plan.ts';
import { postgresRuntimeIdentity, postgresRuntimeIdentitySha256 } from './database-runtime.ts';
import {
  verifyKubernetesWriterFence,
  writerFenceSha256,
  type WriterFence,
} from './writer-fence.ts';
import { assertSnapshotEvidence, type SnapshotEvidence } from './snapshot-evidence.ts';
import {
  migrationHistory,
  targetMigrationDirectory,
} from './migration-history.ts';
import { compareLegacyLedgerCandidates } from './ledger-order.ts';
import { writeDeterministicAuditArtifacts } from './audit-artifacts.ts';
import {
  assertNoBlockingDispositions,
  blockingDispositionIssues,
  buildSourceDispositions,
} from './dispositions.ts';
import { assertSourceObjectManifest, type SourceObjectManifest } from './source-object-manifest.ts';

export type ImportCoreDependencies = {
  verifyWriterFence: (
    options: ReturnType<typeof kubernetesWriterFenceConfig>,
  ) => Promise<WriterFence>;
  /** Test-only crash-window injection; production uses a no-op. */
  afterCommitBeforeAudit: () => Promise<void>;
};

export function resolveImportCoreDependencies(
  dependencies: Partial<ImportCoreDependencies> = {},
): ImportCoreDependencies {
  return {
    verifyWriterFence:
      dependencies.verifyWriterFence ?? verifyKubernetesWriterFence,
    afterCommitBeforeAudit:
      dependencies.afterCommitBeforeAudit ?? (async () => undefined),
  };
}

/**
 * Execute the importer with production-safe defaults. Tests may replace only
 * the external Kubernetes fence observation; all migration planning,
 * validation, and PostgreSQL behavior stays
 * on the same code path as the production CLI.
 */
export async function runImport(
  dependencies: Partial<ImportCoreDependencies> = {},
) {
const { verifyWriterFence, afterCommitBeforeAudit } =
  resolveImportCoreDependencies(dependencies);
const { Client, types } = pg;
types.setTypeParser(1114, (value: string) => value);

const SCHOOL_ID = APPROVED_SCHOOL_ID;
const SOURCE_VERSION = migrationSourceVersion();
const SOURCE_DATABASE_URL = sourceDatabaseUrl();
const sourceAuthorizationConfig = sourceAuthorization();
const TARGET_DATABASE_URL = targetDatabaseUrl();
const TARGET_DATABASE_ROLE = targetDatabaseRole();
const TARGET_DATABASE_LOGIN_ROLE = targetDatabaseLoginRole();
const targetAuthorizationConfig = targetAuthorization();
const RUN_DIRECTORY = runDirectory();
const inputFiles = approvedInputFiles();
const sharedObjectStore = sourceS3Config();
assertTargetWritersDisabled();
const writerFenceConfig = kubernetesWriterFenceConfig();

assertDistinctSourceAndTarget(SOURCE_DATABASE_URL, TARGET_DATABASE_URL);
assertAllowedSourceSnapshot({
  connectionString: SOURCE_DATABASE_URL,
  environment: sourceAuthorizationConfig.environment,
  allowedDatabaseIdentities: sourceAuthorizationConfig.allowedDatabaseIdentities,
});

const targetIdentity = assertAllowedTarget({
  connectionString: TARGET_DATABASE_URL,
  environment: targetAuthorizationConfig.environment,
  allowedDatabaseIdentities: targetAuthorizationConfig.allowedDatabaseIdentities,
});

type Row = Record<string, any>;
type Write = { kind: "row" | "object"; target: string; source: string };
const source = new Client({ connectionString: SOURCE_DATABASE_URL });
const target = new Client({ connectionString: TARGET_DATABASE_URL });
const writes: Write[] = [];
const exceptions: Array<Record<string, unknown>> = [];
const startedAt = new Date().toISOString();
let targetCommitted = false;
let commitOutcomeUnknown = false;
let approvalRunId: string | undefined;

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Select one exam-wide value from the ordered legacy subject rows.
 *
 * Legacy wrote attendance and co-scholastic grades on an arbitrary subject
 * result, so a leading null is not evidence that the exam-wide value is null.
 * Conflicting populated values remain blocking; otherwise the first populated
 * value in stable source-ID order is the deterministic representative.
 */
function selectAgreedAssessmentValue(group: Row[], field: string, key: string) {
  const populated = group.filter((row) => row[field] != null);
  const values = new Set(populated.map((row) => stableJson(row[field])));
  if (values.size > 1) throw new Error(`Assessment conflict ${key}:${field}`);
  return populated[0]?.[field] ?? null;
}

function toMinor(value: unknown): bigint {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid decimal amount: ${text}`);
  const fraction = match[3] ?? "";
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2)))
    throw new Error(`Sub-paise INR amount: ${text}`);
  const amount = BigInt(match[2]!) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  const signed = match[1] ? -amount : amount;
  if (signed < 0n) throw new Error(`Negative legacy amount: ${text}`);
  return signed;
}

function localInstant(timestamp: string) {
  return `${timestamp.replace(" ", "T")}+05:30`;
}

function monthBounds(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period: ${period}`);
  const [year, month] = period.split("-").map(Number);
  if (year === undefined || month === undefined)
    throw new Error(`Invalid period: ${period}`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = `${period}-01`;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return {
    start,
    end,
    startAt: `${start}T00:00:00+05:30`,
    endAt: `${end}T00:00:00+05:30`,
  };
}

function classRank(slug: string) {
  if (slug === "nursery") return 1;
  if (slug === "lkg") return 2;
  if (slug === "ukg") return 3;
  if (/^\d+$/.test(slug)) return 3 + Number(slug);
  return 10_000;
}

function insertSql(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  return {
    text: `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`,
    values: columns.map((column) => row[column]),
  };
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Count every business row; the durable migration-run control table is excluded. */
async function targetPublicRowCount() {
  const tables = (
    await target.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
        AND table_name <> 'legacy_migration_run'
      ORDER BY table_name
    `)
  ).rows;
  let total = 0;
  for (const table of tables) {
    const result = await target.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${quoteIdentifier(table.table_name)}`,
    );
    total += Number(result.rows[0]?.count ?? 0);
  }
  return { tableCount: tables.length, rowCount: total };
}

async function insert(table: string, row: Record<string, unknown>, sourceIdentity: string) {
  await target.query(insertSql(table, row));
  const key = String(row.id ?? row.artifact_id ?? row.user_id ?? row.document_type ?? "composite");
  writes.push({ kind: "row", target: `${table}:${key}`, source: sourceIdentity });
}

async function queryRows<T extends Row = Row>(sql: string, values: unknown[] = []) {
  return (await source.query<T>(sql, values)).rows;
}

function financeConfig(school: Row, classes: Row[]) {
  const legacy = school.finance_schema;
  if (!legacy || legacy.currency !== "INR") throw new Error("Finance currency is not approved INR");
  const elements = Object.fromEntries(
    Object.entries(legacy.elements ?? {}).map(([slug, raw]) => {
      const value = raw as Row;
      return [
        slug,
        {
          name: value.name,
          scopes: value.scopes,
          requiredAtLevel: value.requiredAtLevel,
          ...(value.defaultValue == null
            ? {}
            : { defaultAmountMinor: Number(toMinor(value.defaultValue)) }),
        },
      ];
    }),
  );
  const config = {
    recurring: legacy.recurring,
    currency: "INR",
    timeZone: CANONICAL_DECISION_POLICY['G-05'].sourceTimeZone,
    cycleStartMonth: 4,
    elements,
  };
  const classOverrides = Object.fromEntries(
    classes.map((klass) => [
      klass.slug,
      Object.fromEntries(
        Object.entries(klass.finance_config ?? {}).map(([slug, amount]) => [
          slug,
          Number(toMinor(amount)),
        ]),
      ),
    ]),
  );
  return { config, classOverrides };
}

function documentSnapshot(admission: Row, student: Row, session: Row, klass: Row, section: Row) {
  return {
    admissionNumber: admission.admissionNo,
    admissionName: admission.name,
    fatherName: admission.fatherName,
    motherName: admission.motherName,
    sessionStartYear: session.sessionStartYear,
    sessionEndYear: session.sessionEndYear,
    enrollmentId: student.id,
    classId: klass.id,
    classLabel: klass.label,
    sectionId: section.id,
    sectionLabel: section.label,
    rollNumber: student.rollNo,
  };
}

await source.connect();
await target.connect();

try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const sourceReadOnly = await source.query<{ transaction_read_only: string }>(
    "SHOW transaction_read_only",
  );
  if (sourceReadOnly.rows[0]?.transaction_read_only !== "on")
    throw new Error("Legacy snapshot transaction is not read-only");

  const targetDatabase = await target.query<{ database: string }>(
    "SELECT current_database() AS database",
  );
  const expectedDatabase = databaseIdentity(TARGET_DATABASE_URL).split("/").at(-1);
  if (targetDatabase.rows[0]?.database !== expectedDatabase)
    throw new Error("Connected target database does not match the allowlisted URL");
  const targetRuntimeIdentity = await postgresRuntimeIdentity(target, TARGET_DATABASE_URL);
  const sourceRuntimeIdentity = await postgresRuntimeIdentity(source, SOURCE_DATABASE_URL);
  if (targetRuntimeIdentity.currentUser !== TARGET_DATABASE_ROLE ||
    targetRuntimeIdentity.sessionUser !== TARGET_DATABASE_LOGIN_ROLE)
    throw new Error('Connected target database current/session roles do not match the approved migration authority');
  if (targetIdentity.environment === 'production-campuspilot-plus' && !targetRuntimeIdentity.tls.active)
    throw new Error('Production migration target PostgreSQL connection must use TLS');
  const verifiedWriterFence = await verifyWriterFence(writerFenceConfig);

  const migrationLock = await target.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended('campuspilot-legacy-migration',0)) AS acquired`,
  );
  if (!migrationLock.rows[0]?.acquired)
    throw new Error('Another legacy migration process holds the target advisory lock');

  const actualMigrationHistory = (
    await target.query<MigrationRecord>(`
      SELECT hash,created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at,id
    `)
  ).rows;
  const targetMigrationHistorySha256 = hash(stableJson(actualMigrationHistory));
  assertMigrationHistory(
    await migrationHistory(targetMigrationDirectory),
    actualMigrationHistory,
  );

  const targetInventory = await targetPublicRowCount();
  if (targetInventory.rowCount !== 0)
    throw new Error(
      `Target must be completely empty before import; found ${targetInventory.rowCount} rows across ${targetInventory.tableCount} public tables`,
    );

  const [mappingText, approvalText, objectManifestText, sourceManifestText, snapshotEvidenceText, exceptionsText, sourceDump] = await Promise.all([
    readFile(inputFiles.mapping, 'utf8'),
    readFile(inputFiles.approval, 'utf8'),
    readFile(inputFiles.objectManifest, 'utf8'),
    readFile(inputFiles.sourceManifest, 'utf8'),
    readFile(inputFiles.snapshotEvidence, 'utf8'),
    readFile(inputFiles.exceptions, 'utf8'),
    readFile(inputFiles.sourceDump),
  ]);
  const mapping = JSON.parse(mappingText) as ApprovedMapping & Record<string, unknown>;
  const approval = JSON.parse(approvalText) as ApprovalBundle;
  const objectManifest = JSON.parse(objectManifestText) as SourceObjectManifest;
  const approvedSourceManifest = JSON.parse(sourceManifestText) as SourceEvidence;
  const snapshotEvidence = JSON.parse(snapshotEvidenceText) as SnapshotEvidence;
  const approvedExceptions = JSON.parse(exceptionsText) as ExceptionArtifact;
  const sourceHistory = (
    await source.query<MigrationRecord>(`
      SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id
    `)
  ).rows;
  assertMigrationHistory(
    await migrationHistory(legacyMigrationDirectory()),
    sourceHistory,
  );
  const actualSourceManifest = await captureSourceEvidence({
    client: source,
    sourceVersion: SOURCE_VERSION,
    sourceDatabaseIdentity: databaseIdentity(SOURCE_DATABASE_URL),
    migrationHistory: sourceHistory,
  });
  assertSourceEvidence(approvedSourceManifest, actualSourceManifest);
  assertSourceObjectManifest(objectManifest, actualSourceManifest);
  assertNoBlockingDispositions(buildSourceDispositions(actualSourceManifest));
  const sourceDumpSha256 = hash(sourceDump);
  assertSnapshotEvidence({
    evidence: snapshotEvidence,
    sourceEvidence: actualSourceManifest,
    dump: sourceDump,
    canonicalDatabaseIdentity: databaseIdentity(SOURCE_DATABASE_URL),
    canonicalRuntime: sourceRuntimeIdentity,
  });
  const importer = await importerProvenance();
  const migrationDocsChecksum = await migrationDocsSha256();
  const trackedContractChecksum = trackedMigrationContractSha256(migrationDocsChecksum);
  const targetS3Identity = {
    bucket: sharedObjectStore.bucket,
    region: sharedObjectStore.region,
    endpoint: sharedObjectStore.endpoint ?? null,
    forcePathStyle: sharedObjectStore.forcePathStyle,
  };
  assertApprovedRunArtifacts({
    mapping,
    approval,
    targetEnvironment: targetIdentity.environment,
    mappingSha256: hash(mappingText),
    sourceDumpSha256,
    sourceObjectManifestSha256: hash(objectManifestText),
    sourceManifestSha256: hash(sourceManifestText),
    snapshotEvidenceSha256: hash(snapshotEvidenceText),
    exceptionsSha256: hash(exceptionsText),
    sourceMigrationHistorySha256: actualSourceManifest.migrationHistorySha256,
    targetMigrationHistorySha256,
    sourceTableDigestsSha256: actualSourceManifest.tableDigestsSha256,
    sourceVersion: SOURCE_VERSION,
    sourceDatabaseIdentity: databaseIdentity(SOURCE_DATABASE_URL),
    targetDatabaseIdentity: targetIdentity.identity,
    targetS3: targetS3Identity,
    targetPostgresRuntimeIdentitySha256: postgresRuntimeIdentitySha256(targetRuntimeIdentity),
    writerFenceSha256: writerFenceSha256(verifiedWriterFence),
    importerGitCommit: importer.gitCommit,
    importerChecksumSha256: importer.checksumSha256,
    migrationDocsSha256: migrationDocsChecksum,
  });
  approvalRunId = String(approval.runId);
  if (path.basename(RUN_DIRECTORY) !== approvalRunId)
    throw new Error('Migration run directory basename must equal the approved runId');
  const prevalidatedPlan = mapping.executionPlan as any;
  if (!prevalidatedPlan?.schoolLogo?.targetKey ||
    !Array.isArray(prevalidatedPlan.templates))
    throw new Error('Approved executionPlan is missing its exact object-key plan');
  assertApprovedTargetObjectKeys(approval, [
    String(prevalidatedPlan.schoolLogo.targetKey),
    ...prevalidatedPlan.templates.map((template: any) => String(template.targetKey)),
  ]);
  await target.query(`
    INSERT INTO legacy_migration_run (
      run_id,school_id,status,source_database_identity,target_database_identity,source_version,
      source_migration_history_sha256,target_migration_history_sha256,source_table_digests_sha256,importer_git_commit,
      importer_checksum_sha256,mapping_sha256,approval_sha256,source_manifest_sha256,
      snapshot_evidence_sha256,exceptions_sha256,source_dump_sha256,object_manifest_sha256,decision_set_sha256,
      target_s3_endpoint,target_s3_region,target_s3_bucket,target_s3_force_path_style,
      target_postgres_runtime_identity,writer_fence,writers_disabled
    ) VALUES ($1,$2,'preparing',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,true)
  `, [
    approvalRunId, SCHOOL_ID, databaseIdentity(SOURCE_DATABASE_URL), targetIdentity.identity,
    SOURCE_VERSION, actualSourceManifest.migrationHistorySha256, targetMigrationHistorySha256,
    actualSourceManifest.tableDigestsSha256,
    importer.gitCommit, importer.checksumSha256, hash(mappingText), hash(approvalText), hash(sourceManifestText), hash(snapshotEvidenceText),
    hash(exceptionsText), sourceDumpSha256, hash(objectManifestText), trackedContractChecksum,
    targetS3Identity.endpoint, targetS3Identity.region, targetS3Identity.bucket, targetS3Identity.forcePathStyle,
    targetRuntimeIdentity, verifiedWriterFence,
  ]);

  {
    const schools = await queryRows(`SELECT * FROM school WHERE id=$1`, [SCHOOL_ID]);
    const sessions = await queryRows(`SELECT * FROM school_session WHERE school_id=$1 ORDER BY id`, [SCHOOL_ID]);
    const classesRaw = await queryRows(`SELECT * FROM class WHERE school_id=$1 ORDER BY id`, [SCHOOL_ID]);
    const sections = await queryRows(`SELECT * FROM section WHERE school_id=$1 ORDER BY class_id,id`, [SCHOOL_ID]);
    const admissions = await queryRows(`SELECT * FROM admission WHERE school_id=$1 ORDER BY id`, [SCHOOL_ID]);
    const students = await queryRows(`SELECT * FROM student WHERE school_id=$1 ORDER BY id`, [SCHOOL_ID]);
    const rawStaff = await queryRows(`SELECT * FROM staff WHERE school_id=$1 ORDER BY id`, [SCHOOL_ID]);
    const scopedUsers = await queryRows(`SELECT DISTINCT u.* FROM "user" u JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1 ORDER BY u.id`, [SCHOOL_ID]);
    const staff = await queryRows(`SELECT s.*,u.id AS user_id,u.name AS user_name,u.email_verified,u.image,u.created_at AS user_created_at,u.updated_at AS user_updated_at FROM staff s JOIN "user" u ON lower(trim(u.email))=lower(trim(s.email)) WHERE s.school_id=$1 ORDER BY s.id`, [SCHOOL_ID]);
    const staffAccounts = await queryRows<CredentialAccount & Row>(`
      SELECT a.*
      FROM account a
      JOIN "user" u ON u.id=a.user_id
      WHERE EXISTS (
        SELECT 1 FROM staff s
        WHERE s.school_id=$1 AND lower(trim(s.email))=lower(trim(u.email))
      )
      ORDER BY a.provider_id,a.id
    `, [SCHOOL_ID]);
    const credentialAccounts = staffAccounts.filter((row) => row.provider_id === "credential");
    const nonCredentialAccounts = staffAccounts.filter((row) => row.provider_id !== "credential");
    const plans = await queryRows(`SELECT * FROM exam_plan WHERE school_id=$1 ORDER BY session_id,"examSlug",class_id,"subjectSlug",id`, [SCHOOL_ID]);
    const results = await queryRows(`SELECT * FROM exam_result WHERE school_id=$1 ORDER BY session_id,exam_plan_id,id`, [SCHOOL_ID]);
    const timetables = await queryRows(`SELECT * FROM exam_timetable WHERE school_id=$1 ORDER BY session_id,"examSlug",id`, [SCHOOL_ID]);
    const billRuns = await queryRows(`SELECT * FROM bill_generation_event WHERE school_id=$1 ORDER BY created_at,id`, [SCHOOL_ID]);
    const bills = await queryRows(`SELECT b.* FROM student_bill_event b JOIN student s ON s.id=b.student_id WHERE s.school_id=$1 ORDER BY b.created_at,b.id`, [SCHOOL_ID]);
    const billProjections = await queryRows(`SELECT p.* FROM student_bill_projection p JOIN student s ON s.id=p.student_id WHERE s.school_id=$1 ORDER BY p.student_id`, [SCHOOL_ID]);
    const ledger = await queryRows(`SELECT * FROM ledger_event WHERE school_id=$1 ORDER BY created_at,id`, [SCHOOL_ID]);
    const ledgerProjections = await queryRows(`SELECT p.* FROM ledger_projection p JOIN student s ON s.id=p.student_id WHERE s.school_id=$1 ORDER BY p.student_id`, [SCHOOL_ID]);
    const artifacts = await queryRows(`SELECT * FROM artifact WHERE school_id=$1 AND type IN ('examination_template','idcard_template','admitcard_template','timetable_template','bill_template','receipt_template') ORDER BY type,id`, [SCHOOL_ID]);
    if (schools.length !== 1 || sessions.length !== 1) throw new Error("Approved tenant must have exactly one school and session");
    assertPreservedIds({
      school: schools, school_session: sessions, class: classesRaw, section: sections,
      admission: admissions, student: students, exam_plan: plans, exam_result: results,
      exam_timetable: timetables, artifact: artifacts, user: scopedUsers, account: staffAccounts,
    });
    const structuralValidation = validateSourceRows({
      schools, sessions, classes: classesRaw, sections, admissions, students, staff: rawStaff, users: scopedUsers,
      plans, results, timetables, billRuns, bills, ledger, billProjections, ledgerProjections,
    });
    assertCanonicalExceptionArtifact(
      approvedExceptions,
      [...structuralValidation.issues, ...blockingDispositionIssues(buildSourceDispositions(actualSourceManifest))],
      structuralValidation.rebuildExceptions,
    );
    const approvedWorkingDays = (mapping as Record<string, unknown>).totalWorkingDaysAgreement;
    if (stableJson(approvedWorkingDays) !== stableJson(structuralValidation.workingDays))
      throw new Error('Approved totalWorkingDays agreement does not match the connected source');
    if (stableJson(mapping.financeProjectionReport) !== stableJson(structuralValidation.projectionReport))
      throw new Error('Approved finance projection variance report does not match the connected source');
    if (stableJson(mapping.financeRebuilds) !== stableJson(structuralValidation.rebuildExceptions))
      throw new Error('Approved finance rebuild exceptions do not match the connected source');
    const canonicalObjects = buildSharedObjectContracts({
      schoolId: SCHOOL_ID,
      artifacts: artifacts as Array<any>,
      objects: objectManifest.objects,
    });
    if (stableJson(mapping.templates) !== stableJson(canonicalObjects.templates) ||
      stableJson(mapping.schoolLogo) !== stableJson(canonicalObjects.schoolLogo))
      throw new Error('Approved object references diverge from the tracked shared-bucket contract');
    exceptions.push(...structuralValidation.rebuildExceptions);
    const hasApprovedFinanceRebuild = (code: string, sourceKey: string) =>
      structuralValidation.rebuildExceptions.some(
        (entry) => entry.code === code && entry.sourceKey === sourceKey,
      );
    const executionPlan = buildTargetMigrationPlan({
      mapping, sourceVersion: SOURCE_VERSION, staff: rawStaff, sessions,
      classes: classesRaw, sections, billRuns, bills, ledger,
    });

    /** Every structure ID must have a reviewed one-to-one mapping before writes. */
    const assertMappedIds = (label: string, sourceRows: Row[], rawMapping: unknown) => {
      if (!Array.isArray(rawMapping))
        throw new Error(`Approved mapping is missing ${label}`);
      const mapped = rawMapping as Array<{ sourceId?: unknown; targetId?: unknown }>;
      const expected = sourceRows.map((row) => String(row.id)).toSorted();
      const actual = mapped
        .map((row) => {
          if (row.sourceId !== row.targetId)
            throw new Error(`Approved ${label} mapping does not preserve source ID`);
          return String(row.sourceId);
        })
        .toSorted();
      if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index]))
        throw new Error(`Approved ${label} mapping does not exactly match the frozen Prem Chandra source`);
    };
    assertMappedIds("sessions", sessions, mapping.sessions);
    assertMappedIds("classes", classesRaw, mapping.classes);
    assertMappedIds("sections", sections, mapping.sections);
    const school = schools[0]!;
    const session = sessions[0]!;
    const classes = classesRaw.toSorted((a, b) => classRank(a.slug) - classRank(b.slug) || a.slug.localeCompare(b.slug));
    const classById = new Map(classes.map((row) => [row.id, row]));
    const sectionById = new Map(sections.map((row) => [row.id, row]));
    const admissionById = new Map(admissions.map((row) => [row.id, row]));
    const studentById = new Map(students.map((row) => [row.id, row]));
    const planById = new Map(plans.map((row) => [row.id, row]));
    const staffActor = new Map(staff.map((row) => [row.id, row.user_id]));
    const staffUserIds = new Set(staff.map((row) => row.user_id));
    assertApprovedCredentials(credentialAccounts, staffUserIds);
    for (const account of credentialAccounts) {
      await assertTargetVerifierCompatibility(
        account,
        randomBytes(32).toString("hex"),
        verifyPassword,
      );
    }

    const targetCredentialCollisions = await target.query<{ id: string }>(`
      SELECT id
      FROM account
      WHERE id=ANY($1::text[])
         OR (issuer=$2 AND account_id=ANY($3::text[]))
    `, [
      credentialAccounts.map((account) => account.id),
      CREDENTIAL_ISSUER,
      credentialAccounts.map((account) => account.account_id),
    ]);
    if (targetCredentialCollisions.rowCount !== 0)
      throw new Error("Target account primary-key or issuer/accountId collision detected");
    const finance = financeConfig(school, classes);

    if (!Array.isArray(objectManifest.objects))
      throw new Error("Frozen source object manifest has no object inventory");
    const approvedObjects = objectManifest.objects.filter((item) =>
      item.schoolId === SCHOOL_ID && item.transferPolicy === 'reference');
    const objectByOwner = new Map(approvedObjects.map((item: Row) => [item.ownerId, item]));

    if (!Array.isArray(mapping.templates))
      throw new Error('Approved mapping must contain the exact template object contract');
    const templateApprovals = executionPlan.templates as ApprovedTemplateObject[];
    if (templateApprovals.length !== artifacts.length)
      throw new Error('Approved template mapping does not match source artifact cardinality');
    const templateApprovalByArtifact = new Map(
      templateApprovals.map((item) => [item.sourceArtifactId, item]),
    );

    const preparedTemplates: Row[] = [];
    for (const artifact of artifacts) {
      const item = objectByOwner.get(artifact.id);
      if (!item) throw new Error(`Missing object manifest entry for ${artifact.id}`);
      const sourceBytes = await readFile(
        resolveRunArtifact(RUN_DIRECTORY, String(item.contentPath)),
      );
      if (hash(sourceBytes) !== item.sha256) throw new Error(`Source checksum changed for ${artifact.id}`);
      const approvedTemplate = templateApprovalByArtifact.get(String(artifact.id));
      if (!approvedTemplate) throw new Error(`Missing approved template mapping for ${artifact.id}`);
      const documentType = approvedTemplate.documentType;
      const content = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
      renderDocument(content, SAMPLE_DOCUMENT_CONTEXT);
      assertApprovedObject({
        approved: approvedTemplate,
        manifest: item,
        sourceBytes,
        kind: 'template',
      });
      preparedTemplates.push({
        artifact, documentType, marketplaceSlug: null, pageSize: approvedTemplate.pageSize,
        sha256: hash(sourceBytes), targetKey: approvedTemplate.targetKey,
        contentType: approvedTemplate.targetContentType,
      });
    }

    const logoItem = objectByOwner.get(SCHOOL_ID);
    if (!logoItem) throw new Error("School logo is missing from the frozen manifest");
    const logoBytes = await readFile(
      resolveRunArtifact(RUN_DIRECTORY, String(logoItem.contentPath)),
    );
    const logoApproval = executionPlan.schoolLogo as ApprovedLogoObject | undefined;
    if (!logoApproval) throw new Error('Approved mapping must contain the school logo object contract');
    assertApprovedObject({ approved: logoApproval, manifest: logoItem, sourceBytes: logoBytes, kind: 'logo' });
    const logoKey = logoApproval.targetKey;

    const plannedObjects = [
      { key: logoKey },
      ...preparedTemplates.map((item) => ({ key: item.targetKey })),
    ];
    assertApprovedTargetObjectKeys(
      approval,
      plannedObjects.map((object) => object.key),
    );

    const finalWriterFence = await verifyWriterFence(writerFenceConfig);
    if (writerFenceSha256(finalWriterFence) !== writerFenceSha256(verifiedWriterFence))
      throw new Error('Kubernetes writer fence identity changed during object preparation');
    await target.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      await target.query(
        `SELECT set_config('campuspilot.legacy_migration_run_id',$1,true)`,
        [approvalRunId],
      );
      const finalInventory = await targetPublicRowCount();
      if (finalInventory.rowCount !== 0)
        throw new Error(
          `Target changed after preparation; found ${finalInventory.rowCount} business rows immediately before writes`,
        );
      const durableRun = await target.query<{ status: string }>(
        `SELECT status FROM legacy_migration_run WHERE run_id=$1 FOR UPDATE`,
        [approvalRunId],
      );
      if (durableRun.rows.length !== 1 || durableRun.rows[0]?.status !== 'preparing')
        throw new Error('Durable migration run is not in preparing state');
      await insert("school", {
        id: school.id, slug: school.slug, name: school.name, location: school.location,
        registration_no: school.registrationNo, logo_s3_key: logoKey,
        created_at: school.createdAt, updated_at: school.updatedAt,
        has_completed_onboarding: false, admission_settings: { documentTypes: [] },
      }, `school:${school.id}`);

      for (const member of staff) {
        if (executionPlan.decisionPolicy?.['I-07']?.emailVerified !== 'preserve' ||
          executionPlan.decisionPolicy?.['I-10']?.providerImage !== 'omit')
          throw new Error('Approved identity policy is not executable');
        await insert('"user"', {
          id: member.user_id, name: member.user_name, email: String(member.email).trim().toLowerCase(),
          email_verified: member.email_verified, image: null, created_at: member.user_created_at,
          updated_at: member.user_updated_at, setup_status: null, role: "user", banned: false,
          ban_reason: null, ban_expires: null, profile_image_s3_key: null,
        }, `user:${member.user_id}`);
        await insert("school_member", { school_id: SCHOOL_ID, user_id: member.user_id, added_at: member.createdAt }, `staff:${member.id}`);
        const classIds = executionPlan.staffClassScopes[member.id];
        await insert("school_user_role", {
          school_id: SCHOOL_ID, user_id: member.user_id,
          role: executionPlan.staffRoles[member.id],
          created_at: member.createdAt,
          meta: member.role === "teacher" ? { classIds } : null,
        }, `staff:${member.id}:role`);
      }

      for (const account of credentialAccounts) {
        await insert("account", {
          id: account.id,
          issuer: CREDENTIAL_ISSUER,
          account_id: account.user_id,
          provider_id: "credential",
          user_id: account.user_id,
          access_token: null,
          refresh_token: null,
          id_token: null,
          access_token_expires_at: null,
          refresh_token_expires_at: null,
          scope: null,
          password: account.password,
          created_at: account.created_at,
          updated_at: account.updated_at,
        }, `account:${account.id}`);
      }

      await insert("school_session", {
        id: session.id, school_id: SCHOOL_ID, session_end_year: session.sessionEndYear,
        session_start_year: session.sessionStartYear, session_config: session.sessionConfig,
        finance_config: finance.config, created_at: session.createdAt, updated_at: session.updatedAt,
        is_active: executionPlan.activeSessions[session.id],
        finance_class_overrides: finance.classOverrides,
      }, `school_session:${session.id}`);

      for (const klass of classes) {
        await insert("class", {
          id: klass.id, slug: klass.slug, label: klass.label, school_id: SCHOOL_ID,
          attributes: klass.attributes ?? {}, config: klass.config ?? { subjects: {} },
          created_at: klass.createdAt, updated_at: klass.updatedAt, display_order: executionPlan.classDisplayOrders[klass.id],
        }, `class:${klass.id}`);
      }
      for (const klass of classes) {
        const ordered = sections.filter((row) => row.class_id === klass.id).toSorted((a, b) => a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id));
        for (const section of ordered) {
          await insert("section", {
            id: section.id, slug: section.slug, label: section.label, class_id: section.class_id,
            school_id: SCHOOL_ID, attributes: section.attributes ?? {}, created_at: section.createdAt,
            updated_at: section.updatedAt, display_order: executionPlan.sectionDisplayOrders[section.id],
          }, `section:${section.id}`);
        }
      }

      for (const admission of admissions) {
        const enrollment = students.find((row) => row.admission_id === admission.id);
        const admissionFinance = enrollment?.finance_config
          ? { [enrollment.session_id]: Object.fromEntries(Object.entries(enrollment.finance_config).map(([slug, amount]) => [slug, Number(toMinor(amount))])) }
          : {};
        await insert("admission", {
          id: admission.id, school_id: SCHOOL_ID, name: admission.name,
          admission_no: admission.admissionNo, admission_class_id: admission.admission_class_id,
          address: admission.address, phone_no: admission.phoneNo, email: admission.email, dob: admission.dob,
          father_name: admission.fatherName, mother_name: admission.motherName,
          registered: admission.registered, photo_s3_key: null, documents: JSON.stringify([]), finance_config: admissionFinance,
          created_at: admission.createdAt, updated_at: admission.updatedAt, unregistered_at: null,
        }, `admission:${admission.id}`);
      }
      for (const student of students) {
        await insert("student", {
          id: student.id, class_id: student.class_id, section_id: student.section_id,
          school_id: SCHOOL_ID, admission_id: student.admission_id, session_id: student.session_id,
          roll_no: student.rollNo, created_at: student.createdAt, updated_at: student.updatedAt,
        }, `student:${student.id}`);
      }

      for (const plan of plans) {
        await insert("exam_plan", {
          id: plan.id, school_id: SCHOOL_ID, session_id: plan.session_id, exam_slug: plan.examSlug,
          class_id: plan.class_id, subject_slug: plan.subjectSlug, total_marks: plan.totalMarks,
          mode_config: plan.modeConfig, total_working_days: plan.totalWorkingDays, status: plan.status,
          created_at: plan.createdAt, updated_at: plan.updatedAt,
        }, `exam_plan:${plan.id}`);
      }
      for (const result of results) {
        await insert("exam_result", {
          id: result.id, exam_plan_id: result.exam_plan_id, student_id: result.student_id,
          school_id: SCHOOL_ID, session_id: result.session_id, marks: result.marks,
          co_scholastics: result.coScholastics, days_attended: result.days_attended,
          approved: result.approved, created_at: result.createdAt, updated_at: result.updatedAt,
        }, `exam_result:${result.id}`);
      }
      for (const timetable of timetables) {
        await insert("exam_timetable", {
          id: timetable.id, school_id: SCHOOL_ID, session_id: timetable.session_id,
          exam_slug: timetable.examSlug, config: timetable.config,
          created_at: timetable.createdAt, updated_at: timetable.updatedAt,
        }, `exam_timetable:${timetable.id}`);
      }

      const plansByExam = Map.groupBy(plans, (plan) => `${plan.session_id}:${plan.examSlug}`);
      for (const [key, group] of plansByExam) {
        const statuses = new Set(group.map((plan) => plan.status));
        if (statuses.size !== 1) throw new Error(`Mixed lifecycle status for ${key}`);
        const status = group[0]!.status === "completed" ? "completed" : group[0]!.status === "active" ? "active" : "ready";
        const [sessionId, examSlug] = key.split(":");
        await insert("exam_lifecycle", { school_id: SCHOOL_ID, session_id: sessionId, exam_slug: examSlug, status, started_at: null, completed_at: null }, `exam:${key}:lifecycle`);
      }

      if (!Array.isArray(executionPlan.assessmentSettings))
        throw new Error('Approved mapping is missing examination assessment settings');
      const assessmentSettings = executionPlan.assessmentSettings as Array<{ sessionId: string; examSlug: string; totalWorkingDays: number }>;
      const expectedExamKeys = [...plansByExam.keys()].toSorted();
      const approvedExamKeys = assessmentSettings.map((entry) => `${entry.sessionId}:${entry.examSlug}`).toSorted();
      if (stableJson(expectedExamKeys) !== stableJson(approvedExamKeys) || assessmentSettings.some((entry) => entry.totalWorkingDays !== CANONICAL_DECISION_POLICY['E-03'].totalWorkingDays))
        throw new Error('Approved assessment settings must cover every exam exactly with totalWorkingDays=81');
      for (const setting of assessmentSettings) {
        await insert('exam_assessment_settings', {
          school_id: SCHOOL_ID, session_id: setting.sessionId,
          exam_slug: setting.examSlug, total_working_days: setting.totalWorkingDays,
        }, `exam:${setting.sessionId}:${setting.examSlug}:assessment-settings`);
      }

      const assessmentGroups = Map.groupBy(results, (result) => {
        const plan = planById.get(result.exam_plan_id)!;
        return `${result.session_id}:${plan.examSlug}:${result.student_id}`;
      });
      for (const [key, group] of assessmentGroups) {
        const ordered = group.toSorted((a, b) => a.id.localeCompare(b.id));
        const daysAttended = selectAgreedAssessmentValue(ordered, "days_attended", key);
        const coScholastics = selectAgreedAssessmentValue(ordered, "coScholastics", key);
        const approved = selectAgreedAssessmentValue(ordered, "approved", key);
        if (typeof approved !== "boolean") throw new Error(`Assessment approval missing ${key}`);
        const updatedAt = ordered
          .map((row) => row.updatedAt ?? row.createdAt)
          .toSorted()
          .at(-1);
        if (!updatedAt) throw new Error(`Assessment timestamp missing ${key}`);
        const [sessionId, examSlug, studentId] = key.split(":");
        await insert("exam_student_assessment", {
          school_id: SCHOOL_ID, session_id: sessionId, exam_slug: examSlug, student_id: studentId,
          days_attended: daysAttended, co_scholastics: coScholastics,
          approved, updated_at: updatedAt,
        }, `exam_assessment:${key}`);
      }

      const runById = new Map(billRuns.map((row) => [row.id, row]));
      const billsByRun = Map.groupBy(bills.filter((row) => row.bill_event_id), (row) => row.bill_event_id);
      const runTargets = new Map<string, Row>();
      for (const run of billRuns) {
        const members = billsByRun.get(run.id) ?? [];
        const totalMinor = members.reduce((sum, bill) => sum + toMinor(bill.amount), 0n);
        if (totalMinor !== toMinor(run.meta.totalAmount) || members.length !== Number(run.meta.studentCount)) {
          if (!hasApprovedFinanceRebuild('F_BILL_RUN_HEADER_REBUILD', String(run.id)))
            throw new Error(`Bill-run header ${run.id} needs an approved rebuild decision`);
        }
        const bounds = monthBounds(run.meta.period);
        const targetRun = {
          id: executionPlan.generatedIds[`billRun:${run.id}`], school_id: SCHOOL_ID,
          session_id: run.session_id, kind: "regular", status: "posting", period_key: run.meta.period,
          period_start_date: bounds.start, period_end_date: bounds.end,
          period_start_at: bounds.startAt, period_end_at: bounds.endAt,
          issue_date: String(run.created_at).slice(0, 10),
          time_zone: executionPlan.decisionPolicy['G-05'].sourceTimeZone,
          cadence: run.meta.frequency, currency: "INR",
          config_hash: hash(stableJson(finance.config)), config_snapshot: finance.config,
          input_snapshot: { sourceSystem: SOURCE_VERSION, sourceId: run.id, legacyMeta: run.meta },
          total_amount_minor: totalMinor.toString(), bill_count: members.length,
          supplemental_reason: null,
          idempotency_key: `${SOURCE_VERSION}:bill_generation_event:${run.id}:run`,
          recorded_by: staffActor.get(run.generated_by) ?? executionPlan.migrationActor,
          recorded_at: localInstant(run.created_at), finalized_at: null,
        };
        runTargets.set(run.id, targetRun);
        await insert("finance_bill_run", targetRun, `bill_generation_event:${run.id}`);
      }

      type Candidate = { at: string; sourceId: string; order: number; kind: "bill" | "payment" | "discount"; row: Row; admissionId: string };
      const candidates: Candidate[] = [];
      for (const bill of bills) {
        const student = studentById.get(bill.student_id)!;
        candidates.push({ at: localInstant(bill.created_at), sourceId: bill.id, order: 0, kind: "bill", row: bill, admissionId: student.admission_id });
      }
      for (const event of ledger) {
        const student = studentById.get(event.student_id)!;
        if (toMinor(event.amount) > 0n) candidates.push({ at: localInstant(event.created_at), sourceId: event.id, order: 1, kind: "payment", row: event, admissionId: student.admission_id });
        if (toMinor(event.discount) > 0n) candidates.push({ at: localInstant(event.created_at), sourceId: event.id, order: 2, kind: "discount", row: event, admissionId: student.admission_id });
      }
      candidates.sort(compareLegacyLedgerCandidates);
      const sequences = new Map<string, bigint>();
      for (const candidate of candidates) {
        const sequence = (sequences.get(candidate.admissionId) ?? 0n) + 1n;
        sequences.set(candidate.admissionId, sequence);
        const student = studentById.get(candidate.row.student_id)!;
        const admission = admissionById.get(student.admission_id)!;
        const klass = classById.get(student.class_id)!;
        const section = sectionById.get(student.section_id)!;
        const snapshot = documentSnapshot(admission, student, session, klass, section);
        const actor = candidate.kind === "bill"
          ? (candidate.row.bill_event_id ? staffActor.get(runById.get(candidate.row.bill_event_id)?.generated_by) : executionPlan.migrationActor)
          : staffActor.get(candidate.row.recorded_by);
        if (candidate.kind === 'bill' && !candidate.row.bill_event_id &&
          !hasApprovedFinanceRebuild('F_STANDALONE_MANUAL_FALLBACK', String(candidate.row.id)))
          throw new Error(`Standalone bill ${candidate.row.id} needs an approved migration-actor fallback`);
        const amount = candidate.kind === "bill" ? toMinor(candidate.row.amount) : candidate.kind === "payment" ? toMinor(candidate.row.amount) : toMinor(candidate.row.discount);
        const ledgerType = candidate.kind === "bill" ? (candidate.row.bill_event_id ? "bill" : "manual_debit_adjustment") : candidate.kind;
        const ledgerId = executionPlan.generatedIds[`ledger:${candidate.kind}:${candidate.sourceId}`];
        await insert("finance_ledger_entry", {
          id: ledgerId, school_id: SCHOOL_ID, admission_id: admission.id, session_id: student.session_id,
          sequence: sequence.toString(), type: ledgerType,
          direction: candidate.kind === "bill" ? "debit" : "credit",
          amount_minor: amount.toString(), currency: "INR", effective_at: candidate.at,
          recorded_at: candidate.at, recorded_by: actor ?? executionPlan.migrationActor,
          note: candidate.kind === "bill" ? null : candidate.row.note,
          reversal_of_entry_id: null,
          idempotency_key: `${SOURCE_VERSION}:${candidate.kind}:${candidate.sourceId}:ledger`,
          document_snapshot: snapshot,
        }, `${candidate.kind}:${candidate.sourceId}:ledger`);

        if (candidate.kind === "bill") {
          const bill = candidate.row;
          const manualReason = bill.bill_event_id
            ? null
            : executionPlan.decisionPolicy['F-12'].standaloneManualReason;
          const billId = executionPlan.generatedIds[`bill:${bill.id}`];
          const lineEntries = Object.entries(bill.line_items as Record<string, Row>).sort(([left], [right]) => left.localeCompare(right));
          await insert("finance_bill", {
            id: billId, school_id: SCHOOL_ID, admission_id: admission.id, session_id: student.session_id,
            bill_run_id: bill.bill_event_id ? runTargets.get(bill.bill_event_id)!.id : null,
            ledger_entry_id: ledgerId, status: "posting",
            source_kind: bill.bill_event_id ? "billing_run" : "manual",
            bill_number: executionPlan.billNumbers[bill.id], issue_date: String(bill.created_at).slice(0, 10),
            period_key: bill.bill_event_id ? runById.get(bill.bill_event_id)!.meta.period : null,
            currency: "INR", total_amount_minor: amount.toString(), line_count: lineEntries.length,
            admission_number_snapshot: admission.admissionNo, admission_name_snapshot: admission.name,
            session_start_year_snapshot: session.sessionStartYear, session_end_year_snapshot: session.sessionEndYear,
            enrollment_id_snapshot: student.id, class_id_snapshot: klass.id, class_slug_snapshot: klass.slug,
            class_label_snapshot: klass.label, section_id_snapshot: section.id,
            section_slug_snapshot: section.slug, section_label_snapshot: section.label,
            roll_number_snapshot: student.rollNo,
            config_hash: bill.bill_event_id ? hash(stableJson(finance.config)) : null,
            manual_reason: manualReason, recorded_by: actor ?? executionPlan.migrationActor,
            recorded_at: candidate.at, finalized_at: null,
          }, `student_bill_event:${bill.id}`);
          for (const [index, [slug, line]] of lineEntries.entries()) {
            const pricingSource = slug === "custom" ? "manual" : line.source === "student" ? "admission" : line.source === "class" ? "class" : "fallback";
            await insert("finance_bill_line", {
              id: executionPlan.generatedIds[`billLine:${bill.id}:${slug}`], school_id: SCHOOL_ID,
              bill_id: billId, line_order: index, fee_element_slug: slug === "custom" ? "manual-item" : slug,
              fee_element_name: line.name, amount_minor: toMinor(line.amount).toString(), currency: "INR",
              pricing_source_kind: pricingSource,
              pricing_source_key: pricingSource === "admission" ? admission.id : pricingSource === "class" ? klass.id : null,
              pricing_rule_snapshot: { sourceSystem: SOURCE_VERSION, sourceBillId: bill.id, sourceSlug: slug, legacySource: line.source },
              manual_reason: pricingSource === "manual" ? manualReason : null,
            }, `student_bill_event:${bill.id}:line:${slug}`);
          }
          await target.query(`UPDATE finance_bill SET status='posted',finalized_at=$2 WHERE id=$1`, [billId, startedAt]);
        } else if (candidate.kind === "payment") {
          const paymentId = executionPlan.generatedIds[`payment:${candidate.row.id}`];
          const commandSnapshot = {
            sourceSystem: SOURCE_VERSION, sourceId: candidate.row.id,
            schoolId: SCHOOL_ID, admissionId: admission.id, sessionId: student.session_id,
            amountMinor: amount.toString(), currency: "INR", method: "cash",
            receivedAt: candidate.at, effectiveAt: candidate.at,
            externalReference: null, payerName: null, note: candidate.row.note ?? null,
          };
          await insert("finance_payment", {
            id: paymentId, school_id: SCHOOL_ID, admission_id: admission.id, session_id: student.session_id,
            ledger_entry_id: ledgerId, receipt_number: executionPlan.receiptNumbers[candidate.row.id],
            amount_minor: amount.toString(), currency: "INR", method: "cash",
            external_reference: null, payer_name: null, received_at: candidate.at,
            note: candidate.row.note, idempotency_key: `${SOURCE_VERSION}:ledger_event:${candidate.row.id}:payment`,
            recorded_by: actor ?? executionPlan.migrationActor, recorded_at: candidate.at,
            command_hash: hash(stableJson(commandSnapshot)), command_snapshot: commandSnapshot,
            document_snapshot: snapshot,
          }, `ledger_event:${candidate.row.id}:payment`);
        } else {
          await insert("finance_adjustment", {
            id: executionPlan.generatedIds[`adjustment:${candidate.row.id}`], school_id: SCHOOL_ID,
            admission_id: admission.id, session_id: student.session_id, ledger_entry_id: ledgerId,
            bill_id: null, bill_line_id: null, kind: "discount", amount_minor: amount.toString(),
            currency: "INR", reason_code: "-", reason_note: "-",
            calculation_snapshot: { sourceSystem: SOURCE_VERSION, sourceId: candidate.row.id, legacyNote: candidate.row.note ?? null },
            approved_by: null, idempotency_key: `${SOURCE_VERSION}:ledger_event:${candidate.row.id}:discount`,
            recorded_by: actor ?? executionPlan.migrationActor, recorded_at: candidate.at,
          }, `ledger_event:${candidate.row.id}:discount`);
        }
      }

      for (const targetRun of runTargets.values()) {
        await target.query(`UPDATE finance_bill_run SET status='posted',finalized_at=$2 WHERE id=$1`, [targetRun.id, startedAt]);
      }
      for (const kind of ['bill', 'receipt', 'refund'] as const) {
        await insert('finance_number_counter', {
          school_id: SCHOOL_ID,
          session_id: executionPlan.financeNumberCounters.sessionId,
          kind,
          fiscal_key: executionPlan.financeNumberCounters.fiscalKey,
          next_value: String(executionPlan.financeNumberCounters.nextValues[kind]),
          updated_at: startedAt,
        }, `approved-finance-number-counter:${kind}`);
      }
      await target.query(`
        INSERT INTO finance_admission_balance (school_id,admission_id,currency,last_sequence,debit_total_minor,credit_total_minor)
        SELECT school_id,admission_id,currency,max(sequence),
          coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0),
          coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0)
        FROM finance_ledger_entry GROUP BY school_id,admission_id,currency
      `);
      await target.query(`
        INSERT INTO finance_admission_session_activity (school_id,admission_id,session_id,currency,last_sequence,entry_count,debit_total_minor,credit_total_minor)
        SELECT school_id,admission_id,session_id,currency,max(sequence),count(*),
          coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0),
          coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0)
        FROM finance_ledger_entry GROUP BY school_id,admission_id,session_id,currency
      `);

      for (const item of preparedTemplates) {
        await insert("artifact", {
          id: item.artifact.id, school_id: SCHOOL_ID, kind: "template",
          document_type: item.documentType, status: "ready",
          name: `Migrated ${item.documentType.replaceAll("_", " ")} template`,
          s3_key: item.targetKey, content_type: "text/x-handlebars-template; charset=utf-8",
          byte_size: item.bytes.byteLength, sha256: item.sha256,
          template_revision_id: null, marketplace_slug: item.marketplaceSlug,
          session_id: null, exam_slug: null, class_id: null, student_ids: JSON.stringify([]), student_count: 0,
          created_by: executionPlan.migrationActor, created_at: startedAt, generation_options: {},
          finance_source: null, page_size: item.pageSize,
        }, `artifact:${item.artifact.id}`);
        await insert("school_document_template", {
          school_id: SCHOOL_ID, document_type: item.documentType,
          artifact_id: item.artifact.id, updated_at: startedAt,
        }, `artifact:${item.artifact.id}:selection`);
      }

      const migratedCredentials = (
        await target.query<TargetCredentialAccount>(`
          SELECT id,issuer,account_id,provider_id,user_id,password,
            access_token,refresh_token,id_token,access_token_expires_at,
            refresh_token_expires_at,scope
          FROM account
          WHERE issuer=$1 AND provider_id='credential'
          ORDER BY id
        `, [CREDENTIAL_ISSUER])
      ).rows;
      if (migratedCredentials.length !== APPROVED_CREDENTIAL_COUNT)
        throw new Error(
          `Target credential reconciliation expected ${APPROVED_CREDENTIAL_COUNT}, found ${migratedCredentials.length}`,
        );
      for (const [index, account] of migratedCredentials.entries()) {
        assertTargetCredential(account);
        assertCredentialPreserved(credentialAccounts[index]!, account);
      }

      const precommitWriterFence = await verifyWriterFence(writerFenceConfig);
      if (writerFenceSha256(precommitWriterFence) !== writerFenceSha256(verifiedWriterFence))
        throw new Error('Kubernetes writer fence changed immediately before target commit');

      await target.query(`
        UPDATE legacy_migration_run
        SET status='committed',committed_at=now(),updated_at=now(),error_summary=NULL
        WHERE run_id=$1 AND status='preparing'
      `, [approvalRunId]);
      try {
        await target.query("COMMIT");
        targetCommitted = true;
      } catch (commitError) {
        const observer = new Client({ connectionString: TARGET_DATABASE_URL });
        try {
          await observer.connect();
          const observed = (await observer.query<{
            status: string; mapping_sha256: string; importer_checksum_sha256: string;
          }>(`SELECT status,mapping_sha256,importer_checksum_sha256 FROM legacy_migration_run WHERE run_id=$1`, [approvalRunId])).rows[0];
          if (observed && ['committed', 'finalized'].includes(observed.status) && observed.mapping_sha256 === hash(mappingText) && observed.importer_checksum_sha256 === importer.checksumSha256) {
            targetCommitted = true;
          } else if (!observed || observed.status === 'preparing' || observed.status === 'failed') {
            throw commitError;
          } else {
            commitOutcomeUnknown = true;
            throw new Error('COMMIT outcome is ambiguous; objects are preserved for explicit recovery', { cause: commitError });
          }
        } catch (observationError) {
          if (observationError === commitError) throw observationError;
          commitOutcomeUnknown = true;
          throw new Error('COMMIT outcome could not be established on a fresh connection; objects are preserved', { cause: observationError });
        } finally { await observer.end().catch(() => undefined); }
      }
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }

    await afterCommitBeforeAudit();

    const countEntries: Array<[string, number]> = [];
    for (const table of [
      "school", '"user"', "school_member", "school_user_role", "school_session", "class", "section",
      "admission", "student", "exam_plan", "exam_result", "exam_timetable", "exam_lifecycle",
      "exam_student_assessment", "exam_assessment_settings", "finance_bill_run", "finance_ledger_entry", "finance_bill",
      "finance_bill_line", "finance_payment", "finance_adjustment", "finance_admission_balance",
      "finance_admission_session_activity", "artifact", "school_document_template",
      "account",
    ]) {
      const result = await target.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
      countEntries.push([table.replaceAll('"', ""), Number(result.rows[0]!.count)]);
    }
    const counts = Object.fromEntries(countEntries);
    const financeTotals = (await target.query(`
      SELECT
        coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0)::text AS debits,
        coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0)::text AS credits,
        coalesce(sum(amount_minor) FILTER (WHERE type='payment'),0)::text AS payments,
        coalesce(sum(amount_minor) FILTER (WHERE type='discount'),0)::text AS discounts
      FROM finance_ledger_entry WHERE school_id=$1
    `, [SCHOOL_ID])).rows[0];
    const projectionDrift = (await target.query<{ count: string }>(`
      WITH expected AS (
        SELECT school_id,admission_id,currency,max(sequence) last_sequence,
          sum(amount_minor) FILTER (WHERE direction='debit') debits,
          sum(amount_minor) FILTER (WHERE direction='credit') credits
        FROM finance_ledger_entry GROUP BY school_id,admission_id,currency
      )
      SELECT count(*)::text AS count FROM expected e JOIN finance_admission_balance b USING (school_id,admission_id,currency)
      WHERE e.last_sequence<>b.last_sequence OR e.debits<>b.debit_total_minor OR e.credits<>b.credit_total_minor
    `)).rows[0]!.count;
    const objectCount = plannedObjects.length;
    const reconciliation = {
      schoolId: SCHOOL_ID,
      source: { staff: staff.length, credentialAccounts: credentialAccounts.length, linkedProviderAccounts: nonCredentialAccounts.length, classes: classes.length, sections: sections.length, admissions: admissions.length, students: students.length, plans: plans.length, results: results.length, timetables: timetables.length, billRuns: billRuns.length, bills: bills.length, ledgerEvents: ledger.length, templates: artifacts.length },
      target: counts,
      financeTotals,
      projectionDrift: Number(projectionDrift),
      objectCount,
      generatedPdfRows: 0,
      profilePhotos: 0,
    };
    const committedRun = (await target.query<any>(
      `SELECT * FROM legacy_migration_run WHERE run_id=$1`,
      [approvalRunId],
    )).rows[0];
    const auditChecksums = await writeDeterministicAuditArtifacts({
      target,
      runDirectory: RUN_DIRECTORY,
      durableRun: committedRun,
      sourceEvidence: actualSourceManifest,
      approval,
      exceptions: approvedExceptions,
    });
    const auditAttestation = await target.query(`
      UPDATE legacy_migration_run SET
        writes_sha256=$2,dispositions_sha256=$3,audit_exceptions_sha256=$4,
        target_after_sha256=$5,reconciliation_sha256=$6,run_report_sha256=$7,updated_at=now()
      WHERE run_id=$1 AND status='committed' AND writes_sha256 IS NULL
      RETURNING run_id
    `, [
      approvalRunId,
      auditChecksums['writes.ndjson'],
      auditChecksums['dispositions.ndjson'],
      auditChecksums['exceptions.ndjson'],
      auditChecksums['target-after.json'],
      auditChecksums['reconciliation.json'],
      auditChecksums['run.json'],
    ]);
    if (auditAttestation.rowCount !== 1)
      throw new Error('Durable migration run could not attest the required post-commit audit artifacts');
    console.log(JSON.stringify({ status: "committed-awaiting-verification", reconciliation }));
  }
} catch (error) {
  const failures: unknown[] = [error];
  if (!targetCommitted && !commitOutcomeUnknown) {
    if (approvalRunId) {
      try {
        await target.query(`
          UPDATE legacy_migration_run
          SET status='failed',failed_at=now(),updated_at=now(),error_summary=$2
          WHERE run_id=$1 AND status='preparing'
        `, [approvalRunId, error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)]);
      } catch (stateError) {
        failures.push(stateError);
      }
    }
  } else if (approvalRunId && targetCommitted) {
    try {
      await target.query(`
        UPDATE legacy_migration_run
        SET updated_at=now(),error_summary=$2
        WHERE run_id=$1 AND status='committed'
      `, [approvalRunId, error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)]);
    } catch (stateError) {
      failures.push(stateError);
    }
  }
  if (failures.length > 1) throw new AggregateError(failures, 'Migration failed and cleanup/state recording was incomplete');
  throw error;
} finally {
  await source.query("ROLLBACK").catch(() => undefined);
  await target.query(`SELECT pg_advisory_unlock(hashtextextended('campuspilot-legacy-migration',0))`).catch(() => undefined);
  await Promise.all([source.end(), target.end()]);
}
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runImport();
}
