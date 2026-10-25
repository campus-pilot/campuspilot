export type AssessmentRow = {
  id: string;
  planId: string;
  studentId: string;
  approved: boolean | null;
  daysAttended: number | null;
  coScholastic: unknown | null;
};

export type SubjectPlan = {
  id: string;
  examKey: string;
  subjectKey: string;
  totalWorkingDays: number | null;
};

export type AssessmentIssue = {
  code: string;
  key: string;
  message: string;
};

export type WorkingDaysAgreement = {
  examKey: string;
  planIds: string[];
  values: number[];
  agreedTotalWorkingDays: number | null;
};

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
 * Validate legacy subject rows before collapsing them into an exam-wide target
 * assessment. Approval is a subject fact and therefore must exist and agree on
 * every row. Attendance and co-scholastic values are exam-wide legacy facts, so
 * leading nulls may be ignored but all populated values must agree.
 */
export function analyzeAssessments(
  plans: SubjectPlan[],
  rows: AssessmentRow[],
): { issues: AssessmentIssue[]; workingDays: WorkingDaysAgreement[] } {
  const issues: AssessmentIssue[] = [];
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const plansByExam = new Map<string, SubjectPlan[]>();
  for (const plan of plans) {
    const group = plansByExam.get(plan.examKey) ?? [];
    group.push(plan);
    plansByExam.set(plan.examKey, group);
  }

  const workingDays = [...plansByExam.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([examKey, examPlans]) => {
      const values = [...new Set(examPlans.map((plan) => plan.totalWorkingDays))].toSorted(
        (left, right) => (left ?? -1) - (right ?? -1),
      );
      const invalid = values.some((value) => value == null || !Number.isInteger(value) || value < 0);
      if (invalid || values.length !== 1) {
        issues.push({
          code: 'E_TOTAL_WORKING_DAYS_CONFLICT',
          key: examKey,
          message: `Subject plans do not agree on a non-negative integer totalWorkingDays: ${values.join(',')}`,
        });
      }
      return {
        examKey,
        planIds: examPlans.map((plan) => plan.id).toSorted(),
        values: values.filter((value): value is number => value != null),
        agreedTotalWorkingDays: !invalid && values.length === 1 ? values[0]! : null,
      };
    });
  const daysByExam = new Map(workingDays.map((entry) => [entry.examKey, entry.agreedTotalWorkingDays]));

  const groups = new Map<string, AssessmentRow[]>();
  for (const row of rows) {
    const plan = planById.get(row.planId);
    if (!plan) {
      issues.push({ code: 'E_RESULT_PLAN_MISSING', key: row.id, message: `Unknown plan ${row.planId}` });
      continue;
    }
    const key = `${plan.examKey}\u0000${row.studentId}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const [key, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const examKey = key.split('\u0000')[0]!;
    const expected = plansByExam.get(examKey) ?? [];
    const actualPlanIds = group.map((row) => row.planId);
    if (new Set(actualPlanIds).size !== actualPlanIds.length) {
      issues.push({ code: 'E_DUPLICATE_SUBJECT_RESULT', key, message: 'Student has duplicate subject results' });
    }
    const missing = expected.filter((plan) => !actualPlanIds.includes(plan.id));
    if (missing.length) {
      issues.push({
        code: 'E_INCOMPLETE_SUBJECT_SET',
        key,
        message: `Missing subject plans: ${missing.map((plan) => plan.id).toSorted().join(',')}`,
      });
    }

    if (group.some((row) => typeof row.approved !== 'boolean')) {
      issues.push({ code: 'E_APPROVAL_MISSING', key, message: 'Every subject result must contain an approval boolean' });
    } else if (new Set(group.map((row) => row.approved)).size !== 1) {
      issues.push({ code: 'E_APPROVAL_CONFLICT', key, message: 'Subject approval booleans disagree' });
    }

    for (const field of ['daysAttended', 'coScholastic'] as const) {
      const populated = group.filter((row) => row[field] != null).map((row) => row[field]);
      if (new Set(populated.map(stableJson)).size > 1) {
        issues.push({
          code: field === 'daysAttended' ? 'E_ATTENDANCE_CONFLICT' : 'E_CO_SCHOLASTIC_CONFLICT',
          key,
          message: `${field} populated values disagree`,
        });
      }
    }

    const days = group.find((row) => row.daysAttended != null)?.daysAttended;
    if (days != null) {
      const total = daysByExam.get(examKey);
      if (!Number.isInteger(days) || days < 0 || total == null || days > total) {
        issues.push({
          code: 'E_ATTENDANCE_RANGE',
          key,
          message: `daysAttended ${days} must be a non-negative integer no greater than approved totalWorkingDays ${String(total)}`,
        });
      }
    }
  }

  return { issues, workingDays };
}
