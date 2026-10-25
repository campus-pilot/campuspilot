import { createHash } from 'node:crypto';

import type pg from 'pg';

import { APPROVED_SCHOOL_ID, type MigrationRecord } from './migration-guards.ts';
import {
  SOURCE_DISPOSITION_FAMILY_KEYS,
  type SourceDispositionCounts,
  type SourceDispositionFamily,
} from './dispositions.ts';
import {
  assertExpectedLegacyCatalog,
  captureLegacyCatalog,
  legacyCatalogSha256,
  type LegacyCatalogInventory,
} from './legacy-catalog-contract.ts';

type Client = InstanceType<typeof pg.Client>;
type Row = Record<string, unknown>;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

const scopedTables = {
  school: `SELECT * FROM school WHERE id=$1 ORDER BY id`,
  school_session: `SELECT * FROM school_session WHERE school_id=$1 ORDER BY id`,
  class: `SELECT * FROM class WHERE school_id=$1 ORDER BY id`,
  section: `SELECT * FROM section WHERE school_id=$1 ORDER BY class_id,id`,
  admission: `SELECT * FROM admission WHERE school_id=$1 ORDER BY id`,
  student: `SELECT * FROM student WHERE school_id=$1 ORDER BY id`,
  staff: `SELECT * FROM staff WHERE school_id=$1 ORDER BY id`,
  user: `SELECT DISTINCT u.* FROM "user" u JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1 ORDER BY u.id`,
  account: `SELECT DISTINCT a.* FROM account a JOIN "user" u ON u.id=a.user_id JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1 ORDER BY a.provider_id,a.user_id,a.id`,
  session: `SELECT DISTINCT x.* FROM session x JOIN "user" u ON u.id=x.user_id JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1 ORDER BY x.id`,
  verification: `SELECT DISTINCT v.* FROM verification v JOIN staff s ON lower(trim(s.email))=lower(trim(v.identifier)) WHERE s.school_id=$1 ORDER BY v.id`,
  apikey: `SELECT DISTINCT k.* FROM apikey k WHERE k.reference_id IN (
    SELECT s.id FROM staff s WHERE s.school_id=$1
    UNION SELECT u.id FROM "user" u JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1
  ) ORDER BY k.id`,
  artifact: `SELECT * FROM artifact WHERE school_id=$1 ORDER BY type,id`,
  notice: `SELECT * FROM notice WHERE school_id=$1 ORDER BY session_id,id`,
  school_onboarding: `SELECT * FROM school_onboarding WHERE school_id=$1 ORDER BY id`,
  ai_usage: `SELECT * FROM ai_usage WHERE school_id=$1 ORDER BY usage_type,year,month,id`,
  ai_quota: `SELECT * FROM ai_quota WHERE school_id=$1 ORDER BY usage_type,id`,
  exam_plan: `SELECT * FROM exam_plan WHERE school_id=$1 ORDER BY session_id,"examSlug",class_id,"subjectSlug",id`,
  exam_result: `SELECT * FROM exam_result WHERE school_id=$1 ORDER BY session_id,exam_plan_id,student_id,id`,
  exam_timetable: `SELECT * FROM exam_timetable WHERE school_id=$1 ORDER BY session_id,"examSlug",id`,
  bill_generation_event: `SELECT * FROM bill_generation_event WHERE school_id=$1 ORDER BY created_at,id`,
  student_bill_event: `SELECT b.* FROM student_bill_event b JOIN student s ON s.id=b.student_id WHERE s.school_id=$1 ORDER BY b.created_at,b.id`,
  student_bill_projection: `SELECT p.* FROM student_bill_projection p JOIN student s ON s.id=p.student_id WHERE s.school_id=$1 ORDER BY p.student_id`,
  ledger_event: `SELECT * FROM ledger_event WHERE school_id=$1 ORDER BY created_at,id`,
  ledger_projection: `SELECT p.* FROM ledger_projection p JOIN student s ON s.id=p.student_id WHERE s.school_id=$1 ORDER BY p.student_id`,
} as const;

const templateTypes = [
  'examination_template',
  'idcard_template',
  'admitcard_template',
  'timetable_template',
  'bill_template',
  'receipt_template',
] as const;
const generatedPdfTypes = [
  'result_pdf',
  'bulk_result_pdf',
  'bulk_admitcard_pdf',
  'bulk_bill_pdf',
  'bulk_idcard_pdf',
  'exam_timetable_pdf',
  'bill_pdf',
  'receipt_pdf',
] as const;

