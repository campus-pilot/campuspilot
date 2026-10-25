import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import pg from 'pg';
import {
  classConfigSchema,
  coScholasticGradesSchema,
  financeClassOverridesSchema,
  financeSchemaConfigSchema,
  modeConfigSchema,
  resultMarksSchema,
  sessionConfigSchema,
  studentFinanceValuesSchema,
  timetableConfigSchema,
} from '@campuspilot/db/schema/jsonb/index';
import {
  legacyDeploymentImage,
  legacyMigrationDirectory,
  migrationSourceVersion,
  requiredFile,
  runDirectory,
  sourceDatabaseUrl,
  sourceAuthorization,
} from './config.ts';
import { migrationHistory } from './migration-history.ts';
import {
  assertAllowedSourceSnapshot,
  databaseIdentity,
  assertMigrationHistory,
} from './migration-guards.ts';
import {
  APPROVED_CREDENTIAL_COUNT,
  APPROVED_SCHOOL_ID,
} from "./migration-guards.ts";
import {
  CANONICAL_DECISIONS,
  CANONICAL_DECISION_POLICY,
} from './canonical-decisions.ts';
import { captureSourceEvidence } from './source-evidence.ts';
import { blockingDispositionIssues, buildSourceDispositions } from './dispositions.ts';
import { validateSourceRows } from './source-validation.ts';
import { canonicalBlockingIssues } from './exception-contract.ts';
import { proposeExecutionPlan } from './target-plan.ts';
import { assertSourceObjectManifest, type SourceObjectManifest } from './source-object-manifest.ts';
import { buildSharedObjectContracts } from './object-contract.ts';

const { Client, types } = pg;
types.setTypeParser(1114, (value: string) => value);
const sourceDatabase = sourceDatabaseUrl();
const sourceAccess = sourceAuthorization();
assertAllowedSourceSnapshot({
  connectionString: sourceDatabase,
  environment: sourceAccess.environment,
  allowedDatabaseIdentities: sourceAccess.allowedDatabaseIdentities,
});
const run = runDirectory();
const sourceObjectManifestFile = requiredFile(
  'MIGRATION_SOURCE_OBJECT_MANIFEST_FILE',
);
const sourceDumpFile = requiredFile('MIGRATION_SOURCE_DUMP_FILE');

type Exception = {
  code: string;
  domain: string;
  sourceKey: string;
  severity: "blocking" | "warning";
  message: string;
};

type Row = Record<string, unknown>;
const exceptions: Exception[] = [];
const client = new Client({ connectionString: sourceDatabase });
await client.connect();
await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const sourceReadOnly = await client.query<{ transaction_read_only: string }>(
  'SHOW transaction_read_only',
);
if (sourceReadOnly.rows[0]?.transaction_read_only !== 'on')
  throw new Error('Legacy snapshot transaction is not read-only');
const actualSourceMigrationHistory = await rows<{
  hash: string;
  created_at: string;
}>(`
  SELECT hash,created_at
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at,id
`);
assertMigrationHistory(
  await migrationHistory(legacyMigrationDirectory()),
  actualSourceMigrationHistory,
);

async function rows<T extends Row>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(sql, values)).rows;
}

function issue(
  code: string,
  domain: string,
  sourceKey: string,
  message: string,
  severity: Exception["severity"] = "blocking",
) {
  exceptions.push({ code, domain, sourceKey, severity, message });
}

function validate(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { message: string } } },
  value: unknown,
  code: string,
  domain: string,
  sourceKey: string,
) {
  const result = schema.safeParse(value);
  if (!result.success) issue(code, domain, sourceKey, result.error?.message ?? "Validation failed");
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

/** Convert an exact legacy major-unit value to INR minor units without rounding. */
function toMinor(value: unknown, sourceKey: string) {
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    issue("F_INVALID_AMOUNT", "finance", sourceKey, `Invalid decimal amount: ${text}`);
    return 0;
  }
  const [whole = '', fraction = ""] = text.split(".");
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    issue("F_SUB_MINOR_AMOUNT", "finance", sourceKey, `INR amount has sub-paise precision: ${text}`);
    return 0;
  }
  const minor = BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2)) * (whole.startsWith("-") ? -1n : 1n);
  if (minor < 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    issue("F_AMOUNT_RANGE", "finance", sourceKey, `INR minor amount is outside the supported range: ${text}`);
    return 0;
  }
  return Number(minor);
}

