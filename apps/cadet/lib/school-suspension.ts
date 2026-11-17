import { isSchoolSuspendedError } from '@campuspilot/api/school-suspension/school-suspension.contract';

/**
 * What a student is told while their school is suspended
 * (docs/school-suspension.md), on the portal's notice and wherever a change
 * they asked for was refused. Students contact their school, not
 * CampusPilot: it is the school's staff who are told to contact support.
 */
export const CADET_SCHOOL_SUSPENDED_MESSAGE =
  'Your school is suspended. You can still view everything, but nothing can be changed. Contact your school.';

/**
 * The words for a failed change: the suspended-school message when that is
 * why the server refused it, otherwise `fallback`. The server's own message
 * is written for the school's staff, so the portal says its own.
 */
export function suspendedOr(error: unknown, fallback: string): string {
  return isSchoolSuspendedError(error) ? CADET_SCHOOL_SUSPENDED_MESSAGE : fallback;
}
