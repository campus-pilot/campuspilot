import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import {
  examLifecycleTable,
  examPlanTable,
} from "@campuspilot/db/schema/exam";
import { sessionConfigSchema } from "@campuspilot/db/schema/jsonb/session-config";
import { schoolUserRoleTable } from "@campuspilot/db/schema/school-user-role";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import { rpcError } from "../../../errors";
import { getSessionFinanceOverview } from "../billing/reports-read";
import type { DashboardDto } from "./dashboard.dto";

type DashboardScope = { schoolId: string; sessionId: string };

export type DashboardPermissions = {
  admissions: boolean;
  classes: boolean;
  students: boolean;
  billing: boolean;
  examinations: boolean;
  createAdmission: boolean;
  recordPayment: boolean;
  enterResults: boolean;
};

type ClassAccess = {
  scope: "school" | "assigned";
  classIds: string[] | null;
};

const asBigInt = (value: unknown) =>
  typeof value === "bigint" ? value : BigInt(String(value ?? 0));

/**
 * Teacher assignment metadata is the explicit classroom scope fact. Holding any
 * additional school role widens the dashboard to school scope; the UI never
 * branches on a role name and only receives this resolved scope.
 */
async function resolveClassAccess(
  db: DatabaseExecutor,
  schoolId: string,
  userId: string,
): Promise<ClassAccess> {
  const assignments = await db
    .select({ role: schoolUserRoleTable.role, meta: schoolUserRoleTable.meta })
    .from(schoolUserRoleTable)
    .where(
      and(
        eq(schoolUserRoleTable.schoolId, schoolId),
        eq(schoolUserRoleTable.userId, userId),
      ),
    );

  if (assignments.some(({ role }) => role !== "teacher")) {
    return { scope: "school", classIds: null };
  }

  return {
    scope: "assigned",
    classIds: [
      ...new Set(
        assignments.flatMap(({ meta }) => meta?.classIds ?? []),
      ),
    ],
  };
}

async function readAdmissions(
  db: DatabaseExecutor,
  { schoolId }: DashboardScope,
  includeClassBreakdown: boolean,
): Promise<NonNullable<DashboardDto["admissions"]>> {
  const [totals, classRows] = await Promise.all([
    db
      .select({
        total: count(),
        registered: sql<number>`count(*) filter (where ${admissionTable.registered} = true)::integer`,
        unregistered: sql<number>`count(*) filter (where ${admissionTable.registered} = false)::integer`,
        unassigned: sql<number>`count(*) filter (where ${admissionTable.registered} = true and ${admissionTable.admissionClassId} is null)::integer`,
      })
      .from(admissionTable)
      .where(eq(admissionTable.schoolId, schoolId)),
    includeClassBreakdown
      ? db
          .select({
            classId: classTable.id,
            label: classTable.label,
            value: count(),
          })
          .from(admissionTable)
          .innerJoin(
            classTable,
            and(
              eq(classTable.schoolId, schoolId),
              eq(classTable.id, admissionTable.admissionClassId),
            ),
          )
          .where(
            and(
              eq(admissionTable.schoolId, schoolId),
              eq(admissionTable.registered, true),
            ),
          )
          .groupBy(classTable.id, classTable.label, classTable.displayOrder)
          .orderBy(asc(classTable.displayOrder), asc(classTable.id))
      : Promise.resolve([]),
  ]);
  const total = totals[0];
  return {
    total: total?.total ?? 0,
    registered: total?.registered ?? 0,
    unregistered: total?.unregistered ?? 0,
    unassigned: total?.unassigned ?? 0,
    byClass: classRows,
  };
}

async function readClassrooms(
  db: DatabaseExecutor,
  scope: DashboardScope,
  access: ClassAccess,
): Promise<NonNullable<DashboardDto["classrooms"]>> {
  if (access.classIds?.length === 0) {
    return {
      scope: access.scope,
      classCount: 0,
      sectionCount: 0,
      studentCount: 0,
      classes: [],
    };
  }
  const classFilter = access.classIds
    ? inArray(classTable.id, access.classIds)
    : undefined;
  const studentClassFilter = access.classIds
    ? inArray(studentTable.classId, access.classIds)
    : undefined;
  const sectionClassFilter = access.classIds
    ? inArray(sectionTable.classId, access.classIds)
    : undefined;
  const [classes, sections, students] = await Promise.all([
    db
      .select({ id: classTable.id, label: classTable.label })
      .from(classTable)
      .where(and(eq(classTable.schoolId, scope.schoolId), classFilter))
      .orderBy(asc(classTable.displayOrder), asc(classTable.id)),
    db
      .select({ classId: sectionTable.classId, value: count() })
      .from(sectionTable)
      .where(
        and(
          eq(sectionTable.schoolId, scope.schoolId),
          sectionClassFilter,
        ),
      )
      .groupBy(sectionTable.classId),
    db
      .select({ classId: studentTable.classId, value: count() })
      .from(studentTable)
      .where(
        and(
          eq(studentTable.schoolId, scope.schoolId),
          eq(studentTable.sessionId, scope.sessionId),
          studentClassFilter,
        ),
      )
      .groupBy(studentTable.classId),
  ]);
  const sectionCounts = new Map(
    sections.map(({ classId, value }) => [classId, value]),
  );
  const studentCounts = new Map(
    students.map(({ classId, value }) => [classId, value]),
  );
  const items = classes.map((entry) => ({
    ...entry,
    sectionCount: sectionCounts.get(entry.id) ?? 0,
    studentCount: studentCounts.get(entry.id) ?? 0,
  }));
  return {
    scope: access.scope,
    classCount: items.length,
    sectionCount: items.reduce((sum, entry) => sum + entry.sectionCount, 0),
    studentCount: items.reduce((sum, entry) => sum + entry.studentCount, 0),
    classes: items,
  };
}