export type LegacyStateEvidence = {
  defaultSessionConfigs: Array<{ schoolId: string; value: unknown }>;
  defaultSessionDiffs: Array<{
    schoolId: string;
    activeSessionId: string | null;
    defaultSessionConfig: unknown;
    activeSessionConfig: unknown;
    equal: boolean;
  }>;
  features: Array<{ schoolId: string; key: string; value: unknown }>;
  aiUsage: Array<{ usageType: string; year: number; month: number; count: number }>;
  aiQuota: Array<{ usageType: string; monthlyLimit: number }>;
  studentPortal: {
    admissionEmailLinkedNonStaffUsers: number;
    accounts: number;
    studentSessions: number;
  };
};

/** Reject unknown durable legacy feature/AI semantics before approval. */
export function assertLegacyStatePolicy(evidence: LegacyStateEvidence): void {
  if (evidence.features.some((entry) => entry.key !== 'template:ai' || typeof entry.value !== 'boolean'))
    throw new Error('Unexpected durable legacy school feature key/value');
  if (evidence.aiUsage.some((entry) => entry.usageType !== 'template:ai' || !Number.isInteger(entry.year) ||
    !Number.isInteger(entry.month) || entry.month < 1 || entry.month > 12 ||
    !Number.isInteger(entry.count) || entry.count < 0) ||
    evidence.aiQuota.some((entry) => entry.usageType !== 'template:ai' ||
      !Number.isInteger(entry.monthlyLimit) || entry.monthlyLimit < 0))
    throw new Error('Unexpected or invalid legacy AI usage/quota evidence');
}

async function captureLegacyState(client: Client): Promise<LegacyStateEvidence> {
  const defaultSessionConfigs = (await client.query<{ schoolId: string; value: unknown }>(`
    SELECT id AS "schoolId",coalesce("defaultSessionConfig",'{}'::jsonb) AS value
    FROM school WHERE id=$1 ORDER BY id
  `, [APPROVED_SCHOOL_ID])).rows;
  const defaultSessionDiffs = (await client.query<{
    schoolId: string; activeSessionId: string | null;
    defaultSessionConfig: unknown; activeSessionConfig: unknown;
  }>(`
    SELECT school.id AS "schoolId",school.active_session_id AS "activeSessionId",
      coalesce(school."defaultSessionConfig",'{}'::jsonb) AS "defaultSessionConfig",
      session."sessionConfig" AS "activeSessionConfig"
    FROM school LEFT JOIN school_session session ON session.id=school.active_session_id
    WHERE school.id=$1 ORDER BY school.id
  `, [APPROVED_SCHOOL_ID])).rows.map((row) => ({
    ...row,
    equal: stableJson(row.defaultSessionConfig) === stableJson(row.activeSessionConfig),
  }));
  const features = (await client.query<{ schoolId: string; key: string; value: unknown }>(`
    SELECT school.id AS "schoolId",feature.key,feature.value AS value
    FROM school CROSS JOIN LATERAL jsonb_each(coalesce(school.features,'{}'::jsonb)) AS feature
    WHERE school.id=$1 ORDER BY feature.key
  `, [APPROVED_SCHOOL_ID])).rows;
  const aiUsage = (await client.query<{ usageType: string; year: number; month: number; count: number }>(`
    SELECT usage_type AS "usageType",year,month,sum(count)::int AS count
    FROM ai_usage WHERE school_id=$1 GROUP BY usage_type,year,month ORDER BY usage_type,year,month
  `, [APPROVED_SCHOOL_ID])).rows.map((row) => ({ ...row, year: Number(row.year), month: Number(row.month), count: Number(row.count) }));
  const aiQuota = (await client.query<{ usageType: string; monthlyLimit: number }>(`
    SELECT usage_type AS "usageType",monthly_limit AS "monthlyLimit"
    FROM ai_quota WHERE school_id=$1 ORDER BY usage_type
  `, [APPROVED_SCHOOL_ID])).rows.map((row) => ({ ...row, monthlyLimit: Number(row.monthlyLimit) }));
  const studentPortal = (await client.query<{
    admission_email_users: number; accounts: number; student_sessions: number;
  }>(`
    WITH portal_users AS (
      SELECT DISTINCT u.id
      FROM "user" u JOIN admission a ON lower(trim(a.email))=lower(trim(u.email))
      WHERE a.school_id=$1 AND a.email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.school_id=$1 AND lower(trim(s.email))=lower(trim(u.email)))
    )
    SELECT
      (SELECT count(*)::int FROM portal_users) AS admission_email_users,
      (SELECT count(*)::int FROM account a JOIN portal_users u ON u.id=a.user_id) AS accounts,
      (SELECT count(*)::int FROM session s JOIN portal_users u ON u.id=s.user_id WHERE s.is_student) AS student_sessions
  `, [APPROVED_SCHOOL_ID])).rows[0];
  const evidence = {
    defaultSessionConfigs,
    defaultSessionDiffs,
    features,
    aiUsage,
    aiQuota,
    studentPortal: {
      admissionEmailLinkedNonStaffUsers: Number(studentPortal?.admission_email_users ?? 0),
      accounts: Number(studentPortal?.accounts ?? 0),
      studentSessions: Number(studentPortal?.student_sessions ?? 0),
    },
  };
  assertLegacyStatePolicy(evidence);
  return evidence;
}

