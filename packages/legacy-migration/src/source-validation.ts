import { analyzeAssessments } from './assessment-rules.ts';
import { CANONICAL_DECISION_POLICY } from './canonical-decisions.ts';
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

type Row = Record<string, any>;
export type SourceValidationIssue = {
  code: string;
  domain: string;
  sourceKey: string;
  severity: 'blocking' | 'warning';
  message: string;
};

export type SourceRebuildException = {
  code:
    | 'F_PROJECTION_REBUILD'
    | 'F_BILL_RUN_HEADER_REBUILD'
    | 'F_STANDALONE_MANUAL_FALLBACK';
  domain: 'finance';
  sourceKey: string;
  disposition:
    | 'rebuild-from-events'
    | 'rebuild-from-member-bills'
    | 'use-approved-migration-actor';
  evidence: Record<string, unknown>;
};

function minor(value: unknown) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) throw new Error(`invalid decimal ${String(value)}`);
  const fraction = match[3] ?? '';
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2)))
    throw new Error(`sub-minor decimal ${String(value)}`);
  return (BigInt(match[2]!) * 100n + BigInt(`${fraction}00`.slice(0, 2))) * (match[1] ? -1n : 1n);
}

/**
 * Shared pre-commit structural gates used by both dry-run and import. These
 * facts cannot be waived by an approval exception.
 */
