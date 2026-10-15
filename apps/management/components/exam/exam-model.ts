import { z } from 'zod';
import type {
  ExamContextDto,
  ExamPlanDto,
  ExamResultDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  SCHOOL_ACTIONS,
  CLASS_ACTIONS,
  type PermissionCheck,
} from '@campuspilot/api/routers/authorization/authorization.dto';
import { schoolSessionHref } from '@/components/school-route';

export type SessionScope = { schoolId: string; sessionId: string };
export type ExamScope = SessionScope & { examSlug: string };
export type PlanRouteScope = ExamScope & {
  classId: string;
  examPlanId: string;
};
export type StudentRouteScope = PlanRouteScope & { studentId: string };

/** Route slugs provide display context, but plan/result procedure keys use only their own independent scope. */
export const toSessionScope = ({ schoolId, sessionId }: SessionScope) => ({
  schoolId,
  sessionId,
});
export const toExamScope = ({ schoolId, sessionId, examSlug }: ExamScope) => ({
  schoolId,
  sessionId,
  examSlug,
});
export const toPlanScope = ({
  schoolId,
  sessionId,
  classId,
  examPlanId,
}: PlanRouteScope) => ({ schoolId, sessionId, classId, examPlanId });
export const toResultScope = (scope: StudentRouteScope) => ({
  ...toPlanScope(scope),
  studentId: scope.studentId,
});

export type SchoolAction = (typeof SCHOOL_ACTIONS)[keyof typeof SCHOOL_ACTIONS];
/** Generated authorization types distribute each action separately; all typed school actions share the school resource shape. */
export const schoolPermission = (
  schoolId: string,
  action: SchoolAction,
): PermissionCheck =>
  ({ action, resource: { kind: 'school', schoolId } }) as PermissionCheck;
export const approvalPermission = (
  schoolId: string,
  classId: string,
): PermissionCheck => ({
  action: CLASS_ACTIONS.APPROVE_EXAM_RESULTS,
  resource: { kind: 'class', schoolId, classId },
});
export const examHref = (scope: SessionScope, slug?: string) =>
  schoolSessionHref(
    scope.schoolId,
    scope.sessionId,
    `/exam${slug === undefined ? '' : `/${encodeURIComponent(slug)}`}`,
  );
export const planHref = (scope: PlanRouteScope) =>
  `${examHref(scope, scope.examSlug)}/classes/${encodeURIComponent(scope.classId)}/plans/${encodeURIComponent(scope.examPlanId)}`;
export const studentHref = (scope: StudentRouteScope) =>
  `${planHref(scope)}/students/${encodeURIComponent(scope.studentId)}`;
export const planLabels = {
  draft: 'Draft',
  approved: 'Plan approved',
  active: 'Marks entry open',
  completed: 'Completed · Read-only',
};
export const nextTransition = {
  draft: {
    status: 'approved',
    label: 'Approve plan',
    explanation:
      'Review the components and maxima before approving. Marks entry remains closed.',
  },
  approved: {
    status: 'active',
    label: 'Open marks entry',
    explanation:
      'This locks assessment configuration and allows staff to enter results. A timetable is optional.',
  },
  active: {
    status: 'completed',
    label: 'Complete plan',
    explanation:
      'Every registered student must have an approved result. Completion makes results and the shared timetable read-only.',
  },
  completed: {
    status: 'active',
    label: 'Reopen marks entry',
    explanation:
      'Existing approvals are preserved. Assessment configuration stays locked.',
  },
} as const;
export function planNames(context: ExamContextDto, plan: ExamPlanDto) {
  const schoolClass = context.classes.find((item) => item.id === plan.classId);
  const subject = schoolClass?.subjects[plan.subjectSlug];
  return {
    className: schoolClass?.label ?? plan.classId,
    subjectName: subject?.name ?? plan.subjectSlug,
    modeNames: Object.fromEntries(
      Object.entries(subject?.examModes ?? {}).map(([slug, mode]) => [
        slug,
        mode.name,
      ]),
    ),
  };
}
export const numericText = z
  .string()
  .refine(
    (value) =>
      value.trim() !== '' &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) &&
      Number.isFinite(Number(value)),
    'Enter a decimal number',
  );
