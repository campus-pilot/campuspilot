import { createHash } from "node:crypto";

import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import type {
  FinanceClassOverrides,
} from "@campuspilot/db/schema/jsonb/finance-config";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import { and, asc, eq, inArray } from "drizzle-orm";

import { calculateBillingPeriod, type BillingPeriod } from "./period";
import {
  resolveBillingPrice,
  snapshotBillingPriceResolution,
  validateBillingConfiguration,
} from "./pricing";
import { checkedFinanceAddition } from "./transport";

/** Posting deliberately caps a run so locks and statement sizes stay bounded. */
export const MAX_BILLING_RUN_ADMISSIONS = 5000;

/**
 * Reads at most one row beyond the supported run size. Both preview and post
 * call this before materializing enrollment snapshots or constructing lock
 * lists, so full-school work is bounded even when the school is oversized.
 */
export async function findBoundedBillingCandidates(
  db: DatabaseExecutor,
  draft: BillingRunDraft,
) {
  return db
    .select({
      enrollmentId: studentTable.id,
      admissionId: studentTable.admissionId,
    })
    .from(studentTable)
    .where(
      and(
        eq(studentTable.schoolId, draft.schoolId),
        eq(studentTable.sessionId, draft.sessionId),
        draft.admissionIds
          ? inArray(studentTable.admissionId, draft.admissionIds)
          : undefined,
        draft.classIds ? inArray(studentTable.classId, draft.classIds) : undefined,
      ),
    )
    .orderBy(asc(studentTable.admissionId), asc(studentTable.id))
    .limit(MAX_BILLING_RUN_ADMISSIONS + 1);
}

export type BillingRunDraft = {
  schoolId: string;
  sessionId: string;
  billingDate: string;
  admissionIds?: string[];
  classIds?: string[];
  runValues: {
    session: Record<string, string>;
    classes: Record<string, Record<string, string>>;
  };
};

export type BillingReadinessIssue = {
  scope: "configuration" | "session" | "class" | "admission";
  entityId: string;
  entityLabel: string;
  code:
    | "invalid_configuration"
    | "invalid_run_value"
    | "unresolved_price"
    | "missing_placement"
    | "unregistered"
    | "zero_total"
    | "not_enrolled"
    | "invalid_selection"
    | "run_too_large"
    | "amount_overflow";
  feeElementSlug: string | null;
  blocking: boolean;
  message: string;
  pricingResolutionSnapshot?: Record<string, unknown>;
};

export type PreparedBillLine = {
  feeElementSlug: string;
  feeElementName: string;
  amountMinor: bigint;
  pricingSourceKind:
    | "admission"
    | "class"
    | "session"
    | "run_class"
    | "run_session"
    | "fallback";
  pricingSourceKey: string;
  pricingRuleSnapshot: Record<string, unknown>;
};

export type PreparedAdmissionBill = {
  admissionId: string;
  admissionNumber: string;
  admissionName: string;
  enrollmentId: string;
  classId: string;
  classSlug: string;
  classLabel: string;
  sectionId: string | null;
  sectionSlug: string | null;
  sectionLabel: string | null;
  rollNumber: number | null;
  totalAmountMinor: bigint;
  lines: PreparedBillLine[];
};