const schools = await rows<any>(`SELECT * FROM school WHERE id=$1 ORDER BY id`, [APPROVED_SCHOOL_ID]);
const sessions = await rows<any>(`SELECT * FROM school_session WHERE school_id=$1 ORDER BY id`, [APPROVED_SCHOOL_ID]);
const classes = await rows<any>(`SELECT * FROM class WHERE school_id=$1 ORDER BY id`, [APPROVED_SCHOOL_ID]);
const sections = await rows<any>(`SELECT * FROM section WHERE school_id=$1 ORDER BY class_id,id`, [APPROVED_SCHOOL_ID]);
const admissions = await rows<any>(`SELECT * FROM admission WHERE school_id=$1 ORDER BY id`, [APPROVED_SCHOOL_ID]);
const students = await rows<any>(`SELECT * FROM student WHERE school_id=$1 ORDER BY id`, [APPROVED_SCHOOL_ID]);
const users = await rows<any>(`
  SELECT DISTINCT u.*
  FROM "user" u
  JOIN staff s ON lower(trim(s.email))=lower(trim(u.email))
  WHERE s.school_id=$1
  ORDER BY u.id
`, [APPROVED_SCHOOL_ID]);
const staff = await rows<any>(`SELECT * FROM staff WHERE school_id=$1 ORDER BY id`, [APPROVED_SCHOOL_ID]);
const accounts = await rows<any>(`
  SELECT DISTINCT a.*
  FROM account a
  JOIN "user" u ON u.id=a.user_id
  JOIN staff s ON lower(trim(s.email))=lower(trim(u.email))
  WHERE s.school_id=$1
  ORDER BY a.provider_id,a.user_id,a.id
`, [APPROVED_SCHOOL_ID]);
const plans = await rows<any>(`SELECT * FROM exam_plan WHERE school_id=$1 ORDER BY session_id,"examSlug",id`, [APPROVED_SCHOOL_ID]);
const results = await rows<any>(`SELECT * FROM exam_result WHERE school_id=$1 ORDER BY session_id,exam_plan_id,id`, [APPROVED_SCHOOL_ID]);
const timetables = await rows<any>(`SELECT * FROM exam_timetable WHERE school_id=$1 ORDER BY session_id,"examSlug",id`, [APPROVED_SCHOOL_ID]);
const billRuns = await rows<any>(`SELECT * FROM bill_generation_event WHERE school_id=$1 ORDER BY created_at,id`, [APPROVED_SCHOOL_ID]);
const bills = await rows<any>(`
  SELECT b.*
  FROM student_bill_event b
  JOIN student s ON s.id=b.student_id
  WHERE s.school_id=$1
  ORDER BY b.created_at,b.id
`, [APPROVED_SCHOOL_ID]);
const billProjections = await rows<any>(`SELECT p.* FROM student_bill_projection p JOIN student s ON s.id=p.student_id WHERE s.school_id=$1 ORDER BY p.student_id`, [APPROVED_SCHOOL_ID]);
const ledger = await rows<any>(`SELECT * FROM ledger_event WHERE school_id=$1 ORDER BY created_at,id`, [APPROVED_SCHOOL_ID]);
const ledgerProjections = await rows<any>(`SELECT p.* FROM ledger_projection p JOIN student s ON s.id=p.student_id WHERE s.school_id=$1 ORDER BY p.student_id`, [APPROVED_SCHOOL_ID]);
const artifacts = await rows<any>(`SELECT * FROM artifact WHERE school_id=$1 AND type IN ('examination_template','idcard_template','admitcard_template','timetable_template','bill_template','receipt_template') ORDER BY type,id`, [APPROVED_SCHOOL_ID]);
if (schools.length !== 1 || sessions.length !== 1)
  throw new Error('Restored snapshot must contain exactly the approved Prem Chandra school and one scoped session');

