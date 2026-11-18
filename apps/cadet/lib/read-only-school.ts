import {
  SCHOOL_NO_PLAN_REASON,
  SCHOOL_SUSPENDED_REASON,
  schoolWriteRefusalOf,
  type SchoolWriteRefusalReason,
} from '@campuspilot/api/school-access/school-access.contract';

/**
 * What a student is told while their school is read-only: suspended
 * (docs/school-suspension.md) or without an active plan
 * (docs/school-billing.md), on the portal's notice and wherever a change they
 * asked for was refused. Students contact their school, not CampusPilot: it
 * is the school's staff who are told to contact CampusPilot.
 */
export const CADET_SCHOOL_SUSPENDED_MESSAGE =
  'Your school is suspended. You can still view everything, but nothing can be changed. Contact your school.';

export const CADET_SCHOOL_NO_PLAN_MESSAGE = "Your school's plan has ended, so the portal is blocked. Contact your school.";

/** The notice's title and text for each reason. */
export const CADET_READ_ONLY_SCHOOL_NOTICES = {
  SCHOOL_SUSPENDED: { title: 'School suspended', message: CADET_SCHOOL_SUSPENDED_MESSAGE },
  SCHOOL_NO_PLAN: { title: 'School plan ended', message: CADET_SCHOOL_NO_PLAN_MESSAGE },
} as const satisfies Record<SchoolWriteRefusalReason, { title: string; message: string }>;

/**
 * Why the school is read-only, from the two facts `getSchool` carries, or
 * null when it is not. A suspension wins, as it does on the server.
 */
export function readOnlySchoolReason(school: { isSuspended: boolean; hasActivePlan: boolean }): SchoolWriteRefusalReason | null {
  if (school.isSuspended) return SCHOOL_SUSPENDED_REASON;
  if (!school.hasActivePlan) return SCHOOL_NO_PLAN_REASON;
  return null;
}

/**
 * The words for a failed change: the read-only school message when that is
 * why the server refused it, otherwise `fallback`. The server's own message
 * is written for the school's staff, so the portal says its own.
 */
export function readOnlyOr(error: unknown, fallback: string): string {
  const reason = schoolWriteRefusalOf(error);
  return reason === null ? fallback : CADET_READ_ONLY_SCHOOL_NOTICES[reason].message;
}
