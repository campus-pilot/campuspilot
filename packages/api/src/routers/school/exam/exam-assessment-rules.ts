import type { CoScholasticGrades } from '@campuspilot/db/schema/jsonb/exam-config';

/**
 * Which student-wide assessment values may be shown outside result entry.
 * Report cards and the Cadet Portal both use these rules, so a family never
 * sees attendance or activity grades the printed report card would leave out.
 *
 * - Attendance needs session attendance tracking, an approved assessment and
 *   recorded days. Days that do not fit the exam's working days are `invalid`
 *   (the report card refuses to print; the portal shows nothing).
 * - Activity grades need an approved assessment with at least one grade.
 */
type Assessment = {
  approved: boolean;
  daysAttended: number | null;
  coScholastics: CoScholasticGrades | null;
} | null | undefined;

export type ShareableAttendance =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'ok'; daysAttended: number; totalWorkingDays: number };

export function shareableAttendance(
  trackingEnabled: boolean,
  assessment: Assessment,
  totalWorkingDays: number | null | undefined,
): ShareableAttendance {
  if (!trackingEnabled || !assessment?.approved || assessment.daysAttended === null) return { kind: 'none' };
  if (
    totalWorkingDays === null ||
    totalWorkingDays === undefined ||
    totalWorkingDays <= 0 ||
    assessment.daysAttended < 0 ||
    assessment.daysAttended > totalWorkingDays
  )
    return { kind: 'invalid' };
  return { kind: 'ok', daysAttended: assessment.daysAttended, totalWorkingDays };
}

export function shareableCoScholastics(assessment: Assessment): CoScholasticGrades | null {
  return assessment?.approved && assessment.coScholastics && Object.keys(assessment.coScholastics).length
    ? assessment.coScholastics
    : null;
}