for (const session of sessions) {
  validate(sessionConfigSchema, session.sessionConfig ?? {}, "A_SESSION_CONFIG", "academic", session.id);
  if (Number(session.sessionEndYear) <= Number(session.sessionStartYear)) {
    issue("A_SESSION_YEAR_ORDER", "academic", session.id, "Session end year must be after start year");
  }
}
for (const row of classes) validate(classConfigSchema, row.config ?? {}, "A_CLASS_CONFIG", "academic", row.id);

const schoolById = new Map(schools.map((row) => [row.id, row]));
const sessionById = new Map(sessions.map((row) => [row.id, row]));
const classById = new Map(classes.map((row) => [row.id, row]));
const sectionById = new Map(sections.map((row) => [row.id, row]));
const admissionById = new Map(admissions.map((row) => [row.id, row]));
const studentById = new Map(students.map((row) => [row.id, row]));
const planById = new Map(plans.map((row) => [row.id, row]));
const userByEmail = new Map(users.map((row) => [String(row.email).trim().toLowerCase(), row]));

for (const school of schools) {
  const matching = sessions.filter((row) => row.school_id === school.id);
  if (!matching.some((row) => row.id === school.active_session_id)) {
    issue("A_ACTIVE_SESSION", "academic", school.id, "Active session does not resolve within the school");
  }
  if (matching.length !== 1) {
    issue("F_SESSION_CARDINALITY", "finance", school.id, `Expected one session for finance mapping; found ${matching.length}`);
  }
}

for (const section of sections) {
  const parent = classById.get(section.class_id);
  if (!parent || parent.school_id !== section.school_id) {
    issue("A_SECTION_TENANT", "academic", section.id, "Section parent class/school relationship is invalid");
  }
}

const normalizedAdmissions = new Map<string, string>();
for (const admission of admissions) {
  const naturalKey = `${admission.school_id}:${String(admission.admissionNo).trim().toLowerCase()}`;
  if (normalizedAdmissions.has(naturalKey)) {
    issue("A_ADMISSION_NUMBER_COLLISION", "admission", admission.id, `Normalized admission number collides with ${normalizedAdmissions.get(naturalKey)}`);
  }
  normalizedAdmissions.set(naturalKey, admission.id);
  for (const field of ["name", "admissionNo", "address", "phoneNo", "fatherName", "motherName"] as const) {
    if (!String(admission[field] ?? "").trim()) issue("A_REQUIRED_FIELD", "admission", admission.id, `${field} is blank`);
  }
}

const enrollmentKeys = new Map<string, string>();
const rollKeys = new Map<string, string>();
for (const student of students) {
  const admission = admissionById.get(student.admission_id);
  const session = sessionById.get(student.session_id);
  const klass = classById.get(student.class_id);
  const section = sectionById.get(student.section_id);
  if (!admission || !session || !klass || !section || admission.school_id !== student.school_id || session.school_id !== student.school_id || klass.school_id !== student.school_id || section.school_id !== student.school_id || section.class_id !== student.class_id) {
    issue("A_ENROLLMENT_RELATIONSHIP", "admission", student.id, "Enrollment has an orphan or cross-tenant relationship");
  }
  const enrollmentKey = `${student.admission_id}:${student.session_id}`;
  if (enrollmentKeys.has(enrollmentKey)) issue("A_ENROLLMENT_DUPLICATE", "admission", student.id, `Enrollment duplicates ${enrollmentKeys.get(enrollmentKey)}`);
  enrollmentKeys.set(enrollmentKey, student.id);
  if (student.rollNo != null) {
    const rollKey = `${student.session_id}:${student.class_id}:${student.section_id}:${student.rollNo}`;
    if (rollKeys.has(rollKey)) issue("A_ROLL_DUPLICATE", "admission", student.id, `Roll number duplicates ${rollKeys.get(rollKey)}`);
    rollKeys.set(rollKey, student.id);
  }
}

