import {
  SCHOOL_NO_PLAN_MESSAGE,
  SCHOOL_NO_PLAN_REASON,
  SCHOOL_SUSPENDED_MESSAGE,
  SCHOOL_SUSPENDED_REASON,
  type SchoolWriteRefusalReason,
} from '@campuspilot/api/school-access/school-access.contract';

/**
 * Why the school is read-only for its staff, from the two facts the school
 * list carries (docs/school-suspension.md, docs/school-trials.md), or null
 * when it is not. A suspension wins, as it does on the server.
 */
export function readOnlySchoolReason(school: { isSuspended: boolean; hasActivePlan: boolean }): SchoolWriteRefusalReason | null {
  if (school.isSuspended) return SCHOOL_SUSPENDED_REASON;
  if (!school.hasActivePlan) return SCHOOL_NO_PLAN_REASON;
  return null;
}

/** The permanent warning for each reason: the server's own message. */
export const READ_ONLY_SCHOOL_MESSAGES = {
  SCHOOL_SUSPENDED: SCHOOL_SUSPENDED_MESSAGE,
  SCHOOL_NO_PLAN: SCHOOL_NO_PLAN_MESSAGE,
} as const satisfies Record<SchoolWriteRefusalReason, string>;

/** How long before its end a trial is announced. */
export const TRIAL_ENDING_NOTICE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const trialEndFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

/**
 * The informational notice in a trial's last {@link TRIAL_ENDING_NOTICE_DAYS}
 * days, or null at any other time and when no trial gives the school its
 * plan (`trialEndsAt` null). The day is shown in IST, like the rest of the
 * platform.
 */
export function trialEndingNotice(trialEndsAt: string | null, now: Date = new Date()): string | null {
  if (trialEndsAt === null) return null;
  const end = new Date(trialEndsAt);
  const left = end.getTime() - now.getTime();
  if (left <= 0 || left > TRIAL_ENDING_NOTICE_DAYS * DAY_MS) return null;
  return `Your trial ends on ${trialEndFormatter.format(end)}. Contact CampusPilot to keep using these features.`;
}