async function captureDispositionCounts(
  client: Client,
): Promise<SourceDispositionCounts> {
  const templateSql = templateTypes.map((value) => `'${value}'`).join(',');
  const pdfSql = generatedPdfTypes.map((value) => `'${value}'`).join(',');
  const queries: Record<SourceDispositionFamily, string> = {
    'account.credential': `SELECT count(*)::int AS count FROM account a JOIN "user" u ON u.id=a.user_id JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1 AND a.provider_id='credential'`,
    'account.oauth': `SELECT count(*)::int AS count FROM account a JOIN "user" u ON u.id=a.user_id JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1 AND a.provider_id<>'credential'`,
    'admission.photo_object': `SELECT count(*)::int AS count FROM admission WHERE school_id=$1 AND photo_s3_key IS NOT NULL`,
    ai_quota: `SELECT count(*)::int AS count FROM ai_quota WHERE school_id=$1`,
    ai_usage: `SELECT count(*)::int AS count FROM ai_usage WHERE school_id=$1`,
    apikey: `SELECT count(*)::int AS count FROM apikey k WHERE k.reference_id IN (SELECT s.id FROM staff s WHERE s.school_id=$1 UNION SELECT u.id FROM "user" u JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1)`,
    'artifact.generated_pdf_object': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type IN (${pdfSql}) AND s3_key IS NOT NULL`,
    'artifact.generated_pdf_row': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type IN (${pdfSql})`,
    'artifact.notice_object': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type IN ('notice_template','notice_pdf') AND s3_key IS NOT NULL`,
    'artifact.notice_pdf_row': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type='notice_pdf'`,
    'artifact.notice_template_row': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type='notice_template'`,
    'artifact.template': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type IN (${templateSql})`,
    'artifact.template_object': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type IN (${templateSql}) AND s3_key IS NOT NULL`,
    'artifact.unknown': `SELECT count(*)::int AS count FROM artifact WHERE school_id=$1 AND type NOT IN (${templateSql},${pdfSql},'notice_template','notice_pdf')`,
    excluded_school: `SELECT count(*)::int AS count FROM school WHERE id<>$1`,
    notice: `SELECT count(*)::int AS count FROM notice WHERE school_id=$1`,
    'school.default_session_config': `SELECT count(*)::int AS count FROM school WHERE id=$1 AND coalesce("defaultSessionConfig",'{}'::jsonb)<>'{}'::jsonb`,
    'school.feature_state': `SELECT count(*)::int AS count FROM school WHERE id=$1 AND coalesce(features,'{}'::jsonb)<>'{}'::jsonb`,
    'school.onboarding_completion': `SELECT count(*)::int AS count FROM school WHERE id=$1 AND has_completed_onboarding`,
    'school.logo_object': `SELECT count(*)::int AS count FROM school WHERE id=$1 AND logo_s3_key IS NOT NULL`,
    school_onboarding: `SELECT count(*)::int AS count FROM school_onboarding WHERE school_id=$1`,
    session: `SELECT count(*)::int AS count FROM session x JOIN "user" u ON u.id=x.user_id JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1`,
    'student_portal.account': `SELECT count(DISTINCT a.id)::int AS count FROM account a JOIN "user" u ON u.id=a.user_id JOIN admission d ON lower(trim(d.email))=lower(trim(u.email)) WHERE d.school_id=$1 AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.school_id=$1 AND lower(trim(s.email))=lower(trim(u.email)))`,
    'student_portal.admission_email_user': `SELECT count(DISTINCT u.id)::int AS count FROM "user" u JOIN admission d ON lower(trim(d.email))=lower(trim(u.email)) WHERE d.school_id=$1 AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.school_id=$1 AND lower(trim(s.email))=lower(trim(u.email)))`,
    'student_portal.session_flag': `SELECT count(DISTINCT x.id)::int AS count FROM session x JOIN "user" u ON u.id=x.user_id JOIN admission d ON lower(trim(d.email))=lower(trim(u.email)) WHERE d.school_id=$1 AND x.is_student AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.school_id=$1 AND lower(trim(s.email))=lower(trim(u.email)))`,
    'user.provider_image': `SELECT count(*)::int AS count FROM "user" u JOIN staff s ON lower(trim(s.email))=lower(trim(u.email)) WHERE s.school_id=$1 AND u.image IS NOT NULL`,
    verification: `SELECT count(*)::int AS count FROM verification v JOIN staff s ON lower(trim(s.email))=lower(trim(v.identifier)) WHERE s.school_id=$1`,
  };
  const counts = {} as SourceDispositionCounts;
  for (const key of SOURCE_DISPOSITION_FAMILY_KEYS) {
    const result = await client.query<{ count: number }>(queries[key]!, [
      APPROVED_SCHOOL_ID,
    ]);
    counts[key] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

export type SourceEvidence = {
  schemaVersion: 3;
  schoolId: string;
  sourceVersion: string;
  sourceDatabaseIdentity: string;
  migrationHistory: MigrationRecord[];
  migrationHistorySha256: string;
  tables: Record<string, { count: number; sha256: string }>;
  tableDigestsSha256: string;
  dispositionCounts: SourceDispositionCounts;
  dispositionCountsSha256: string;
  catalog: LegacyCatalogInventory;
  catalogSha256: string;
  legacyState: LegacyStateEvidence;
  legacyStateSha256: string;
};

/** Capture count and deterministic content digest for every in-scope source table. */
export async function captureSourceEvidence(options: {
  client: Client;
  sourceVersion: string;
  sourceDatabaseIdentity: string;
  migrationHistory: MigrationRecord[];
  /** Synthetic unit tests may inject the tracked catalog; production callers never do. */
  catalog?: LegacyCatalogInventory;
  /** Synthetic unit tests may inject non-secret legacy-state evidence. */
  legacyState?: LegacyStateEvidence;
}): Promise<SourceEvidence> {
  const catalog = options.catalog ?? await captureLegacyCatalog(options.client);
  assertExpectedLegacyCatalog(catalog);
  const tables: Record<string, { count: number; sha256: string }> = {};
  for (const [name, sql] of Object.entries(scopedTables)) {
    const rows = (await options.client.query<Row>(sql, [APPROVED_SCHOOL_ID])).rows;
    tables[name] = { count: rows.length, sha256: sha256(stableJson(rows)) };
  }
  const migrationHistorySha256 = sha256(stableJson(options.migrationHistory));
  const dispositionCounts = await captureDispositionCounts(options.client);
  const legacyState = options.legacyState ?? await captureLegacyState(options.client);
  assertLegacyStatePolicy(legacyState);
  return {
    schemaVersion: 3,
    schoolId: APPROVED_SCHOOL_ID,
    sourceVersion: options.sourceVersion,
    sourceDatabaseIdentity: options.sourceDatabaseIdentity,
    migrationHistory: options.migrationHistory,
    migrationHistorySha256,
    tables,
    tableDigestsSha256: sha256(stableJson(tables)),
    dispositionCounts,
    dispositionCountsSha256: sha256(stableJson(dispositionCounts)),
    catalog,
    catalogSha256: legacyCatalogSha256(catalog),
    legacyState,
    legacyStateSha256: sha256(stableJson(legacyState)),
  };
}

export function assertSourceEvidence(
  approved: SourceEvidence,
  actual: SourceEvidence,
) {
  if (stableJson(approved) !== stableJson(actual))
    throw new Error('Connected restored source does not match the approved source manifest');
}