const normalizedStaff = new Map<string, string>();
for (const member of staff) {
  const email = String(member.email).trim().toLowerCase();
  const key = `${member.school_id}:${email}`;
  if (normalizedStaff.has(key)) issue("I_DUPLICATE_STAFF", "identity", member.id, `Staff identity duplicates ${normalizedStaff.get(key)}`);
  normalizedStaff.set(key, member.id);
  const sourceUser = userByEmail.get(email);
  if (!sourceUser) issue("I_STAFF_USER_MISSING", "identity", member.id, "Staff email has no source user");
  if (!["admin", "manager", "teacher", "accountant", "exam_coordinator"].includes(member.role)) issue("I_UNKNOWN_ROLE", "identity", member.id, `Unknown role ${member.role}`);
  if (member.role === "teacher") {
    const attributes = member.attributes ?? {};
    if (typeof attributes !== "object" || Array.isArray(attributes)) {
      issue("I_TEACHER_SCOPE_SHAPE", "identity", member.id, "Teacher attributes are not an object");
    } else {
      for (const [classId, sectionIds] of Object.entries(attributes)) {
        const klass = classById.get(classId);
        if (!klass || klass.school_id !== member.school_id || !Array.isArray(sectionIds) || sectionIds.some((sectionId) => sectionById.get(String(sectionId))?.class_id !== classId)) {
          issue("I_TEACHER_SCOPE_REFERENCE", "identity", member.id, `Teacher scope is invalid for class ${classId}`);
        }
      }
    }
  }
}

const approvedCredentialUserIds = new Set(
  staff
    .filter((member) => member.school_id === APPROVED_SCHOOL_ID)
    .map((member) => userByEmail.get(String(member.email).trim().toLowerCase())?.id)
    .filter((userId): userId is string => Boolean(userId)),
);
const approvedCredentials = accounts.filter(
  (account) =>
    account.provider_id === "credential" &&
    approvedCredentialUserIds.has(account.user_id),
);
if (approvedCredentials.length !== APPROVED_CREDENTIAL_COUNT) {
  issue(
    "I_CREDENTIAL_SCOPE",
    "identity",
    APPROVED_SCHOOL_ID,
    `Approved Prem Chandra scope requires exactly ${APPROVED_CREDENTIAL_COUNT} credential account; found ${approvedCredentials.length}`,
  );
}
const credentialUsers = new Set<string>();
for (const account of approvedCredentials) {
  if (account.account_id !== account.user_id)
    issue("I_CREDENTIAL_ACCOUNT_ID", "identity", account.id, "Staff credential accountId does not equal userId");
  if (credentialUsers.has(account.user_id))
    issue("I_CREDENTIAL_DUPLICATE", "identity", account.id, "Staff user has multiple credential accounts");
  if (typeof account.password !== "string" || !/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(account.password))
    issue("I_CREDENTIAL_HASH", "identity", account.id, "Staff credential hash is incompatible with the approved Better Auth Scrypt format");
  credentialUsers.add(account.user_id);
}

for (const plan of plans) {
  validate(modeConfigSchema, plan.modeConfig, "E_MODE_CONFIG", "examination", plan.id);
  const session = sessionById.get(plan.session_id);
  const klass = classById.get(plan.class_id);
  if (!session || !klass || session.school_id !== plan.school_id || klass.school_id !== plan.school_id) issue("E_PLAN_RELATIONSHIP", "examination", plan.id, "Exam plan has an orphan or cross-tenant relationship");
  const exams = session?.sessionConfig?.examConfig ?? {};
  if (!(plan.examSlug in exams)) issue("E_EXAM_DEFINITION", "examination", plan.id, `Exam slug ${plan.examSlug} is not defined by its session`);
  const subject = klass?.config?.subjects?.[plan.subjectSlug];
  if (!subject) issue("E_SUBJECT_REFERENCE", "examination", plan.id, `Subject ${plan.subjectSlug} is not defined by its class`);
}

