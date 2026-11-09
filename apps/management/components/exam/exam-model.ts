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

/** Active and completed examinations have both crossed the explicit start
 * transition. A generated plan or ready state does not make results available.
 */
export function hasExamStarted(
  status: 'ready' | 'active' | 'completed' | null,
) {
  return status === 'active' || status === 'completed';
}

/** Report cards are final documents and become available only after the
 * examination has completed, independently of plan or result counts.
 */
export function canCreateExamReportCards(
  status: 'ready' | 'active' | 'completed' | null,
) {
  return status === 'completed';
}

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

type CadetOverview = {
  status: 'ready' | 'active' | 'completed' | null;
  cadetReleasedAt: Date | string | null;
};

/** Teacher remarks can be written once the examination has started (also after
 * completion) in the active session, and are locked while the results are
 * released to the Cadet Portal. The server enforces the same rule.
 */
export function isRemarkEditable(sessionActive: boolean, overview: CadetOverview | undefined) {
  return sessionActive && hasExamStarted(overview?.status ?? null) && !overview?.cadetReleasedAt;
}

/** Which Cadet Portal action applies, or null when none does. Release needs a
 * completed examination; a released one can always be withdrawn. Session
 * activity does not matter: earlier years can be released for Growth.
 */
export function cadetReleaseAction(overview: CadetOverview): 'release' | 'withdraw' | null {
  if (overview.cadetReleasedAt) return 'withdraw';
  return overview.status === 'completed' ? 'release' : null;
}

export type ExamDialogAction = 'working-days' | 'start' | 'complete' | 'reopen' | 'release' | 'withdraw';

/** Full labels used in Settings and dialog titles; `compact` gives the short navbar wording that fits a phone. */
export function examActionLabel(action: Exclude<ExamDialogAction, 'working-days'>, compact = false) {
  if (compact && action === 'release') return 'Release to Cadet';
  if (compact && action === 'withdraw') return 'Withdraw from Cadet';
  return {
    start: 'Start examination',
    complete: 'Complete examination',
    reopen: 'Reopen examination',
    release: 'Release results to Cadet Portal',
    withdraw: 'Withdraw from Cadet Portal',
  }[action];
}

/** Why Reopen is unavailable, or null when it is available. Release blocks it on the server too. */
export function reopenBlockedReason(overview: CadetOverview) {
  return overview.cadetReleasedAt ? 'Withdraw from Cadet Portal before reopening.' : null;
}

/** What each confirmation dialog tells the user before they confirm. */
export function examActionDescription(action: ExamDialogAction, released: boolean) {
  switch (action) {
    case 'working-days':
      return 'Set the maximum number of attendance days for this examination.';
    case 'start':
      return 'Start result entry for every class. Only the principal, manager or exam coordinator can start an examination.';
    case 'complete':
      return 'All student results must be approved. Completing the examination makes results and timetable read-only.';
    case 'reopen':
      return released
        ? 'These results are visible to students in the Cadet Portal. Withdraw them from the Cadet Portal before reopening the examination.'
        : 'Reopen result entry for every class. Saved marks and approvals are preserved.';
    case 'release':
      return 'Students and guardians will see their marks, grades, attendance, activities and teacher remarks for this examination in the Cadet Portal. Remarks are locked while released, and the examination cannot be reopened until you withdraw it.';
    case 'withdraw':
      return 'Students will no longer see this examination’s results in the Cadet Portal. Saved results and remarks are not changed.';
  }
}