export function validateSourceRows(input: {
  schools: Row[]; sessions: Row[]; classes: Row[]; sections: Row[];
  admissions: Row[]; students: Row[]; staff: Row[]; users?: Row[]; plans: Row[];
  results: Row[]; timetables: Row[]; billRuns: Row[]; bills: Row[]; ledger: Row[];
  billProjections?: Row[]; ledgerProjections?: Row[];
}) {
  const issues: SourceValidationIssue[] = [];
  const rebuildExceptions: SourceRebuildException[] = [];
  const issue = (code: string, domain: string, sourceKey: unknown, message: string) =>
    issues.push({ code, domain, sourceKey: String(sourceKey), severity: 'blocking', message });
  const validate = (
    schema: { safeParse(value: unknown): { success: boolean; error?: { message: string } } },
    value: unknown, code: string, domain: string, key: unknown,
  ) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) issue(code, domain, key, parsed.error?.message ?? 'Invalid JSON contract');
  };
  if (input.schools.length !== 1 || input.sessions.length !== 1)
    issue('G_SCOPE_CARDINALITY', 'general', 'school', 'Scope must contain exactly one school and one session');
  const sessions = new Map(input.sessions.map((row) => [row.id, row]));
  const classes = new Map(input.classes.map((row) => [row.id, row]));
  const sections = new Map(input.sections.map((row) => [row.id, row]));
  const admissions = new Map(input.admissions.map((row) => [row.id, row]));
  const students = new Map(input.students.map((row) => [row.id, row]));
  const plans = new Map(input.plans.map((row) => [row.id, row]));
  const staffIds = new Set(input.staff.map((row) => row.id));
  const billRunIds = new Set(input.billRuns.map((row) => row.id));

  const userByEmail = new Map<string, Row>();
  for (const user of input.users ?? []) {
    const email = String(user.email ?? '').trim().toLowerCase();
    if (userByEmail.has(email)) issue('I_USER_EMAIL_COLLISION', 'identity', user.id, 'Normalized user email collides');
    userByEmail.set(email, user);
  }
  const staffEmails = new Set<string>();
  for (const member of input.staff) {
    const email = String(member.email ?? '').trim().toLowerCase();
    if (!email || staffEmails.has(email)) issue('I_DUPLICATE_STAFF', 'identity', member.id, 'Blank or duplicate normalized staff email');
    staffEmails.add(email);
    if (input.users && !userByEmail.has(email)) issue('I_STAFF_USER_MISSING', 'identity', member.id, 'Staff email has no source user');
    if (!['admin', 'manager', 'teacher', 'accountant', 'exam_coordinator'].includes(String(member.role)))
      issue('I_UNKNOWN_ROLE', 'identity', member.id, `Unknown role ${String(member.role)}`);
    if (member.role === 'teacher') {
      if (!member.attributes || typeof member.attributes !== 'object' || Array.isArray(member.attributes)) {
        issue('I_TEACHER_SCOPE_SHAPE', 'identity', member.id, 'Teacher attributes must be an object');
      } else for (const [classId, sectionIds] of Object.entries(member.attributes)) {
        const klass = classes.get(classId);
        if (!klass || klass.school_id !== member.school_id || !Array.isArray(sectionIds) || sectionIds.some((sectionId) => sections.get(String(sectionId))?.class_id !== classId))
          issue('I_TEACHER_SCOPE_REFERENCE', 'identity', member.id, `Invalid teacher scope for class ${classId}`);
      }
    }
  }

  for (const row of input.sessions) {
    validate(sessionConfigSchema, row.sessionConfig ?? {}, 'A_SESSION_CONFIG', 'academic', row.id);
    if (Number(row.sessionEndYear) <= Number(row.sessionStartYear))
      issue('A_SESSION_YEAR_ORDER', 'academic', row.id, 'Session end year must be after start year');
  }
  for (const school of input.schools) {
    const active = sessions.get(school.active_session_id);
    if (!active || active.school_id !== school.id)
      issue('A_ACTIVE_SESSION', 'academic', school.id, 'Active session does not resolve inside the school');
  }
  for (const row of input.classes)
    validate(classConfigSchema, row.config ?? {}, 'A_CLASS_CONFIG', 'academic', row.id);
  for (const row of input.sections) {
    const parent = classes.get(row.class_id);
    if (!parent || parent.school_id !== row.school_id)
      issue('A_SECTION_TENANT', 'academic', row.id, 'Section parent class/school is invalid');
  }

  const admissionNumbers = new Set<string>();
  for (const row of input.admissions) {
    for (const field of ['name', 'admissionNo', 'address', 'phoneNo', 'fatherName', 'motherName']) {
      if (!String(row[field] ?? '').trim()) issue('A_REQUIRED_FIELD', 'admission', row.id, `${field} is blank`);
    }
    const key = `${row.school_id}:${String(row.admissionNo).trim().toLowerCase()}`;
    if (admissionNumbers.has(key)) issue('A_ADMISSION_NUMBER_COLLISION', 'admission', row.id, 'Normalized admission number collides');
    admissionNumbers.add(key);
  }
  const enrollments = new Set<string>();
  const rolls = new Set<string>();
  for (const row of input.students) {
    const admission = admissions.get(row.admission_id);
    const session = sessions.get(row.session_id);
    const klass = classes.get(row.class_id);
    const section = sections.get(row.section_id);
    if (!admission || !session || !klass || !section || section.class_id !== row.class_id ||
      [admission, session, klass, section].some((parent) => parent.school_id !== row.school_id))
      issue('A_ENROLLMENT_RELATIONSHIP', 'admission', row.id, 'Orphan or cross-tenant enrollment relationship');
    const enrollment = `${row.admission_id}:${row.session_id}`;
    if (enrollments.has(enrollment)) issue('A_ENROLLMENT_DUPLICATE', 'admission', row.id, 'Duplicate session enrollment');
    enrollments.add(enrollment);
    if (row.rollNo != null) {
      const roll = `${row.session_id}:${row.class_id}:${row.section_id}:${row.rollNo}`;
      if (rolls.has(roll)) issue('A_ROLL_DUPLICATE', 'admission', row.id, 'Duplicate class/section roll number');
      rolls.add(roll);
    }
  }
  for (const row of input.plans) {
    validate(modeConfigSchema, row.modeConfig, 'E_MODE_CONFIG', 'examination', row.id);
    const session = sessions.get(row.session_id);
    const klass = classes.get(row.class_id);
    if (!session || !klass || session.school_id !== row.school_id || klass.school_id !== row.school_id)
      issue('E_PLAN_RELATIONSHIP', 'examination', row.id, 'Orphan examination plan relationship');
    if (!session?.sessionConfig?.examConfig?.[row.examSlug])
      issue('E_EXAM_DEFINITION', 'examination', row.id, `Undefined exam slug ${String(row.examSlug)}`);
    if (!klass?.config?.subjects?.[row.subjectSlug])
      issue('E_SUBJECT_REFERENCE', 'examination', row.id, `Undefined subject ${String(row.subjectSlug)}`);
  }
  for (const row of input.results) {
    validate(resultMarksSchema, row.marks, 'E_RESULT_MARKS', 'examination', row.id);
    if (row.coScholastics != null)
      validate(coScholasticGradesSchema, row.coScholastics, 'E_RESULT_CO_SCHOLASTIC', 'examination', row.id);
    const plan = plans.get(row.exam_plan_id);
    const student = students.get(row.student_id);
    if (!plan || !student || plan.session_id !== row.session_id || student.session_id !== row.session_id ||
      plan.school_id !== row.school_id || student.school_id !== row.school_id)
      issue('E_RESULT_RELATIONSHIP', 'examination', row.id, 'Orphan or cross-session result relationship');
    for (const [mode, mark] of Object.entries(row.marks ?? {})) {
      const maximum = plan?.modeConfig?.[mode]?.maxMarks;
      if (typeof mark !== 'number' || typeof maximum !== 'number' || mark < 0 || mark > maximum)
        issue('E_RESULT_RANGE', 'examination', row.id, `Invalid ${mode} mark ${String(mark)}/${String(maximum)}`);
    }
  }
  for (const row of input.timetables) {
    validate(timetableConfigSchema, row.config, 'E_TIMETABLE_CONFIG', 'examination', row.id);
    const session = sessions.get(row.session_id);
    if (!session || session.school_id !== row.school_id || !session.sessionConfig?.examConfig?.[row.examSlug])
      issue('E_TIMETABLE_EXAM', 'examination', row.id, 'Timetable references an undefined exam/session');
    for (const timetableRow of row.config?.rows ?? []) for (const [classId, rawCell] of Object.entries(timetableRow.cells ?? {})) {
      const cells = Array.isArray(rawCell) ? rawCell : rawCell ? [rawCell] : [];
      for (const cell of cells as any[]) {
        const plan = input.plans.find((candidate) => candidate.session_id === row.session_id && candidate.examSlug === row.examSlug && candidate.class_id === classId && candidate.subjectSlug === cell.subjectSlug);
        if (classes.get(classId)?.school_id !== row.school_id || !plan?.modeConfig?.[cell.modeSlug])
          issue('E_TIMETABLE_REFERENCE', 'examination', row.id, `Invalid class/subject/mode ${classId}/${cell.subjectSlug}/${cell.modeSlug}`);
      }
    }
  }
  const assessment = analyzeAssessments(
    input.plans.map((row) => ({
      id: String(row.id), examKey: `${row.session_id}:${row.examSlug}:${row.class_id}`,
      subjectKey: String(row.subjectSlug),
      totalWorkingDays: row.totalWorkingDays == null ? null : Number(row.totalWorkingDays),
    })),
    input.results.map((row) => ({
      id: String(row.id), planId: String(row.exam_plan_id), studentId: String(row.student_id),
      approved: typeof row.approved === 'boolean' ? row.approved : null,
      daysAttended: row.days_attended == null ? null : Number(row.days_attended),
      coScholastic: row.coScholastics ?? null,
    })),
  );
  for (const entry of assessment.issues) issue(entry.code, 'examination', entry.key, entry.message);

  for (const bill of input.bills) {
    const student = students.get(bill.student_id);
    if (!student || (bill.bill_event_id != null && !billRunIds.has(bill.bill_event_id)))
      issue('F_BILL_RELATIONSHIP', 'finance', bill.id, 'Bill has an orphan student or bill-run relationship');
    try {
      const total = Object.values(bill.line_items ?? {}).reduce<bigint>(
        (sum, line: any) => sum + minor(line.amount), 0n,
      );
      const amount = minor(bill.amount);
      if (amount < 0n || total !== amount) issue('F_BILL_TOTAL', 'finance', bill.id, 'Bill amount and line total differ or are negative');
      if (bill.line_items?.custom && !String(bill.line_items.custom.name ?? '').trim())
        issue('F_CUSTOM_TITLE', 'finance', bill.id, 'Custom bill line title is blank');
    } catch (error) { issue('F_INVALID_AMOUNT', 'finance', bill.id, String(error)); }
    if (bill.bill_event_id == null) {
      rebuildExceptions.push({
        code: 'F_STANDALONE_MANUAL_FALLBACK',
        domain: 'finance',
        sourceKey: String(bill.id),
        disposition: 'use-approved-migration-actor',
        evidence: {
          billId: String(bill.id),
          sourceActor: null,
          manualReason:
            CANONICAL_DECISION_POLICY['F-12'].standaloneManualReason,
        },
      });
    }
  }
  for (const school of input.schools) {
    const legacy = school.finance_schema ?? { recurring: 'monthly', currency: 'INR', elements: {} };
    if (legacy.currency !== 'INR') issue('F_CURRENCY', 'finance', school.id, 'Finance currency must be INR');
    try {
      const elements = Object.fromEntries(Object.entries(legacy.elements ?? {}).map(([slug, raw]: [string, any]) => [slug, {
        name: raw.name, scopes: raw.scopes, requiredAtLevel: raw.requiredAtLevel,
        ...(raw.defaultValue == null ? {} : { defaultAmountMinor: Number(minor(raw.defaultValue)) }),
      }]));
      validate(financeSchemaConfigSchema, {
        recurring: legacy.recurring, currency: 'INR', timeZone: CANONICAL_DECISION_POLICY['G-05'].sourceTimeZone, cycleStartMonth: 4, elements,
      }, 'F_SCHEMA', 'finance', school.id);
      const classOverrides = Object.fromEntries(input.classes.filter((row) => row.school_id === school.id && row.finance_config).map((row) => [row.slug, Object.fromEntries(Object.entries(row.finance_config).map(([slug, value]) => [slug, Number(minor(value))]))]));
      validate(financeClassOverridesSchema, classOverrides, 'F_CLASS_OVERRIDES', 'finance', school.id);
    } catch (error) { issue('F_INVALID_AMOUNT', 'finance', school.id, String(error)); }
  }
  for (const admission of input.admissions) {
    try {
      const values = Object.fromEntries(input.students.filter((row) => row.admission_id === admission.id && row.finance_config).map((row) => [row.session_id, Object.fromEntries(Object.entries(row.finance_config).map(([slug, value]) => [slug, Number(minor(value))]))]));
      validate(studentFinanceValuesSchema, values, 'F_ADMISSION_VALUES', 'finance', admission.id);
    } catch (error) { issue('F_INVALID_AMOUNT', 'finance', admission.id, String(error)); }
  }
  for (const run of input.billRuns) {
    if (sessions.get(run.session_id)?.school_id !== run.school_id || !staffIds.has(run.generated_by))
      issue('F_BILL_RUN_RELATIONSHIP', 'finance', run.id, 'Bill run has an orphan session or actor relationship');
    try {
      const members = input.bills.filter((bill) => bill.bill_event_id === run.id);
      const memberTotal = members.reduce((sum, bill) => sum + minor(bill.amount), 0n);
      const headerCount = Number(run.meta?.studentCount);
      const headerTotal = minor(run.meta?.totalAmount);
      if (!Number.isSafeInteger(headerCount) || headerCount < 0)
        throw new Error('bill-run studentCount is not a non-negative integer');
      if (headerCount !== members.length || headerTotal !== memberTotal) {
        rebuildExceptions.push({
          code: 'F_BILL_RUN_HEADER_REBUILD',
          domain: 'finance',
          sourceKey: String(run.id),
          disposition: 'rebuild-from-member-bills',
          evidence: {
            sourceHeader: {
              billCount: headerCount,
              totalAmountMinor: headerTotal.toString(),
            },
            rebuiltHeader: {
              billCount: members.length,
              totalAmountMinor: memberTotal.toString(),
            },
          },
        });
      }
    } catch (error) {
      issue('F_BILL_RUN_HEADER_INVALID', 'finance', run.id, String(error));
    }
  }
  for (const row of input.ledger) {
    if (students.get(row.student_id)?.school_id !== row.school_id || !staffIds.has(row.recorded_by) || (row.ref_bill_event_id != null && !billRunIds.has(row.ref_bill_event_id)))
      issue('F_LEDGER_RELATIONSHIP', 'finance', row.id, 'Ledger event has an orphan student, actor, or bill-run relationship');
    try {
      if (minor(row.amount) < 0n || minor(row.discount) < 0n)
        issue('F_AMOUNT_RANGE', 'finance', row.id, 'Ledger amounts must be non-negative');
    } catch (error) { issue('F_INVALID_AMOUNT', 'finance', row.id, String(error)); }
  }
  const billProjectionByStudent = new Map((input.billProjections ?? []).map((row) => [row.student_id, row]));
  const ledgerProjectionByStudent = new Map((input.ledgerProjections ?? []).map((row) => [row.student_id, row]));
  const projectionReport = [...students.keys()].toSorted().map((studentId) => {
    const bills = input.bills.filter((row) => row.student_id === studentId);
    const ledger = input.ledger.filter((row) => row.student_id === studentId);
    const totalBilled = bills.reduce((sum, row) => sum + minor(row.amount), 0n);
    const totalPaid = ledger.reduce((sum, row) => sum + minor(row.amount), 0n);
    const totalDiscount = ledger.reduce((sum, row) => sum + minor(row.discount), 0n);
    const lastBillVersion = Math.max(0, ...bills.map((row) => Number(row.version)));
    const lastLedgerVersion = Math.max(0, ...ledger.map((row) => Number(row.version)));
    const billProjection = billProjectionByStudent.get(studentId);
    const ledgerProjection = ledgerProjectionByStudent.get(studentId);
    const report = {
      studentId,
      eventDerived: {
        totalBilled: totalBilled.toString(), totalPaid: totalPaid.toString(),
        totalDiscount: totalDiscount.toString(), outstanding: (totalBilled - totalPaid - totalDiscount).toString(),
        lastBillVersion, lastLedgerVersion,
      },
      projection: {
        totalBilled: billProjection ? minor(billProjection.total_billed).toString() : null,
        totalPaid: ledgerProjection ? minor(ledgerProjection.total_paid).toString() : null,
        totalDiscount: ledgerProjection ? minor(ledgerProjection.total_discount).toString() : null,
        outstanding: ledgerProjection ? minor(ledgerProjection.outstanding).toString() : null,
        lastBillVersion: ledgerProjection?.last_bill_version ?? billProjection?.last_version ?? null,
        lastLedgerVersion: ledgerProjection?.last_ledger_version ?? null,
      },
    };
    const projectionMatches = report.projection.totalBilled === report.eventDerived.totalBilled &&
      report.projection.totalPaid === report.eventDerived.totalPaid &&
      report.projection.totalDiscount === report.eventDerived.totalDiscount &&
      report.projection.outstanding === report.eventDerived.outstanding &&
      Number(report.projection.lastBillVersion) === report.eventDerived.lastBillVersion &&
      Number(report.projection.lastLedgerVersion) === report.eventDerived.lastLedgerVersion;
    if (!projectionMatches) {
      const missing = !billProjection || !ledgerProjection;
      rebuildExceptions.push({
        code: 'F_PROJECTION_REBUILD',
        domain: 'finance',
        sourceKey: studentId,
        disposition: 'rebuild-from-events',
        evidence: { status: missing ? 'missing' : 'stale', ...report },
      });
    }
    return report;
  });
  return {
    issues,
    rebuildExceptions: rebuildExceptions.toSorted((left, right) =>
      `${left.code}:${left.sourceKey}`.localeCompare(`${right.code}:${right.sourceKey}`)),
    workingDays: assessment.workingDays,
    projectionReport,
  };
}