for (const result of results) {
  validate(resultMarksSchema, result.marks, "E_RESULT_MARKS", "examination", result.id);
  if (result.coScholastics != null) validate(coScholasticGradesSchema, result.coScholastics, "E_RESULT_CO_SCHOLASTIC", "examination", result.id);
  const plan = planById.get(result.exam_plan_id);
  const student = studentById.get(result.student_id);
  if (!plan || !student || plan.school_id !== result.school_id || plan.session_id !== result.session_id || student.school_id !== result.school_id || student.session_id !== result.session_id) issue("E_RESULT_RELATIONSHIP", "examination", result.id, "Result has an orphan or cross-session/cross-tenant relationship");
  for (const [mode, mark] of Object.entries(result.marks ?? {})) {
    const maximum = plan?.modeConfig?.[mode]?.maxMarks;
    if (maximum == null || typeof mark !== "number" || mark > maximum) issue("E_RESULT_RANGE", "examination", result.id, `Mark ${mode}=${String(mark)} exceeds or lacks plan maximum ${String(maximum)}`);
  }
}
for (const timetable of timetables) validate(timetableConfigSchema, timetable.config, "E_TIMETABLE_CONFIG", "examination", timetable.id);

const assessmentGroups = new Map<string, any[]>();
for (const result of results) {
  const plan = planById.get(result.exam_plan_id);
  if (!plan) continue;
  const key = `${result.session_id}:${plan.examSlug}:${result.student_id}`;
  assessmentGroups.set(key, [...(assessmentGroups.get(key) ?? []), result]);
}
let assessmentConflicts = 0;
let assessmentGroupsWithDays = 0;
let assessmentGroupsWithCoScholastics = 0;
for (const [key, group] of assessmentGroups) {
  if (group.some((row) => row.days_attended != null)) assessmentGroupsWithDays += 1;
  if (group.some((row) => row.coScholastics != null)) assessmentGroupsWithCoScholastics += 1;
  for (const field of ["days_attended", "coScholastics", "approved"] as const) {
    const values = new Set(group.filter((row) => row[field] != null).map((row) => stableJson(row[field])));
    if (values.size > 1) {
      assessmentConflicts += 1;
      issue("E_ASSESSMENT_CONFLICT", "examination", key, `${field} differs between subject results`);
    }
  }
}

const transformedFinance = new Map<string, unknown>();
for (const school of schools) {
  const session = sessions.find((row) => row.school_id === school.id);
  if (!session) continue;
  const source = school.finance_schema ?? { recurring: "monthly", currency: "INR", elements: {} };
  if (source.currency !== "INR") issue("F_CURRENCY", "finance", school.id, `Expected INR; found ${String(source.currency)}`);
  const elements = Object.fromEntries(Object.entries(source.elements ?? {}).map(([slug, value]: [string, any]) => [slug, {
    name: value.name,
    scopes: value.scopes,
    requiredAtLevel: value.requiredAtLevel,
    ...(value.defaultValue == null ? {} : { defaultAmountMinor: toMinor(value.defaultValue, `${school.id}:element:${slug}`) }),
  }]));
  const financeConfig = { recurring: source.recurring, currency: "INR", timeZone: CANONICAL_DECISION_POLICY['G-05'].sourceTimeZone, cycleStartMonth: 4, elements };
  validate(financeSchemaConfigSchema, financeConfig, "F_SCHEMA", "finance", school.id);
  const classOverrides = Object.fromEntries(classes.filter((row) => row.school_id === school.id && row.finance_config).map((row) => [row.slug, Object.fromEntries(Object.entries(row.finance_config).map(([slug, value]) => [slug, toMinor(value, `${row.id}:${slug}`)]))]));
  validate(financeClassOverridesSchema, classOverrides, "F_CLASS_OVERRIDES", "finance", school.id);
  transformedFinance.set(session.id, { financeConfig, classOverrides });
}