async function readExaminations(
  db: DatabaseExecutor,
  scope: DashboardScope,
  access: ClassAccess,
  sessionConfig: unknown,
): Promise<NonNullable<DashboardDto["examinations"]>> {
  if (access.classIds?.length === 0) {
    return {
      scope: access.scope,
      configured: 0,
      ready: 0,
      active: 0,
      completed: 0,
      exams: [],
    };
  }
  const config = sessionConfigSchema.parse(sessionConfig ?? {});
  const planClassFilter = access.classIds
    ? inArray(examPlanTable.classId, access.classIds)
    : undefined;
  const [lifecycles, planCounts] = await Promise.all([
    db
      .select({
        examSlug: examLifecycleTable.examSlug,
        status: examLifecycleTable.status,
      })
      .from(examLifecycleTable)
      .where(
        and(
          eq(examLifecycleTable.schoolId, scope.schoolId),
          eq(examLifecycleTable.sessionId, scope.sessionId),
        ),
      ),
    db
      .select({
        examSlug: examPlanTable.examSlug,
        planCount: count(),
        classCount: countDistinct(examPlanTable.classId),
      })
      .from(examPlanTable)
      .where(
        and(
          eq(examPlanTable.schoolId, scope.schoolId),
          eq(examPlanTable.sessionId, scope.sessionId),
          planClassFilter,
        ),
      )
      .groupBy(examPlanTable.examSlug),
  ]);
  const lifecycleBySlug = new Map(
    lifecycles.map(({ examSlug, status }) => [examSlug, status]),
  );
  const countsBySlug = new Map(planCounts.map((row) => [row.examSlug, row]));
  const exams = Object.entries(config.examConfig)
    .sort(([, left], [, right]) => left.order - right.order)
    .map(([slug, definition]) => {
      const counts = countsBySlug.get(slug);
      return {
        slug,
        name: definition.name,
        status: lifecycleBySlug.get(slug) ?? null,
        planCount: counts?.planCount ?? 0,
        classCount: counts?.classCount ?? 0,
      };
    })
    .filter((exam) => access.scope === "school" || exam.planCount > 0);
  return {
    scope: access.scope,
    configured: exams.length,
    ready: exams.filter((exam) => exam.status === "ready").length,
    active: exams.filter((exam) => exam.status === "active").length,
    completed: exams.filter((exam) => exam.status === "completed").length,
    exams,
  };
}

