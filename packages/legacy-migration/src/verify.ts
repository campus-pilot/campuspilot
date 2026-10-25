import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from 'node:url';
import { promisify } from "node:util";

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { SAMPLE_DOCUMENT_CONTEXT } from '@campuspilot/api/routers/school/document/document.catalog';
import { combineDocuments, renderDocument } from '@campuspilot/api/routers/school/document/document.render';
import {
  migrationGotenbergUrl,
  approvedInputFiles,
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
import {
  APPROVED_SCHOOL_ID,
  assertAllowedTarget,
  assertAllowedSourceSnapshot,
  assertDistinctSourceAndTarget,
  assertApprovedRunArtifacts,
  assertMigrationHistory,
  databaseIdentity,
  type ApprovalBundle,
  type ApprovedMapping,
  type MigrationRecord,
} from './migration-guards.ts';
import { captureSourceEvidence, assertSourceEvidence, type SourceEvidence } from './source-evidence.ts';
import { assertSourceObjectManifest, type SourceObjectManifest } from './source-object-manifest.ts';
import { importerProvenance } from './provenance.ts';
import { migrationDocsSha256 } from './tracked-contract.ts';
import { postgresRuntimeIdentity, postgresRuntimeIdentitySha256 } from './database-runtime.ts';
import {
  verifyKubernetesWriterFence,
  writerFenceSha256,
  type WriterFence,
} from './writer-fence.ts';
import { buildTargetMigrationPlan } from './target-plan.ts';
import { assertSnapshotEvidence, type SnapshotEvidence } from './snapshot-evidence.ts';
import { CANONICAL_DECISION_POLICY, trackedMigrationContractSha256 } from './canonical-decisions.ts';
import { migrationHistory, targetMigrationDirectory } from './migration-history.ts';

export type VerifyCoreDependencies = {
  verifyWriterFence: (
    options: ReturnType<typeof kubernetesWriterFenceConfig>,
  ) => Promise<WriterFence>;
};

export function resolveVerifyCoreDependencies(
  dependencies: Partial<VerifyCoreDependencies> = {},
): VerifyCoreDependencies {
  return {
    verifyWriterFence:
      dependencies.verifyWriterFence ?? verifyKubernetesWriterFence,
  };
}

/** Run verification through the production path with narrowly injectable external trust observations. */
export async function runVerify(
  dependencies: Partial<VerifyCoreDependencies> = {},
) {
const { verifyWriterFence } =
  resolveVerifyCoreDependencies(dependencies);
const { Client, types } = pg;
types.setTypeParser(1114, (value: string) => value);
const execFile = promisify(execFileCallback);
const SCHOOL_ID = APPROVED_SCHOOL_ID;
const RUN_DIRECTORY = runDirectory();
const sourceUrl = sourceDatabaseUrl();
const sourceAccess = sourceAuthorization();
const targetUrl = targetDatabaseUrl();
const targetRole = targetDatabaseRole();
const targetLoginRole = targetDatabaseLoginRole();
const authorization = targetAuthorization();
const targetObjectStore = sourceS3Config();
const gotenbergUrl = migrationGotenbergUrl();
const inputFiles = approvedInputFiles();
assertDistinctSourceAndTarget(sourceUrl, targetUrl);
assertAllowedSourceSnapshot({
  connectionString: sourceUrl,
  environment: sourceAccess.environment,
  allowedDatabaseIdentities: sourceAccess.allowedDatabaseIdentities,
});
const targetIdentity = assertAllowedTarget({
  connectionString: targetUrl,
  environment: authorization.environment,
  allowedDatabaseIdentities: authorization.allowedDatabaseIdentities,
});

const source = new Client({ connectionString: sourceUrl });
const target = new Client({ connectionString: targetUrl });
const s3 = new S3Client({
  region: targetObjectStore.region,
  ...(targetObjectStore.endpoint ? { endpoint: targetObjectStore.endpoint } : {}),
  forcePathStyle: targetObjectStore.forcePathStyle,
  credentials: {
    accessKeyId: targetObjectStore.accessKeyId,
    secretAccessKey: targetObjectStore.secretAccessKey,
  },
});

const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
function check(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}
function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function convertDocumentPdf(html: string, type: string) {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', type === 'timetable' ? '11.7' : '8.27');
  form.append('paperHeight', type === 'timetable' ? '8.27' : '11.7');
  form.append('preferCssPageSize', 'true');
  form.append('printBackground', 'true');
  const response = await fetch(
    `${gotenbergUrl}/forms/chromium/convert/html`,
    {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok)
    throw new Error(`PDF conversion failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 30_000_000 || bytes.subarray(0, 5).toString() !== '%PDF-')
    throw new Error('PDF converter returned an invalid or oversized document.');
  return bytes;
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
/** Select an agreed exam-wide value without treating a leading null as authoritative. */
function selectAssessmentValue(rows: any[], field: string, key: string) {
  const populated = rows.filter((row) => row[field] != null);
  const values = new Set(populated.map((row) => stableJson(row[field])));
  if (values.size > 1) throw new Error(`Source assessment conflict ${key}:${field}`);
  return populated[0]?.[field] ?? null;
}
async function count(client: InstanceType<typeof Client>, table: string, where = "") {
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} ${where}`);
  return Number(result.rows[0]!.count);
}

await source.connect();
await target.connect();
await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const sourceReadOnly = await source.query<{ transaction_read_only: string }>(
  'SHOW transaction_read_only',
);
if (sourceReadOnly.rows[0]?.transaction_read_only !== 'on')
  throw new Error('Legacy snapshot transaction is not read-only');
const [mappingText, approvalText, objectManifestText, sourceManifestText, snapshotEvidenceText, exceptionsText, sourceDump] = await Promise.all([
  readFile(inputFiles.mapping, 'utf8'), readFile(inputFiles.approval, 'utf8'),
  readFile(inputFiles.objectManifest, 'utf8'), readFile(inputFiles.sourceManifest, 'utf8'),
  readFile(inputFiles.snapshotEvidence, 'utf8'), readFile(inputFiles.exceptions, 'utf8'), readFile(inputFiles.sourceDump),
]);
const mapping = JSON.parse(mappingText) as ApprovedMapping & Record<string, any>;
const approval = JSON.parse(approvalText) as ApprovalBundle;
const sourceHistory = (await source.query<MigrationRecord>('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id')).rows;
const actualSourceEvidence = await captureSourceEvidence({ client: source, sourceVersion: migrationSourceVersion(), sourceDatabaseIdentity: databaseIdentity(sourceUrl), migrationHistory: sourceHistory });
assertSourceEvidence(JSON.parse(sourceManifestText) as SourceEvidence, actualSourceEvidence);
assertSourceObjectManifest(JSON.parse(objectManifestText) as SourceObjectManifest, actualSourceEvidence);
const sourceRuntime = await postgresRuntimeIdentity(source, sourceUrl);
assertSnapshotEvidence({ evidence: JSON.parse(snapshotEvidenceText) as SnapshotEvidence, sourceEvidence: actualSourceEvidence, dump: sourceDump, canonicalDatabaseIdentity: databaseIdentity(sourceUrl), canonicalRuntime: sourceRuntime });
const targetRuntime = await postgresRuntimeIdentity(target, targetUrl, {
  expectedCurrentUser: targetRole,
  expectedSessionUser: targetLoginRole,
});
const expectedTargetHistory = await migrationHistory(targetMigrationDirectory);
const readTargetHistory = async () => (await target.query<MigrationRecord>(
  'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id',
)).rows;
const actualTargetHistory = await readTargetHistory();
assertMigrationHistory(expectedTargetHistory, actualTargetHistory);
const targetMigrationHistorySha256 = sha256(Buffer.from(stableJson(actualTargetHistory)));
if (targetRuntime.currentUser !== targetRole || targetRuntime.sessionUser !== targetLoginRole)
  throw new Error('Connected target database current/session roles do not match the approved migration authority');
if (targetIdentity.environment === 'production-campuspilot-plus' && !targetRuntime.tls.active)
  throw new Error('Production migration target PostgreSQL connection must use TLS');
const fence = await verifyWriterFence(kubernetesWriterFenceConfig());
const importer = await importerProvenance();
const migrationDocsChecksum = await migrationDocsSha256();
const trackedContractChecksum = trackedMigrationContractSha256(migrationDocsChecksum);
assertApprovedRunArtifacts({
  mapping, approval, targetEnvironment: authorization.environment!, mappingSha256: sha256(Buffer.from(mappingText)),
  sourceDumpSha256: sha256(sourceDump), sourceObjectManifestSha256: sha256(Buffer.from(objectManifestText)),
  sourceManifestSha256: sha256(Buffer.from(sourceManifestText)), snapshotEvidenceSha256: sha256(Buffer.from(snapshotEvidenceText)),
  exceptionsSha256: sha256(Buffer.from(exceptionsText)), sourceMigrationHistorySha256: actualSourceEvidence.migrationHistorySha256,
  targetMigrationHistorySha256,
  sourceTableDigestsSha256: actualSourceEvidence.tableDigestsSha256, sourceVersion: migrationSourceVersion(),
  sourceDatabaseIdentity: databaseIdentity(sourceUrl), targetDatabaseIdentity: databaseIdentity(targetUrl),
  targetS3: { bucket: targetObjectStore.bucket, region: targetObjectStore.region, endpoint: targetObjectStore.endpoint ?? null, forcePathStyle: targetObjectStore.forcePathStyle },
  targetPostgresRuntimeIdentitySha256: postgresRuntimeIdentitySha256(targetRuntime), writerFenceSha256: writerFenceSha256(fence),
  importerGitCommit: importer.gitCommit, importerChecksumSha256: importer.checksumSha256,
  migrationDocsSha256: migrationDocsChecksum,
});
const temporary = await mkdtemp(path.join(tmpdir(), "campuspilot-migration-verify-"));

try {
  const tables = [
    "school", '"user"', "school_member", "school_user_role", "school_session", "class", "section",
    "admission", "student", "exam_plan", "exam_result", "exam_timetable", "exam_lifecycle",
    "exam_student_assessment", "exam_assessment_settings", "finance_bill_run", "finance_ledger_entry", "finance_bill",
    "finance_bill_line", "finance_payment", "finance_adjustment", "finance_payment_allocation",
    "finance_refund", "finance_number_counter", "finance_admission_balance", "finance_admission_session_activity", "artifact",
    "school_document_template", "account", "session", "verification", "apikey",
  ];
  const targetEntries: Array<[string, number]> = [];
  for (const table of tables) targetEntries.push([table.replaceAll('"', ""), await count(target, table)]);
  const targetCounts = Object.fromEntries(targetEntries);

  const sourceCounts = {
    schools: await count(source, "school", `WHERE id='${SCHOOL_ID}'`),
    staff: await count(source, "staff", `WHERE school_id='${SCHOOL_ID}'`),
    sessions: await count(source, "school_session", `WHERE school_id='${SCHOOL_ID}'`),
    classes: await count(source, "class", `WHERE school_id='${SCHOOL_ID}'`),
    sections: await count(source, "section", `WHERE school_id='${SCHOOL_ID}'`),
    admissions: await count(source, "admission", `WHERE school_id='${SCHOOL_ID}'`),
    students: await count(source, "student", `WHERE school_id='${SCHOOL_ID}'`),
    plans: await count(source, "exam_plan", `WHERE school_id='${SCHOOL_ID}'`),
    results: await count(source, "exam_result", `WHERE school_id='${SCHOOL_ID}'`),
    timetables: await count(source, "exam_timetable", `WHERE school_id='${SCHOOL_ID}'`),
    billRuns: await count(source, "bill_generation_event", `WHERE school_id='${SCHOOL_ID}'`),
    bills: Number((await source.query<{ count: string }>(`SELECT count(*)::text AS count FROM student_bill_event b JOIN student s ON s.id=b.student_id WHERE s.school_id=$1`, [SCHOOL_ID])).rows[0]!.count),
    ledgerEvents: await count(source, "ledger_event", `WHERE school_id='${SCHOOL_ID}'`),
    templates: await count(source, "artifact", `WHERE school_id='${SCHOOL_ID}' AND type IN ('examination_template','idcard_template','admitcard_template','timetable_template','bill_template','receipt_template')`),
    credentialAccounts: Number((await source.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM account a
      JOIN "user" u ON u.id=a.user_id
      WHERE a.provider_id='credential'
        AND EXISTS (
          SELECT 1 FROM staff s
          WHERE s.school_id=$1 AND lower(trim(s.email))=lower(trim(u.email))
        )
    `, [SCHOOL_ID])).rows[0]!.count),
  };
  const [planningStaff, planningSessions, planningClasses, planningSections, planningBillRuns, planningBills, planningLedger] = await Promise.all([
    source.query<any>('SELECT s.*,u.id AS user_id FROM staff s JOIN "user" u ON lower(trim(u.email))=lower(trim(s.email)) WHERE s.school_id=$1 ORDER BY s.id', [SCHOOL_ID]),
    source.query<any>('SELECT * FROM school_session WHERE school_id=$1 ORDER BY id', [SCHOOL_ID]),
    source.query<any>('SELECT * FROM class WHERE school_id=$1 ORDER BY id', [SCHOOL_ID]),
    source.query<any>('SELECT * FROM section WHERE school_id=$1 ORDER BY class_id,id', [SCHOOL_ID]),
    source.query<any>('SELECT * FROM bill_generation_event WHERE school_id=$1 ORDER BY id', [SCHOOL_ID]),
    source.query<any>('SELECT b.* FROM student_bill_event b JOIN student s ON s.id=b.student_id WHERE s.school_id=$1 ORDER BY b.id', [SCHOOL_ID]),
    source.query<any>('SELECT * FROM ledger_event WHERE school_id=$1 ORDER BY id', [SCHOOL_ID]),
  ]);
  const executionPlan = buildTargetMigrationPlan({ mapping, sourceVersion: migrationSourceVersion(), staff: planningStaff.rows, sessions: planningSessions.rows, classes: planningClasses.rows, sections: planningSections.rows, billRuns: planningBillRuns.rows, bills: planningBills.rows, ledger: planningLedger.rows });
  const targetRoles = (await target.query<any>('SELECT user_id,role,meta FROM school_user_role WHERE school_id=$1 ORDER BY user_id', [SCHOOL_ID])).rows;
  const expectedRoles = planningStaff.rows.map((member) => ({
    user_id: member.user_id,
    role: executionPlan.staffRoles[member.id],
    meta: member.role === 'teacher'
      ? { classIds: executionPlan.staffClassScopes[member.id] }
      : null,
  })).toSorted((a, b) => a.user_id.localeCompare(b.user_id));
  const targetClasses = (await target.query<any>('SELECT id,display_order FROM class WHERE school_id=$1 ORDER BY id', [SCHOOL_ID])).rows;
  const targetSections = (await target.query<any>('SELECT id,display_order FROM section WHERE school_id=$1 ORDER BY id', [SCHOOL_ID])).rows;
  const targetSessions = (await target.query<any>('SELECT id,is_active FROM school_session WHERE school_id=$1 ORDER BY id', [SCHOOL_ID])).rows;
  const targetBills = (await target.query<any>('SELECT id,bill_number FROM finance_bill WHERE school_id=$1 ORDER BY id', [SCHOOL_ID])).rows;
  const targetPayments = (await target.query<any>('SELECT id,receipt_number FROM finance_payment WHERE school_id=$1 ORDER BY id', [SCHOOL_ID])).rows;
  const targetAdjustments = (await target.query<any>('SELECT id FROM finance_adjustment WHERE school_id=$1 ORDER BY id', [SCHOOL_ID])).rows;
  const targetBillRuns = (await target.query<any>('SELECT id FROM finance_bill_run WHERE school_id=$1 ORDER BY id', [SCHOOL_ID])).rows;
  const targetNumberCounters = (await target.query<any>(`
    SELECT session_id,kind,fiscal_key,next_value::text
    FROM finance_number_counter WHERE school_id=$1 ORDER BY kind
  `, [SCHOOL_ID])).rows;
  const targetTemplates = (await target.query<any>(`
    SELECT id,document_type,page_size,s3_key,content_type,byte_size,sha256,created_by
    FROM artifact WHERE school_id=$1 AND kind='template' ORDER BY id
  `, [SCHOOL_ID])).rows;
  const expectedBills = planningBills.rows.map((bill) => ({
    id: executionPlan.generatedIds[`bill:${bill.id}`],
    bill_number: executionPlan.billNumbers[bill.id],
  })).toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
  const expectedPayments = planningLedger.rows
    .filter((event) => Number(event.amount) > 0)
    .map((event) => ({
      id: executionPlan.generatedIds[`payment:${event.id}`],
      receipt_number: executionPlan.receiptNumbers[event.id],
    }))
    .toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
  const expectedAdjustments = planningLedger.rows
    .filter((event) => Number(event.discount) > 0)
    .map((event) => ({ id: executionPlan.generatedIds[`adjustment:${event.id}`] }))
    .toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
  const expectedBillRuns = planningBillRuns.rows
    .map((run) => ({ id: executionPlan.generatedIds[`billRun:${run.id}`] }))
    .toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
  const expectedNumberCounters = (['bill', 'receipt', 'refund'] as const)
    .map((kind) => ({
      session_id: executionPlan.financeNumberCounters.sessionId,
      kind,
      fiscal_key: executionPlan.financeNumberCounters.fiscalKey,
      next_value: String(executionPlan.financeNumberCounters.nextValues[kind]),
    }))
    .toSorted((left, right) => left.kind.localeCompare(right.kind));
  const expectedTemplates = executionPlan.templates.map((template: any) => ({
    id: template.sourceArtifactId,
    document_type: template.documentType,
    page_size: template.pageSize,
    s3_key: template.targetKey,
    content_type: template.targetContentType,
    byte_size: template.targetByteSize,
    sha256: template.targetSha256,
    created_by: executionPlan.migrationActor,
  })).toSorted((left: any, right: any) => left.id.localeCompare(right.id));
  const executionPlanMatches = stableJson(targetRoles) === stableJson(expectedRoles) &&
    targetClasses.length === planningClasses.rows.length &&
    targetClasses.every((row) => row.display_order === executionPlan.classDisplayOrders[row.id]) &&
    targetSections.length === planningSections.rows.length &&
    targetSections.every((row) => row.display_order === executionPlan.sectionDisplayOrders[row.id]) &&
    targetSessions.length === planningSessions.rows.length &&
    targetSessions.every((row) => row.is_active === executionPlan.activeSessions[row.id]) &&
    stableJson(targetBills) === stableJson(expectedBills) &&
    stableJson(targetPayments) === stableJson(expectedPayments) &&
    stableJson(targetAdjustments) === stableJson(expectedAdjustments) &&
    stableJson(targetBillRuns) === stableJson(expectedBillRuns) &&
    stableJson(targetNumberCounters) === stableJson(expectedNumberCounters) &&
    stableJson(targetTemplates) === stableJson(expectedTemplates);

  const sourceAssessmentRows = (await source.query<any>(`
    SELECT r.id,r.session_id,r.student_id,r.days_attended,
      r."coScholastics" AS "coScholastics",r.approved,
      r."createdAt" AS "createdAt",r."updatedAt" AS "updatedAt",
      p."examSlug" AS "examSlug"
    FROM exam_result r
    JOIN exam_plan p ON p.id=r.exam_plan_id
    WHERE r.school_id=$1 AND p.school_id=$1
    ORDER BY r.id
  `, [SCHOOL_ID])).rows;
  const sourceAssessmentGroups = Map.groupBy(
    sourceAssessmentRows,
    (row) => `${row.session_id}:${row.examSlug}:${row.student_id}`,
  );
  const expectedAssessments = new Map<string, any>();
  for (const [key, group] of sourceAssessmentGroups) {
    const ordered = group.toSorted((left, right) => left.id.localeCompare(right.id));
    if (ordered.some((row) => typeof row.approved !== 'boolean'))
      throw new Error(`Source assessment ${key} has a missing subject approval boolean`);
    expectedAssessments.set(key, {
      daysAttended: selectAssessmentValue(ordered, "days_attended", key),
      coScholastics: selectAssessmentValue(ordered, "coScholastics", key),
      approved: selectAssessmentValue(ordered, "approved", key),
      updatedAt: ordered.map((row) => row.updatedAt ?? row.createdAt).toSorted().at(-1),
    });
  }
  const targetAssessmentRows = (await target.query<any>(`
    SELECT session_id,exam_slug,student_id,days_attended,co_scholastics,approved,updated_at
    FROM exam_student_assessment
    WHERE school_id=$1
    ORDER BY session_id,exam_slug,student_id
  `, [SCHOOL_ID])).rows;
  const assessmentMismatches = targetAssessmentRows.filter((row) => {
    const key = `${row.session_id}:${row.exam_slug}:${row.student_id}`;
    const expected = expectedAssessments.get(key);
    return !expected || row.days_attended !== expected.daysAttended ||
      stableJson(row.co_scholastics) !== stableJson(expected.coScholastics) ||
      row.approved !== expected.approved || row.updated_at !== expected.updatedAt;
  });
  const expectedDays = [...expectedAssessments.values()].filter((row) => row.daysAttended != null).length;
  const expectedCoScholastics = [...expectedAssessments.values()].filter((row) => row.coScholastics != null).length;

  check("Tenant isolation", targetCounts.school === 1 && (await count(target, "school", `WHERE id='${SCHOOL_ID}'`)) === 1, "Only the approved Prem Chandra school exists");
  check('Approved execution plan', executionPlanMatches, 'Roles/scopes, active session, display orders, template metadata, finance IDs, and numbering match the checksum-bound deterministic plan');
  const durableRun = await target.query<any>(
    `SELECT * FROM legacy_migration_run WHERE run_id=$1`,
    [path.basename(RUN_DIRECTORY)],
  );
  check('Durable run committed', durableRun.rows.length === 1 && durableRun.rows[0]?.status === 'committed', 'Approved run has one committed durable control record awaiting verification');
  const recorded = durableRun.rows[0];
  check('Durable provenance', recorded.mapping_sha256 === sha256(Buffer.from(mappingText)) &&
    recorded.approval_sha256 === sha256(Buffer.from(approvalText)) &&
    recorded.source_database_identity === databaseIdentity(sourceUrl) &&
    recorded.target_database_identity === targetIdentity.identity &&
    recorded.source_version === migrationSourceVersion() &&
    recorded.source_migration_history_sha256 === actualSourceEvidence.migrationHistorySha256 &&
    recorded.target_migration_history_sha256 === targetMigrationHistorySha256 &&
    recorded.source_table_digests_sha256 === actualSourceEvidence.tableDigestsSha256 &&
    recorded.importer_git_commit === importer.gitCommit &&
    recorded.importer_checksum_sha256 === importer.checksumSha256 &&
    recorded.source_manifest_sha256 === sha256(Buffer.from(sourceManifestText)) &&
    recorded.snapshot_evidence_sha256 === sha256(Buffer.from(snapshotEvidenceText)) &&
    recorded.exceptions_sha256 === sha256(Buffer.from(exceptionsText)) &&
    recorded.source_dump_sha256 === sha256(sourceDump) &&
    recorded.object_manifest_sha256 === sha256(Buffer.from(objectManifestText)) &&
    recorded.decision_set_sha256 === trackedContractChecksum &&
    recorded.target_s3_endpoint === (targetObjectStore.endpoint ?? null) &&
    recorded.target_s3_region === targetObjectStore.region &&
    recorded.target_s3_bucket === targetObjectStore.bucket &&
    recorded.target_s3_force_path_style === targetObjectStore.forcePathStyle &&
    recorded.writers_disabled === true &&
    stableJson(recorded.target_postgres_runtime_identity) === stableJson(targetRuntime) &&
    stableJson(recorded.writer_fence) === stableJson(fence), 'All reviewed files and live target identities match immutable durable provenance');
  const auditFiles = {
    writes_sha256: 'writes.ndjson',
    dispositions_sha256: 'dispositions.ndjson',
    audit_exceptions_sha256: 'exceptions.ndjson',
    target_after_sha256: 'target-after.json',
    reconciliation_sha256: 'reconciliation.json',
    run_report_sha256: 'run.json',
  } as const;
  for (const [column, filename] of Object.entries(auditFiles)) {
    const bytes = await readFile(path.join(RUN_DIRECTORY, filename));
    check(`Durable audit ${filename}`, recorded[column] === sha256(bytes),
      `${filename} matches its immutable committed checksum`);
  }
  check("Identity", targetCounts.user === sourceCounts.staff && targetCounts.school_member === sourceCounts.staff && targetCounts.school_user_role === sourceCounts.staff, `${targetCounts.user} staff users, ${targetCounts.school_member} memberships, ${targetCounts.school_user_role} roles`);
  check("Academic structure", targetCounts.school_session === sourceCounts.sessions && targetCounts.class === sourceCounts.classes && targetCounts.section === sourceCounts.sections, `${targetCounts.school_session} session, ${targetCounts.class} classes, ${targetCounts.section} sections`);
  check("Admissions", targetCounts.admission === sourceCounts.admissions && targetCounts.student === sourceCounts.students, `${targetCounts.admission} admissions and ${targetCounts.student} enrollments`);
  check("Examinations", targetCounts.exam_plan === sourceCounts.plans && targetCounts.exam_result === sourceCounts.results && targetCounts.exam_timetable === sourceCounts.timetables, `${targetCounts.exam_plan} plans, ${targetCounts.exam_result} results, ${targetCounts.exam_timetable} timetable`);
  check("Exam-wide assessment count", targetAssessmentRows.length === expectedAssessments.size, `${targetAssessmentRows.length} assessments match ${expectedAssessments.size} frozen-source groups`);
  check("Exam-wide assessment values", assessmentMismatches.length === 0, `${expectedDays} attendance values and ${expectedCoScholastics} co-scholastic grade sets match the frozen source exactly`);
  const targetAssessmentSettings = (await target.query<any>(`
    SELECT session_id,exam_slug,total_working_days
    FROM exam_assessment_settings WHERE school_id=$1
    ORDER BY session_id,exam_slug
  `, [SCHOOL_ID])).rows;
  const expectedAssessmentSettings = executionPlan.assessmentSettings
    .map((setting: any) => ({
      session_id: setting.sessionId,
      exam_slug: setting.examSlug,
      total_working_days: setting.totalWorkingDays,
    }))
    .toSorted((left: any, right: any) =>
      `${left.session_id}:${left.exam_slug}`.localeCompare(`${right.session_id}:${right.exam_slug}`));
  check('Exam working-day settings', stableJson(targetAssessmentSettings) === stableJson(expectedAssessmentSettings) &&
    expectedAssessmentSettings.every((setting: any) => setting.total_working_days === CANONICAL_DECISION_POLICY['E-03'].totalWorkingDays),
  'Every imported exam matches the checksum-bound assessment plan with totalWorkingDays=81');
  check("Finance rows", targetCounts.finance_bill_run === sourceCounts.billRuns && targetCounts.finance_bill === sourceCounts.bills, `${targetCounts.finance_bill_run} runs and ${targetCounts.finance_bill} bills`);
  check('Finance next-number counters', stableJson(targetNumberCounters) === stableJson(expectedNumberCounters),
    'The first post-migration bill, receipt, and refund numbers are 363, 154, and 1 without collision');
  check("Template rows", targetCounts.artifact === sourceCounts.templates && targetCounts.school_document_template === sourceCounts.templates, `${targetCounts.artifact} immutable active template revisions`);
  const invalidCredentialAccounts = await count(target, "account", `WHERE provider_id<>'credential' OR issuer<>'local:credential' OR account_id<>user_id OR password IS NULL OR password !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' OR access_token IS NOT NULL OR refresh_token IS NOT NULL OR id_token IS NOT NULL OR access_token_expires_at IS NOT NULL OR refresh_token_expires_at IS NOT NULL OR scope IS NOT NULL`);
  const sourceCredentials = (await source.query<any>(`
    SELECT a.id,a.account_id,a.user_id,a.password
    FROM account a JOIN "user" u ON u.id=a.user_id
    WHERE a.provider_id='credential' AND EXISTS (
      SELECT 1 FROM staff s WHERE s.school_id=$1
        AND lower(trim(s.email))=lower(trim(u.email)))
    ORDER BY a.id
  `, [SCHOOL_ID])).rows;
  const targetCredentials = (await target.query<any>(`
    SELECT id,account_id,user_id,password,provider_id,issuer,
      access_token,refresh_token,id_token,access_token_expires_at,
      refresh_token_expires_at,scope
    FROM account WHERE provider_id='credential' ORDER BY id
  `)).rows;
  const credentialExact = sourceCredentials.length === 1 && targetCredentials.length === 1 &&
    sourceCredentials[0].id === targetCredentials[0].id &&
    sourceCredentials[0].account_id === targetCredentials[0].account_id &&
    sourceCredentials[0].user_id === targetCredentials[0].user_id &&
    sourceCredentials[0].password === targetCredentials[0].password &&
    targetCredentials[0].issuer === 'local:credential' &&
    ['access_token','refresh_token','id_token','access_token_expires_at','refresh_token_expires_at','scope']
      .every((field) => targetCredentials[0][field] === null);
  check("Password credential source scope", sourceCounts.credentialAccounts === 1, "Frozen Prem Chandra source contains exactly one approved staff credential");
  check("Password credentials", targetCounts.account === sourceCounts.credentialAccounts && invalidCredentialAccounts === 0 && credentialExact, `${targetCounts.account} credential retained with exact id/account/user/password bytes, target issuer, and null token, expiry, and scope fields`);
  const sourceIdentityRows = (await source.query<any>(`
    SELECT u.id,u.email_verified,u.image FROM "user" u
    JOIN staff s ON lower(trim(s.email))=lower(trim(u.email))
    WHERE s.school_id=$1 ORDER BY u.id
  `, [SCHOOL_ID])).rows;
  const targetIdentityRows = (await target.query<any>(`
    SELECT id,email_verified,image,profile_image_s3_key FROM "user" ORDER BY id
  `)).rows;
  check('Identity trust and image policy', sourceIdentityRows.length === targetIdentityRows.length &&
    sourceIdentityRows.every((row, index) => row.id === targetIdentityRows[index]?.id &&
      row.email_verified === targetIdentityRows[index]?.email_verified &&
      targetIdentityRows[index]?.image === null && targetIdentityRows[index]?.profile_image_s3_key === null),
  'Source emailVerified is preserved exactly while provider and S3 profile images are omitted');
  const sourceSessionIds = new Set((await source.query<{ id: string }>(`SELECT id FROM session`)).rows.map((row) => row.id));
  const copiedSessionIds = (await target.query<{ id: string }>(`SELECT id FROM session`)).rows.filter((row) => sourceSessionIds.has(row.id));
  check("Ephemeral auth state omitted", copiedSessionIds.length === 0 && (targetCounts.verification ?? 0) + (targetCounts.apikey ?? 0) === 0, `${targetCounts.session} fresh local runtime session(s); no source session ID, challenge, or API key was copied`);
  check("Admission photo omission", await count(target, "admission", "WHERE photo_s3_key IS NOT NULL") === 0, "No admission photo key was migrated under tracked S-03/A-12");
  check("Generated PDFs omitted", await count(target, "artifact", "WHERE kind='pdf'") === 0, "No legacy generated PDF row was copied");
  check("Payment allocations omitted", targetCounts.finance_payment_allocation === 0 && targetCounts.finance_refund === 0, "No payment-to-bill allocation or inferred refund exists");

  const sourceFinance = (await source.query(`
    SELECT
      (SELECT (coalesce(sum(b.amount),0)*100)::bigint FROM student_bill_event b JOIN student s ON s.id=b.student_id WHERE s.school_id=$1)::text AS debits,
      (SELECT (coalesce(sum(amount),0)*100)::bigint FROM ledger_event WHERE school_id=$1)::text AS payments,
      (SELECT (coalesce(sum(discount),0)*100)::bigint FROM ledger_event WHERE school_id=$1)::text AS discounts
  `, [SCHOOL_ID])).rows[0];
  const targetFinance = (await target.query(`
    SELECT
      coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0)::text AS debits,
      coalesce(sum(amount_minor) FILTER (WHERE type='payment'),0)::text AS payments,
      coalesce(sum(amount_minor) FILTER (WHERE type='discount'),0)::text AS discounts,
      coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0)::text AS credits
    FROM finance_ledger_entry WHERE school_id=$1
  `, [SCHOOL_ID])).rows[0];
  check("Finance exact totals", sourceFinance.debits === targetFinance.debits && sourceFinance.payments === targetFinance.payments && sourceFinance.discounts === targetFinance.discounts, `debits=${targetFinance.debits}, payments=${targetFinance.payments}, discounts=${targetFinance.discounts} minor units`);

  const drift = Number((await target.query<{ count: string }>(`
    WITH expected AS (
      SELECT school_id,admission_id,currency,max(sequence) last_sequence,
        coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0) debits,
        coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0) credits
      FROM finance_ledger_entry GROUP BY school_id,admission_id,currency
    )
    SELECT count(*)::text AS count FROM expected e FULL JOIN finance_admission_balance b USING (school_id,admission_id,currency)
    WHERE e.school_id IS NULL OR b.school_id IS NULL OR e.last_sequence<>b.last_sequence OR e.debits<>b.debit_total_minor OR e.credits<>b.credit_total_minor
  `)).rows[0]!.count);
  check("Finance projections", drift === 0, "Rebuilt lifetime projections match the immutable ledger exactly");

  const relationshipErrors = Number((await target.query<{ count: string }>(`
    SELECT (
      (SELECT count(*) FROM student s JOIN admission a ON a.id=s.admission_id WHERE s.school_id<>a.school_id) +
      (SELECT count(*) FROM student s JOIN class c ON c.id=s.class_id WHERE s.school_id<>c.school_id) +
      (SELECT count(*) FROM student s JOIN section x ON x.id=s.section_id WHERE s.class_id<>x.class_id OR s.school_id<>x.school_id) +
      (SELECT count(*) FROM exam_result r JOIN exam_plan p ON p.id=r.exam_plan_id JOIN student s ON s.id=r.student_id WHERE r.school_id<>p.school_id OR r.session_id<>p.session_id OR r.school_id<>s.school_id OR r.session_id<>s.session_id)
    )::text AS count
  `)).rows[0]!.count);
  check("Cross-tenant relationships", relationshipErrors === 0, "No admission, enrollment, section, plan, or result crosses tenant/session boundaries");

  const templates = (await target.query<any>(`SELECT * FROM artifact WHERE kind='template' ORDER BY document_type`)).rows;
  const targetSchool = (
    await target.query<{ logo_s3_key: string | null }>(
      `SELECT logo_s3_key FROM school WHERE id=$1`,
      [SCHOOL_ID],
    )
  ).rows[0];
  check("School logo key", Boolean(targetSchool?.logo_s3_key), "Migrated school has a target logo object key");
  const logoKey = targetSchool!.logo_s3_key!;
  const logoResponse = await s3.send(new GetObjectCommand({ Bucket: targetObjectStore.bucket, Key: logoKey }));
  if (!logoResponse.Body) throw new Error("Migrated school logo has no object body");
  const logoBytes = Buffer.from(await logoResponse.Body.transformToByteArray());
  const expectedLogoSha256 = /\/([0-9a-f]{64})\.png$/.exec(logoKey)?.[1];
  check(
    "School logo checksum",
    Boolean(expectedLogoSha256) && sha256(logoBytes) === expectedLogoSha256,
    "Logo bytes match the content-addressed migrated key",
  );
  const pdfEvidence: Array<Record<string, unknown>> = [];
  const migratedObjectKeys = [logoKey];
  for (const template of templates) {
    migratedObjectKeys.push(template.s3_key);
    const response = await s3.send(new GetObjectCommand({ Bucket: targetObjectStore.bucket, Key: template.s3_key }));
    if (!response.Body) throw new Error(`No object body for ${template.id}`);
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    check(`Template checksum ${template.document_type}`, bytes.byteLength === template.byte_size && sha256(bytes) === template.sha256, `${template.id} object bytes match PostgreSQL`);
    const html = renderDocument(bytes.toString("utf8"), SAMPLE_DOCUMENT_CONTEXT);
    const copies = template.page_size === "half" ? [html, html, html] : [html];
    const pdf = await convertDocumentPdf(combineDocuments(copies, template.document_type, template.page_size), template.document_type);
    const pdfPath = path.join(temporary, `${template.document_type}.pdf`);
    await writeFile(pdfPath, pdf);
    const { stdout } = await execFile("pdfinfo", [pdfPath]);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
    const size = /^Page size:\s+(.+)$/m.exec(stdout)?.[1] ?? "unknown";
    const expectedPages = template.page_size === "half" ? 2 : 1;
    check(`PDF render ${template.document_type}`, pages === expectedPages, `${pages} page(s), ${size}`);
    pdfEvidence.push({ documentType: template.document_type, pageSize: template.page_size, pages, size, byteSize: pdf.byteLength });
  }

  const objectCount = new Set(migratedObjectKeys).size;
  check("Object key uniqueness", objectCount === migratedObjectKeys.length, "Every migrated object has one distinct approved key");
  check("Object inventory", objectCount === 1 + sourceCounts.templates, `${objectCount} verified migration objects in the shared bucket: one logo and ${sourceCounts.templates} templates`);

  const reconciliation = {
    schoolId: SCHOOL_ID,
    source: sourceCounts,
    target: targetCounts,
    financeTotals: targetFinance,
    projectionDrift: drift,
    objectCount,
    generatedPdfRows: 0,
    profilePhotos: 0,
    pdfEvidence,
    checks: checks.length,
    failures: checks.filter((item) => !item.passed).length,
  };
  const reconciliationPath = path.join(RUN_DIRECTORY, "verification-reconciliation.json");
  await writeFile(reconciliationPath, `${JSON.stringify(reconciliation, null, 2)}\n`, { mode: 0o600 });
  await chmod(reconciliationPath, 0o600);

  const verification = [
    "# Local migration verification",
    "",
    `- School: Prem Chandra Public School (\`${SCHOOL_ID}\`)`,
    `- Verified: ${new Date().toISOString()}`,
    `- Result: ${checks.length} checks passed, 0 failed`,
    "",
    ...checks.flatMap((item) => [`- PASS — ${item.name}: ${item.detail}`]),
    "",
    "The PDF checks used synthetic sample context. Exactly one explicitly approved compatible Prem Chandra staff password hash was retained. No production admission photo, session, verification challenge, OAuth token, API key, or generated legacy PDF was copied. Migration acceptance still requires that credential owner to complete a fresh target sign-in with the existing password.",
  ].join("\n");
  const verificationPath = path.join(RUN_DIRECTORY, "verification.md");
  await writeFile(verificationPath, `${verification}\n`, { mode: 0o600 });
  await chmod(verificationPath, 0o600);
  const verificationEvidencePath = path.join(RUN_DIRECTORY, 'verification.json');
  const verificationEvidenceBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, runId: path.basename(RUN_DIRECTORY), status: 'passed', checks }, null, 2)}\n`);
  await writeFile(verificationEvidencePath, verificationEvidenceBytes, { mode: 0o600 });
  await chmod(verificationEvidencePath, 0o600);
  const preattestationFence = await verifyWriterFence(kubernetesWriterFenceConfig());
  const preattestationHistory = await readTargetHistory();
  assertMigrationHistory(expectedTargetHistory, preattestationHistory);
  if (sha256(Buffer.from(stableJson(preattestationHistory))) !== targetMigrationHistorySha256)
    throw new Error('Target Drizzle history changed before verification attestation');
  if (writerFenceSha256(preattestationFence) !== writerFenceSha256(fence))
    throw new Error('Kubernetes writer fence changed before verification attestation');
  const attested = await target.query(`UPDATE legacy_migration_run SET verification_evidence_sha256=$2,updated_at=now() WHERE run_id=$1 AND status='committed' AND verification_evidence_sha256 IS NULL RETURNING run_id`, [path.basename(RUN_DIRECTORY), sha256(verificationEvidenceBytes)]);
  if (attested.rowCount !== 1) throw new Error('Durable migration run could not record verification evidence');
  const prefinalizationFence = await verifyWriterFence(kubernetesWriterFenceConfig());
  const prefinalizationHistory = await readTargetHistory();
  assertMigrationHistory(expectedTargetHistory, prefinalizationHistory);
  if (sha256(Buffer.from(stableJson(prefinalizationHistory))) !== targetMigrationHistorySha256)
    throw new Error('Target Drizzle history changed immediately before finalization');
  if (writerFenceSha256(prefinalizationFence) !== writerFenceSha256(fence))
    throw new Error('Kubernetes writer fence changed immediately before finalization');
  const finalized = await target.query(`UPDATE legacy_migration_run SET status='finalized',finalized_at=now(),updated_at=now() WHERE run_id=$1 AND status='committed' RETURNING run_id`, [path.basename(RUN_DIRECTORY)]);
  if (finalized.rowCount !== 1) throw new Error('Durable migration run could not transition from committed to finalized');
  console.log(JSON.stringify({ status: "verified", checks: checks.length, reconciliationPath, verificationPath }));
} finally {
  await rm(temporary, { recursive: true, force: true });
  await source.query('ROLLBACK').catch(() => undefined);
  await Promise.all([source.end(), target.end()]);
}
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runVerify();
}