for (const admission of admissions) {
  const enrollments = students.filter((row) => row.admission_id === admission.id && row.finance_config);
  const values = Object.fromEntries(enrollments.map((row) => [row.session_id, Object.fromEntries(Object.entries(row.finance_config).map(([slug, value]) => [slug, toMinor(value, `${row.id}:${slug}`)]))]));
  validate(studentFinanceValuesSchema, values, "F_ADMISSION_VALUES", "finance", admission.id);
}

for (const bill of bills) {
  const itemTotal = Object.entries(bill.line_items ?? {}).reduce((sum, [slug, item]: [string, any]) => sum + toMinor(item.amount, `${bill.id}:${slug}`), 0);
  const amount = toMinor(bill.amount, bill.id);
  if (itemTotal !== amount) issue("F_BILL_TOTAL", "finance", bill.id, `Line total ${itemTotal} does not match bill ${amount}`);
  if (bill.line_items?.custom && !String(bill.line_items.custom.name ?? "").trim()) issue("F_CUSTOM_TITLE", "finance", bill.id, "Custom bill line has no title");
}
for (const event of ledger) {
  toMinor(event.amount, `${event.id}:amount`);
  toMinor(event.discount, `${event.id}:discount`);
  if (Number(event.amount) === 0 && Number(event.discount) === 0) issue("F_ZERO_PAYMENT", "finance", event.id, "Payment event has neither cash nor discount", "warning");
}

/** Apply the stable class order fixed by tracked decision A-04. */
function classRank(slug: string) {
  const normalized = slug.toLowerCase();
  if (normalized === "nursery") return 1;
  if (normalized === "lkg") return 2;
  if (normalized === "ukg") return 3;
  if (/^\d+$/.test(normalized)) return 3 + Number(normalized);
  return 10_000;
}
const classOrder = schools.flatMap((school) =>
  classes
    .filter((row) => row.school_id === school.id)
    .toSorted((a, b) => classRank(a.slug) - classRank(b.slug) || String(a.slug).localeCompare(String(b.slug)) || String(a.id).localeCompare(String(b.id)))
    .map((row, index) => ({ schoolId: school.id, classId: row.id, slug: row.slug, label: row.label, displayOrder: index + 1 })),
);
const sectionOrder = classes.flatMap((klass) =>
  sections
    .filter((row) => row.class_id === klass.id)
    .toSorted((a, b) => String(a.slug).localeCompare(String(b.slug)) || String(a.id).localeCompare(String(b.id)))
    .map((row, index) => ({ classId: klass.id, sectionId: row.id, slug: row.slug, label: row.label, displayOrder: index + 1 })),
);

const objectManifestText = await readFile(sourceObjectManifestFile, 'utf8');
const objectManifest = JSON.parse(objectManifestText) as SourceObjectManifest;
const structuralValidation = validateSourceRows({
  schools, sessions, classes, sections, admissions, students, staff, users,
  plans, results, timetables, billRuns, bills, ledger, billProjections, ledgerProjections,
});
for (const entry of structuralValidation.issues) {
  if (!exceptions.some((existing) => existing.code === entry.code && existing.sourceKey === entry.sourceKey))
    exceptions.push(entry);
}
const sourceManifest = await captureSourceEvidence({
  client,
  sourceVersion: migrationSourceVersion(),
  sourceDatabaseIdentity: databaseIdentity(sourceDatabase),
  migrationHistory: actualSourceMigrationHistory,
});
assertSourceObjectManifest(objectManifest, sourceManifest);
for (const entry of blockingDispositionIssues(buildSourceDispositions(sourceManifest))) {
  if (!structuralValidation.issues.some((existing) =>
    existing.code === entry.code && existing.sourceKey === entry.sourceKey))
    structuralValidation.issues.push(entry);
}

