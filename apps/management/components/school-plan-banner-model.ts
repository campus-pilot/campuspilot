import {
  SCHOOL_NO_PLAN_MESSAGE,
  SCHOOL_NO_PLAN_REASON,
  SCHOOL_SUSPENDED_MESSAGE,
  SCHOOL_SUSPENDED_REASON,
  type SchoolWriteRefusalReason,
} from '@campuspilot/api/school-access/school-access.contract';

/**
 * Why the school is read-only for its staff, from the two facts the school
 * list carries (docs/school-suspension.md, docs/school-billing.md), or null
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

/** How long before its end the plan's coverage is announced. */
export const PLAN_ENDING_NOTICE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const planEndFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

/** What the school list says about the plan, for {@link planEndingNotice}. */
export type PlanEndingFacts = {
  /** When the billing periods giving the plan run out; null when a standing tier gives it or there is none. */
  planEndsAt: string | null;
  planSource: 'standing' | 'trial' | 'paid' | 'complimentary' | null;
  /** The school keeps a standing tier after its periods run out. */
  hasSubscription: boolean;
};

/**
 * The informational notice in the last {@link PLAN_ENDING_NOTICE_DAYS} days
 * of the billing periods that give the school its plan
 * (docs/school-billing.md), or null at any other time and when they do not
 * give it. A payment made ahead moves `planEndsAt`, so a school that renewed
 * early is not told. The day is shown in IST, like the rest of the platform.
 * There is no grace period: a school without a standing tier is told it is
 * blocked from that day; one with a standing tier only loses what the
 * periods added.
 */
export function planEndingNotice(facts: PlanEndingFacts, now: Date = new Date()): string | null {
  if (facts.planEndsAt === null) return null;
  const end = new Date(facts.planEndsAt);
  const left = end.getTime() - now.getTime();
  if (left <= 0 || left > PLAN_ENDING_NOTICE_DAYS * DAY_MS) return null;
  const day = planEndFormatter.format(end);
  const lead =
    facts.planSource === 'trial'
      ? `Your free trial ends on ${day}.`
      : facts.planSource === 'paid'
        ? `Your plan is paid until ${day}.`
        : `Your plan runs until ${day}.`;
  return facts.hasSubscription
    ? `${lead} Contact CampusPilot to keep using these features.`
    : `${lead} After that the school is blocked until the next payment. Contact CampusPilot to pay for the next period.`;
}