async function readBilling(
  db: DatabaseExecutor,
  scope: DashboardScope,
  financeConfig: typeof schoolSessionTable.$inferSelect.financeConfig,
): Promise<NonNullable<DashboardDto["billing"]>> {
  const timeZone = financeConfig?.timeZone ?? "UTC";
  /**
   * The month bucket is computed once because repeating an interpolated time
   * zone creates distinct SQL parameters that PostgreSQL cannot match across
   * the SELECT and GROUP BY expressions.
   */
  const [overview, activity, billedAdmissions] = await Promise.all([
    getSessionFinanceOverview(db, scope),
    db.execute<{
      currency: string;
      month: string;
      billed: string;
      payments: string;
      refunds: string;
    }>(sql`
      with dashboard_activity as (
        select
          entry.currency,
          entry.amount_minor,
          entry.type,
          date_trunc('month', entry.effective_at at time zone ${timeZone}) as month_bucket
        from finance_ledger_entry entry
        where entry.school_id = ${scope.schoolId}
          and entry.session_id = ${scope.sessionId}
          and entry.type <> 'reversal'
          and not exists (
            select 1 from finance_ledger_entry reversal
            where reversal.school_id = entry.school_id
              and reversal.reversal_of_entry_id = entry.id
          )
      )
      select activity.currency,
        to_char(activity.month_bucket, 'YYYY-MM') as month,
        coalesce(sum(activity.amount_minor) filter (where activity.type in ('bill', 'manual_debit_adjustment')), 0)::numeric as billed,
        coalesce(sum(activity.amount_minor) filter (where activity.type = 'payment'), 0)::numeric as payments,
        coalesce(sum(activity.amount_minor) filter (where activity.type = 'refund'), 0)::numeric as refunds
      from dashboard_activity activity
      group by activity.currency, activity.month_bucket
      order by activity.month_bucket asc, activity.currency asc
    `),
    db.execute<{ currency: string; value: number }>(sql`
      select entry.currency, count(distinct entry.admission_id)::integer as value
      from finance_ledger_entry entry
      where entry.school_id = ${scope.schoolId}
        and entry.session_id = ${scope.sessionId}
        and entry.type in ('bill', 'manual_debit_adjustment')
        and entry.reversal_of_entry_id is null
        and not exists (
          select 1 from finance_ledger_entry reversal
          where reversal.school_id = entry.school_id
            and reversal.reversal_of_entry_id = entry.id
        )
      group by entry.currency
    `),
  ]);
  const monthsByCurrency = new Map<
    string,
    Array<{
      month: string;
      billedMinor: string;
      paymentMinor: string;
      refundMinor: string;
      netCashMinor: string;
    }>
  >();
  for (const row of activity.rows) {
    const payments = asBigInt(row.payments);
    const refunds = asBigInt(row.refunds);
    const months = monthsByCurrency.get(row.currency) ?? [];
    months.push({
      month: row.month,
      billedMinor: String(row.billed),
      paymentMinor: payments.toString(),
      refundMinor: refunds.toString(),
      netCashMinor: (payments - refunds).toString(),
    });
    monthsByCurrency.set(row.currency, months);
  }
  const billedByCurrency = new Map(
    billedAdmissions.rows.map(({ currency, value }) => [currency, value]),
  );
  const configuredCurrency = financeConfig?.currency ?? null;
  const totals = [...overview.currencies];
  if (
    configuredCurrency &&
    !totals.some(({ currency }) => currency === configuredCurrency)
  ) {
    totals.unshift({
      currency: configuredCurrency,
      billedMinor: "0",
      paymentMinor: "0",
      refundMinor: "0",
      netCashMinor: "0",
      discountMinor: "0",
      waiverMinor: "0",
      writeOffMinor: "0",
      creditCorrectionMinor: "0",
      creditAdjustmentMinor: "0",
      debitAdjustmentMinor: "0",
      balanceMinor: "0",
      dueMinor: "0",
      creditMinor: "0",
      collectionRateBasisPoints: null,
    });
  }
  return {
    primaryCurrency: configuredCurrency ?? totals[0]?.currency ?? null,
    currencies: totals.map((total) => ({
      currency: total.currency,
      billedMinor: total.billedMinor,
      paymentMinor: total.paymentMinor,
      refundMinor: total.refundMinor,
      netCashMinor: total.netCashMinor,
      creditAdjustmentMinor: total.creditAdjustmentMinor,
      debitAdjustmentMinor: total.debitAdjustmentMinor,
      dueMinor: total.dueMinor,
      collectionRateBasisPoints: total.collectionRateBasisPoints,
      billedAdmissions: billedByCurrency.get(total.currency) ?? 0,
      monthly: (monthsByCurrency.get(total.currency) ?? []).slice(-12),
    })),
  };
}

/** Reads only the independently authorized domains used by the dashboard. */
export async function readDashboard(
  db: DatabaseExecutor,
  scope: DashboardScope,
  userId: string,
  permissions: DashboardPermissions,
): Promise<DashboardDto> {
  const [session] = await db
    .select()
    .from(schoolSessionTable)
    .where(
      and(
        eq(schoolSessionTable.schoolId, scope.schoolId),
        eq(schoolSessionTable.id, scope.sessionId),
      ),
    )
    .limit(1);
  if (!session) throw rpcError.notFound("School session");

  const classAccess =
    (permissions.classes && permissions.students) || permissions.examinations
      ? await resolveClassAccess(db, scope.schoolId, userId)
      : null;
  const [admissions, classrooms, billing, examinations] = await Promise.all([
    permissions.admissions
      ? readAdmissions(db, scope, permissions.classes)
      : null,
    permissions.classes && permissions.students && classAccess
      ? readClassrooms(db, scope, classAccess)
      : null,
    permissions.billing
      ? readBilling(db, scope, session.financeConfig)
      : null,
    permissions.examinations && classAccess
      ? readExaminations(
          db,
          scope,
          classAccess,
          session.sessionConfig,
        )
      : null,
  ]);

  return {
    admissions,
    classrooms,
    billing,
    examinations,
    actions: {
      createAdmission: permissions.createAdmission,
      recordPayment: permissions.recordPayment,
      enterResults: permissions.enterResults,
      createNotice: false,
    },
  };
}
