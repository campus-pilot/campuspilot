import { z } from 'zod';
import type { ExamPlanDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  SCHOOL_ACTIONS,
  CLASS_ACTIONS,
  type PermissionCheck,
} from '@campuspilot/api/routers/authorization/authorization.dto';
import { schoolSessionHref } from '@/components/school-route';

export type SessionScope = { schoolId: string; sessionId: string };
export type ExamScope = SessionScope & { examSlug: string };
export const toExamScope = ({ schoolId, sessionId, examSlug }: ExamScope) => ({
  schoolId,
  sessionId,
  examSlug,
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
export const optionalIntegerText = z.union([z.literal(''), integerText]);
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
/** Transport/internal failures can follow a committed write. A definitive domain
 * rejection is safe to correct and retry; otherwise reload saved data first.
 */
export function isExamSaveUncertain(error: unknown) {
  return ![
    'BAD_REQUEST',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
  ].includes(errorCode(error) ?? '');
}
export const examClassHref = (scope: ExamScope & { classId: string }) =>
  `${examHref(scope, scope.examSlug)}/classes/${encodeURIComponent(scope.classId)}`;
export const examStudentHref = (
  scope: ExamScope & { classId: string; studentId: string },
) => `${examClassHref(scope)}/students/${encodeURIComponent(scope.studentId)}`;

/** Read the explicit examination state; a generated plan alone is not a start. */
export const examStatusLabel = (
  status: 'ready' | 'active' | 'completed' | null,
) =>
  status === 'active'
    ? 'In progress'
    : status === 'completed'
      ? 'Completed'
      : 'Not started';

/** The explicit exam lifecycle and session activity both gate entry; active
 * subject snapshots alone never mean that the examination has started.
 */
export function isExamResultEntryOpen(
  sessionActive: boolean,
  examStatus: 'ready' | 'active' | 'completed' | null,
  plans: Array<{ status: ExamPlanDto['status'] }>,
) {
  return (
    sessionActive &&
    examStatus === 'active' &&
    plans.length > 0 &&
    plans.every((plan) => plan.status === 'active')
  );
}
export function examClassStatusLabel(
  examStatus: 'ready' | 'active' | 'completed' | null,
  statuses: ExamPlanDto['status'][],
) {
  if (examStatus === 'completed') return 'Completed';
  if (examStatus !== 'active') return 'Not started';
  return statuses.every((status) => status === 'completed')
    ? 'Completed'
    : statuses.every((status) => status === 'active')
      ? 'Entry open'
      : 'Entry not open';
}