export const integerText = numericText.refine(
  (value) =>
    Number.isInteger(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= 2147483647,
  'Enter a nonnegative whole number up to 2147483647',
);
export const positiveIntegerText = integerText.refine(
  (value) => Number(value) > 0,
  'Enter a positive whole number',
);
export const optionalIntegerText = z.union([z.literal(''), integerText]);
export const nullableNumber = (value: string) =>
  value.trim() === '' ? null : Number(value);
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The request could not be completed. Please review and try again.';
}
export function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : undefined;
}
export function resultDefaults(
  plan: ExamPlanDto,
  context: ExamContextDto,
  result: ExamResultDto | null,
) {
  return {
    marks: Object.keys(plan.modeConfig).map((slug) => ({
      slug,
      value:
        result?.marks[slug] === undefined ? '' : String(result.marks[slug]),
    })),
    grades: [
      ...new Set([
        ...Object.keys(context.coScholasticAreas),
        ...Object.keys(result?.coScholastics ?? {}),
      ]),
    ].map((slug) => ({ slug, value: result?.coScholastics?.[slug] ?? '' })),
    daysAttended:
      result?.daysAttended == null ? '' : String(result.daysAttended),
    approved: result?.approved ?? false,
    preview: false,
  };
}
/** Blank input stays blank until validation; maxima are already weighted and never weighted a second time. */
export function resultFormSchema(plan: ExamPlanDto, context: ExamContextDto) {
  return z
    .object({
      marks: z.array(z.object({ slug: z.string(), value: numericText })),
      grades: z.array(
        z.object({ slug: z.string(), value: z.string().trim().max(100) }),
      ),
      daysAttended: optionalIntegerText,
      approved: z.boolean(),
      preview: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const keys = Object.keys(plan.modeConfig);
      if (
        value.marks.length !== keys.length ||
        new Set(value.marks.map((item) => item.slug)).size !== keys.length
      )
        ctx.addIssue({
          code: 'custom',
          path: ['marks'],
          message: 'Every assessment component is required exactly once',
        });
      value.marks.forEach((item, index) => {
        const mode = plan.modeConfig[item.slug];
        if (
          !mode ||
          Number(item.value) < 0 ||
          Number(item.value) > mode.maxMarks
        )
          ctx.addIssue({
            code: 'custom',
            path: ['marks', index, 'value'],
            message: `Enter a score from 0 to ${mode?.maxMarks ?? 0}`,
          });
      });
      value.grades.forEach((item, index) => {
        if (item.value.trim() && !context.coScholasticAreas[item.slug])
          ctx.addIssue({
            code: 'custom',
            path: ['grades', index, 'value'],
            message:
              'This historical area is no longer configured. Explicitly clear this grade or restore the configuration before saving.',
          });
      });
      if (
        value.daysAttended !== '' &&
        (!context.attendanceTracking.enabled ||
          plan.totalWorkingDays === null ||
          Number(value.daysAttended) > plan.totalWorkingDays)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['daysAttended'],
          message:
            'Attendance requires tracking and configured working days; it cannot exceed working days. Explicitly clear historical attendance if tracking is disabled.',
        });
    });
}
export function resultPayload(value: ReturnType<typeof resultDefaults>) {
  const grades = Object.fromEntries(
    value.grades
      .filter((item) => item.value.trim())
      .map((item) => [item.slug, item.value.trim()]),
  );
  return {
    marks: Object.fromEntries(
      value.marks.map((item) => [item.slug, Number(item.value)]),
    ),
    coScholastics: Object.keys(grades).length ? grades : null,
    daysAttended: nullableNumber(value.daysAttended),
    approved: value.approved,
  };
}