const mapping: Record<string, any> = {
  schemaVersion: 1,
  status: "approved",
  schools: schools
    .filter((row) => row.id === APPROVED_SCHOOL_ID)
    .map((row) => ({ sourceId: row.id, targetId: row.id })),
  sessions: sessions
    .filter((row) => row.school_id === APPROVED_SCHOOL_ID)
    .map((row) => ({ sourceId: row.id, targetId: row.id, isActive: schoolById.get(row.school_id)?.active_session_id === row.id })),
  classes: classOrder
    .filter((row) => row.schoolId === APPROVED_SCHOOL_ID)
    .map((row) => ({ sourceId: row.classId, targetId: row.classId, displayOrder: row.displayOrder })),
  sections: sectionOrder
    .filter((row) => classById.get(row.classId)?.school_id === APPROVED_SCHOOL_ID)
    .map((row) => ({ sourceId: row.sectionId, targetId: row.sectionId, displayOrder: row.displayOrder })),
  roles: { admin: "principal", manager: "manager", teacher: "teacher", accountant: "accountant", exam_coordinator: "exam_coordinator" },
  migrationActor: `migration:${migrationSourceVersion()}`,
  sourceInputs: {
    deploymentImage: legacyDeploymentImage(),
    dumpSha256: createHash('sha256').update(await readFile(sourceDumpFile)).digest('hex'),
    objectManifestSha256: createHash('sha256').update(objectManifestText).digest('hex'),
  },
  totalWorkingDaysAgreement: structuralValidation.workingDays,
  assessmentSettings: [...new Set(plans.map((plan) => `${plan.session_id}:${plan.examSlug}`))]
    .toSorted()
    .map((key) => ({
      sessionId: key.split(':')[0], examSlug: key.split(':')[1],
      totalWorkingDays: CANONICAL_DECISION_POLICY['E-03'].totalWorkingDays,
    })),
  financeProjectionReport: structuralValidation.projectionReport,
  financeRebuilds: structuralValidation.rebuildExceptions,
  ...buildSharedObjectContracts({
    schoolId: APPROVED_SCHOOL_ID,
    artifacts: artifacts as Array<any>,
    objects: objectManifest.objects,
  }),
  decisionsRequired: [...CANONICAL_DECISIONS],
  decisionPolicy: CANONICAL_DECISION_POLICY,
};
mapping.executionPlan = proposeExecutionPlan({
  mapping, sourceVersion: migrationSourceVersion(), staff, sessions, classes,
  sections, billRuns, bills, ledger,
});

const files: Array<[string, unknown]> = [
  ["source-manifest.json", sourceManifest],
  ["mapping.json", mapping],
  ["exceptions.json", {
    schemaVersion: 2,
    blocking: canonicalBlockingIssues(structuralValidation.issues),
    rebuilds: structuralValidation.rebuildExceptions,
    warnings: exceptions.filter((entry) => entry.severity === 'warning'),
  }],
];
for (const [name, value] of files) {
  const file = path.join(run, name);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}
await client.query('ROLLBACK');
await client.end();

const canonicalBlocking = canonicalBlockingIssues(structuralValidation.issues);
const canonicalWarnings = exceptions.filter((entry) => entry.severity === 'warning');
console.log(JSON.stringify({
  tableDigests: sourceManifest.tables,
  sourceCatalogSha256: sourceManifest.catalogSha256,
  legacyStateSha256: sourceManifest.legacyStateSha256,
  exceptions: {
    blocking: canonicalBlocking.length,
    warnings: canonicalWarnings.length,
    rebuilds: structuralValidation.rebuildExceptions.length,
  },
  dispositions: buildSourceDispositions(sourceManifest).reduce((totals, entry) => ({
    source: totals.source + entry.sourceCount,
    imported: totals.imported + entry.imported,
    omitted: totals.omitted + entry.intentionallyOmitted,
    deferred: totals.deferred + entry.deferred,
    blocked: totals.blocked + entry.blocked,
  }), { source: 0, imported: 0, omitted: 0, deferred: 0, blocked: 0 }),
  assessmentConflicts,
  runDirectory: run,
}));