export type PreparedBillingRun = {
  configurationHash: string;
  readyToPost: boolean;
  period: BillingPeriod | null;
  currency: string | null;
  selectedCount: number;
  eligible: PreparedAdmissionBill[];
  issues: BillingReadinessIssue[];
  totalAmountMinor: bigint;
  sessionSnapshot: {
    id: string;
    startYear: number;
    endYear: number;
  } | null;
  configSnapshot: Record<string, unknown>;
  inputSnapshot: Record<string, unknown>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** Deterministic JSON used by both preview and posting stale-review checks. */
export function hashBillingReview(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

function issue(
  value: BillingReadinessIssue,
  issues: BillingReadinessIssue[],
): void {
  issues.push(value);
}

function validateRunValues(
  draft: BillingRunDraft,
  config: ReturnType<typeof validateBillingConfiguration>,
  schoolClasses: Array<{ id: string; slug: string; label: string }>,
  issues: BillingReadinessIssue[],
): void {
  if (!config.valid) return;
  const classes = new Map(schoolClasses.map((row) => [row.id, row]));
  const validateValues = (
    scope: "session" | "class",
    entityId: string,
    entityLabel: string,
    values: Record<string, string>,
  ) => {
    for (const elementSlug of Object.keys(values).sort()) {
      const element = config.config.elements[elementSlug];
      if (!element || element.requiredAtLevel !== "bill_generation") {
        issue(
          {
            scope,
            entityId,
            entityLabel,
            code: "invalid_run_value",
            feeElementSlug: elementSlug,
            blocking: true,
            message: `Run-time value "${elementSlug}" is not a bill-generation fee element.`,
          },
          issues,
        );
      }
    }
  };

  validateValues(
    "session",
    draft.sessionId,
    "Session",
    draft.runValues.session,
  );
  for (const [classId, values] of Object.entries(draft.runValues.classes).sort()) {
    const schoolClass = classes.get(classId);
    if (!schoolClass) {
      issue(
        {
          scope: "class",
          entityId: classId,
          entityLabel: classId,
          code: "invalid_run_value",
          feeElementSlug: null,
          blocking: true,
          message: "Run-time class values reference a class outside this school.",
        },
        issues,
      );
      continue;
    }
    validateValues("class", classId, schoolClass.label, values);
  }
}

/**
 * Prepares the complete reviewed command without writing finance facts. The
 * returned hash binds configuration, overrides, enrollments, selection and run
 * inputs; posting calls this same derivation again while holding locks.
 */
export async function prepareBillingRun(
  db: DatabaseExecutor,
  draft: BillingRunDraft,
): Promise<PreparedBillingRun> {
  const [session] = await db
    .select({
      id: schoolSessionTable.id,
      startYear: schoolSessionTable.sessionStartYear,
      endYear: schoolSessionTable.sessionEndYear,
      financeConfig: schoolSessionTable.financeConfig,
      classOverrides: schoolSessionTable.financeClassOverrides,
    })
    .from(schoolSessionTable)
    .where(
      and(
        eq(schoolSessionTable.schoolId, draft.schoolId),
        eq(schoolSessionTable.id, draft.sessionId),
      ),
    )
    .limit(1);

  const requestedClassIds = [
    ...new Set([
      ...(draft.classIds ?? []),
      ...Object.keys(draft.runValues.classes),
    ]),
  ].sort();
  const schoolClasses = requestedClassIds.length
    ? await db
        .select({ id: classTable.id, slug: classTable.slug, label: classTable.label })
        .from(classTable)
        .where(
          and(
            eq(classTable.schoolId, draft.schoolId),
            inArray(classTable.id, requestedClassIds),
          ),
        )
        .orderBy(asc(classTable.id))
    : [];
  const issues: BillingReadinessIssue[] = [];
  const validated = validateBillingConfiguration(session?.financeConfig ?? null);
  if (!session) {
    issue(
      {
        scope: "session",
        entityId: draft.sessionId,
        entityLabel: draft.sessionId,
        code: "not_enrolled",
        feeElementSlug: null,
        blocking: true,
        message: "The billing session does not belong to this school.",
      },
      issues,
    );
  }
  if (!validated.valid) {
    for (const configIssue of validated.issues) {
      issue(
        {
          scope: "configuration",
          entityId: draft.sessionId,
          entityLabel: "Finance configuration",
          code: "invalid_configuration",
          feeElementSlug: configIssue.path.startsWith("elements.")
            ? (configIssue.path.split(".")[1] ?? null)
            : null,
          blocking: true,
          message: configIssue.path
            ? `${configIssue.path}: ${configIssue.message}`
            : configIssue.message,
        },
        issues,
      );
    }
  }
  validateRunValues(draft, validated, schoolClasses, issues);

  const selectedAdmissionIds = draft.admissionIds?.slice().sort();
  const selectedClassIds = draft.classIds?.slice().sort();
  if (selectedClassIds) {
    const ownedClassIds = new Set(schoolClasses.map(({ id }) => id));
    for (const classId of selectedClassIds) {
      if (!ownedClassIds.has(classId)) {
        issue(
          {
            scope: "class",
            entityId: classId,
            entityLabel: classId,
            code: "invalid_selection",
            feeElementSlug: null,
            blocking: true,
            message: "The selected class is not available in this school session context.",
          },
          issues,
        );
      }
    }
  }
  const candidateRows = await findBoundedBillingCandidates(db, draft);
  if (candidateRows.length > MAX_BILLING_RUN_ADMISSIONS) {
    issue(
      {
        scope: "session",
        entityId: draft.sessionId,
        entityLabel: "Billing run",
        code: "run_too_large",
        feeElementSlug: null,
        blocking: true,
        message: `A billing run may contain at most ${MAX_BILLING_RUN_ADMISSIONS} candidate admissions. Narrow the selection and post additional runs explicitly.`,
      },
      issues,
    );
    let period: BillingPeriod | null = null;
    if (validated.valid) {
      period = calculateBillingPeriod({
        billingDate: draft.billingDate,
        cadence: validated.config.recurring,
        cycleStartMonth: validated.config.cycleStartMonth,
        timeZone: validated.config.timeZone,
      });
    }
    const inputSnapshot = cloneSnapshot({
      billingDate: draft.billingDate,
      admissionIds: selectedAdmissionIds ?? null,
      classIds: selectedClassIds ?? null,
      runValues: draft.runValues,
    });
    const configSnapshot = cloneSnapshot({
      financeConfig: session?.financeConfig ?? null,
      classOverrides: {},
    });
    return {
      configurationHash: hashBillingReview({
        schoolId: draft.schoolId,
        sessionId: draft.sessionId,
        configSnapshot,
        inputSnapshot,
        oversizedCandidateIds: candidateRows.map(({ enrollmentId, admissionId }) => ({
          enrollmentId,
          admissionId,
        })),
        issues,
        period: period
          ? {
              ...period,
              startAt: period.startAt.toISOString(),
              endAt: period.endAt.toISOString(),
            }
          : null,
      }),
      readyToPost: false,
      period,
      currency: validated.valid ? validated.config.currency : null,
      selectedCount: candidateRows.length,
      eligible: [],
      issues,
      totalAmountMinor: BigInt(0),
      sessionSnapshot: session
        ? { id: session.id, startYear: session.startYear, endYear: session.endYear }
        : null,
      configSnapshot,
      inputSnapshot,
    };
  }
  const enrollmentWhere = and(
    eq(studentTable.schoolId, draft.schoolId),
    eq(studentTable.sessionId, draft.sessionId),
    candidateRows.length
      ? inArray(
          studentTable.id,
          candidateRows.map(({ enrollmentId }) => enrollmentId),
        )
      : undefined,
    candidateRows.length ? undefined : eq(studentTable.id, "__no_candidates__"),
  );
  const enrollments = await db
    .select({
      enrollmentId: studentTable.id,
      admissionId: admissionTable.id,
      admissionNumber: admissionTable.admissionNo,
      admissionName: admissionTable.name,
      registered: admissionTable.registered,
      financeValue: admissionTable.financeValue,
      classId: studentTable.classId,
      classSlug: classTable.slug,
      classLabel: classTable.label,
      sectionId: studentTable.sectionId,
      sectionSlug: sectionTable.slug,
      sectionLabel: sectionTable.label,
      rollNumber: studentTable.rollNo,
    })
    .from(studentTable)
    .innerJoin(
      admissionTable,
      and(
        eq(admissionTable.id, studentTable.admissionId),
        eq(admissionTable.schoolId, studentTable.schoolId),
      ),
    )
    .leftJoin(
      classTable,
      and(
        eq(classTable.id, studentTable.classId),
        eq(classTable.schoolId, studentTable.schoolId),
      ),
    )
    .leftJoin(
      sectionTable,
      and(
        eq(sectionTable.id, studentTable.sectionId),
        eq(sectionTable.schoolId, studentTable.schoolId),
      ),
    )
    .where(enrollmentWhere)
    .orderBy(asc(admissionTable.id), asc(studentTable.id));

  const relevantClassSlugs = new Set(
    enrollments.flatMap(({ classSlug }) => (classSlug ? [classSlug] : [])),
  );
  if (validated.valid && session) {
    const classesBySlug = new Map(
      [
        ...schoolClasses,
        ...enrollments.flatMap(({ classId, classSlug, classLabel }) =>
          classId && classSlug && classLabel
            ? [{ id: classId, slug: classSlug, label: classLabel }]
            : [],
        ),
      ].map((row) => [row.slug, row]),
    );
    for (const [classSlug, values] of Object.entries(session.classOverrides)
      .filter(([classSlug]) => relevantClassSlugs.has(classSlug))
      .sort()) {
      const schoolClass = classesBySlug.get(classSlug);
      if (!schoolClass) continue;
      for (const elementSlug of Object.keys(values).sort()) {
        const element = validated.config.elements[elementSlug];
        if (!element || !element.scopes.includes("class")) {
          issue(
            {
              scope: "class",
              entityId: schoolClass.id,
              entityLabel: schoolClass.label,
              code: "invalid_configuration",
              feeElementSlug: elementSlug,
              blocking: true,
              message: `Class pricing value "${elementSlug}" is not an allowed class-scoped fee element.`,
            },
            issues,
          );
        }
      }
    }
  }

  if (selectedAdmissionIds?.length) {
    const enrolledIds = new Set(enrollments.map(({ admissionId }) => admissionId));
    for (const admissionId of selectedAdmissionIds) {
      if (!enrolledIds.has(admissionId)) {
        issue(
          {
            scope: "admission",
            entityId: admissionId,
            entityLabel: admissionId,
            code: "not_enrolled",
            feeElementSlug: null,
            blocking: true,
            message: "The selected admission is not enrolled in this session and class selection.",
          },
          issues,
        );
      }
    }
  }

  const eligible: PreparedAdmissionBill[] = [];
  if (validated.valid && session) {
    for (const enrollment of enrollments) {
      if (!enrollment.registered) {
        issue(
          {
            scope: "admission",
            entityId: enrollment.admissionId,
            entityLabel: `${enrollment.admissionNumber} · ${enrollment.admissionName}`,
            code: "unregistered",
            feeElementSlug: null,
            blocking: false,
            message: "Unregistered admissions are excluded from ordinary bulk billing.",
          },
          issues,
        );
        continue;
      }
      if (!enrollment.classId || !enrollment.classSlug || !enrollment.classLabel) {
        issue(
          {
            scope: "admission",
            entityId: enrollment.admissionId,
            entityLabel: `${enrollment.admissionNumber} · ${enrollment.admissionName}`,
            code: "missing_placement",
            feeElementSlug: null,
            blocking: true,
            message: "The admission has no class placement for this session.",
          },
          issues,
        );
        continue;
      }

      const admissionValues = enrollment.financeValue[draft.sessionId] ?? {};
      let invalidAdmissionValues = false;
      for (const elementSlug of Object.keys(admissionValues).sort()) {
        const element = validated.config.elements[elementSlug];
        if (!element || !element.scopes.includes("student")) {
          invalidAdmissionValues = true;
          issue(
            {
              scope: "admission",
              entityId: enrollment.admissionId,
              entityLabel: `${enrollment.admissionNumber} · ${enrollment.admissionName}`,
              code: "invalid_configuration",
              feeElementSlug: elementSlug,
              blocking: true,
              message: `Admission pricing value "${elementSlug}" is not an allowed admission-scoped fee element.`,
            },
            issues,
          );
        }
      }
      if (invalidAdmissionValues) continue;

      const lines: PreparedBillLine[] = [];
      let hasUnresolvedRequired = false;
      for (const [elementSlug, element] of Object.entries(
        validated.config.elements,
      ).sort(([left], [right]) => left.localeCompare(right))) {
        const price = resolveBillingPrice(elementSlug, element, {
          sessionId: draft.sessionId,
          admissionId: enrollment.admissionId,
          classId: enrollment.classId,
          classSlug: enrollment.classSlug,
          admissionValues,
          classOverrides: session.classOverrides,
          runSessionValues: draft.runValues.session,
          runClassValues: draft.runValues.classes,
        });
        if (!price) {
          if (element.requiredAtLevel !== undefined) {
            hasUnresolvedRequired = true;
            issue(
              {
                scope: "admission",
                entityId: enrollment.admissionId,
                entityLabel: `${enrollment.admissionNumber} · ${enrollment.admissionName}`,
                code: "unresolved_price",
                feeElementSlug: elementSlug,
                blocking: true,
                message: `No amount resolves for required fee element "${element.name}".`,
                pricingResolutionSnapshot: snapshotBillingPriceResolution(
                  elementSlug,
                  element,
                  {
                    sessionId: draft.sessionId,
                    admissionId: enrollment.admissionId,
                    classId: enrollment.classId,
                    classSlug: enrollment.classSlug,
                    admissionValues,
                    classOverrides: session.classOverrides,
                    runSessionValues: draft.runValues.session,
                    runClassValues: draft.runValues.classes,
                  },
                ),
              },
              issues,
            );
          }
          continue;
        }
        lines.push({
          feeElementSlug: elementSlug,
          feeElementName: element.name,
          amountMinor: price.amountMinor,
          pricingSourceKind: price.sourceKind,
          pricingSourceKey: price.sourceKey,
          pricingRuleSnapshot: cloneSnapshot({
            elementSlug,
            element,
            source: price.sourceSnapshot,
          }),
        });
      }
      if (hasUnresolvedRequired) continue;
      let totalAmountMinor = BigInt(0);
      try {
        for (const line of lines) {
          totalAmountMinor = checkedFinanceAddition(
            totalAmountMinor,
            line.amountMinor,
          );
        }
      } catch {
        issue(
          {
            scope: "admission",
            entityId: enrollment.admissionId,
            entityLabel: `${enrollment.admissionNumber} · ${enrollment.admissionName}`,
            code: "amount_overflow",
            feeElementSlug: null,
            blocking: true,
            message: "The resolved bill total exceeds the supported exact amount range.",
          },
          issues,
        );
        continue;
      }
      if (totalAmountMinor <= BigInt(0)) {
        issue(
          {
            scope: "admission",
            entityId: enrollment.admissionId,
            entityLabel: `${enrollment.admissionNumber} · ${enrollment.admissionName}`,
            code: "zero_total",
            feeElementSlug: null,
            blocking: true,
            message: "The resolved bill has no positive total.",
          },
          issues,
        );
        continue;
      }
      eligible.push({
        admissionId: enrollment.admissionId,
        admissionNumber: enrollment.admissionNumber,
        admissionName: enrollment.admissionName,
        enrollmentId: enrollment.enrollmentId,
        classId: enrollment.classId,
        classSlug: enrollment.classSlug,
        classLabel: enrollment.classLabel,
        sectionId: enrollment.sectionId,
        sectionSlug: enrollment.sectionSlug,
        sectionLabel: enrollment.sectionLabel,
        rollNumber: enrollment.rollNumber,
        totalAmountMinor,
        lines,
      });
    }
  }

  let period: BillingPeriod | null = null;
  if (validated.valid) {
    period = calculateBillingPeriod({
      billingDate: draft.billingDate,
      cadence: validated.config.recurring,
      cycleStartMonth: validated.config.cycleStartMonth,
      timeZone: validated.config.timeZone,
    });
  }
  let totalAmountMinor = BigInt(0);
  try {
    for (const admission of eligible) {
      totalAmountMinor = checkedFinanceAddition(
        totalAmountMinor,
        admission.totalAmountMinor,
      );
    }
  } catch {
    issue(
      {
        scope: "session",
        entityId: draft.sessionId,
        entityLabel: "Billing run",
        code: "amount_overflow",
        feeElementSlug: null,
        blocking: true,
        message: "The billing-run total exceeds the supported exact amount range.",
      },
      issues,
    );
  }
  const configSnapshot = cloneSnapshot({
    financeConfig: session?.financeConfig ?? null,
    classOverrides: Object.fromEntries(
      Object.entries(
        (session?.classOverrides as FinanceClassOverrides | undefined) ?? {},
      ).filter(([classSlug]) => relevantClassSlugs.has(classSlug)),
    ),
  });
  const inputSnapshot = cloneSnapshot({
    billingDate: draft.billingDate,
    admissionIds: selectedAdmissionIds ?? null,
    classIds: selectedClassIds ?? null,
    runValues: draft.runValues,
  });
  const reviewBasis = {
    schoolId: draft.schoolId,
    sessionId: draft.sessionId,
    session: session
      ? {
          id: session.id,
          startYear: session.startYear,
          endYear: session.endYear,
        }
      : null,
    configSnapshot,
    inputSnapshot,
    enrollments: enrollments.map((enrollment) => ({
      ...enrollment,
      financeValue:
        enrollment.financeValue[draft.sessionId] ?? {},
    })),
    resolved: eligible.map((admission) => ({
      ...admission,
      totalAmountMinor: admission.totalAmountMinor.toString(10),
      lines: admission.lines.map((line) => ({
        ...line,
        amountMinor: line.amountMinor.toString(10),
      })),
    })),
    issues,
    period: period
      ? {
          ...period,
          startAt: period.startAt.toISOString(),
          endAt: period.endAt.toISOString(),
        }
      : null,
  };
  const selectedCount = selectedAdmissionIds?.length ?? enrollments.length;

  return {
    configurationHash: hashBillingReview(reviewBasis),
    readyToPost:
      eligible.length > 0 && !issues.some((candidate) => candidate.blocking),
    period,
    currency: validated.valid ? validated.config.currency : null,
    selectedCount,
    eligible,
    issues,
    totalAmountMinor,
    sessionSnapshot: session
      ? { id: session.id, startYear: session.startYear, endYear: session.endYear }
      : null,
    configSnapshot,
    inputSnapshot,
  };
}
