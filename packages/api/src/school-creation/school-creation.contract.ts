import { z } from 'zod';

import type { SchoolTier } from '@campuspilot/db/feature-flags/catalogue';

/**
 * The contract of self-service school creation (docs/school-creation.md),
 * importable by the browser apps (Zod only).
 *
 * Whether a person may create a school is decided from separate facts, each
 * read on its own, in this order (the first that applies is the refusal):
 *
 * 1. `demo_account`: the account exists only for a demo school
 *    (`user.demo_school_id`).
 * 2. `unverified_email`: the account has no verified, real email address. An
 *    email sign-up is never verified (CampusPilot sends no verification mail),
 *    so in practice a new owner signs in with Google. This makes every
 *    allowance cost a real mailbox rather than a typed address.
 * 3. `member_of_other_school`: the person belongs to a school they do not own
 *    (they were invited as principal, manager, teacher or any other role). Staff
 *    of a school do not open schools of their own.
 * 4. `limit_reached`: the person already created as many schools as their
 *    allowance (`user.school_creation_limit`), counting every school they ever
 *    created, including ones deleted, handed over or left since.
 */
export const SCHOOL_CREATION_REFUSALS = [
  'demo_account',
  'unverified_email',
  'member_of_other_school',
  'limit_reached',
] as const;
export const schoolCreationRefusalSchema = z.enum(SCHOOL_CREATION_REFUSALS);
export type SchoolCreationRefusal = z.infer<typeof schoolCreationRefusalSchema>;

/** What the person is told for each refusal, in every app and in the API error. */
export const SCHOOL_CREATION_REFUSAL_MESSAGES = {
  demo_account: 'Demo accounts cannot create schools.',
  unverified_email:
    'Sign in with Google (or an email address CampusPilot has verified) to create a school.',
  member_of_other_school:
    'You are a member of a school you do not own, so you cannot create a school. Schools are created by their owners.',
  limit_reached:
    'You have created as many schools as your account allows. Request more schools to create another.',
} as const satisfies Record<SchoolCreationRefusal, string>;

/** `data.reason` of the FORBIDDEN error that refuses creating a school. */
export const SCHOOL_CREATION_REFUSED_REASON = 'SCHOOL_CREATION_REFUSED';

export const schoolCreationRefusedDataSchema = z.object({
  reason: z.literal(SCHOOL_CREATION_REFUSED_REASON),
  refusal: schoolCreationRefusalSchema,
});

/** The refusal a caught API error carries, or null for any other error. */
export function schoolCreationRefusalOf(error: unknown): SchoolCreationRefusal | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('code' in error) || error.code !== 'FORBIDDEN') return null;
  if (!('data' in error)) return null;
  const parsed = schoolCreationRefusedDataSchema.safeParse(error.data);
  return parsed.success ? parsed.data.refusal : null;
}

/** The highest total a person may ask for in one request; anything above is arranged with CampusPilot directly. */
export const MAX_REQUESTED_SCHOOL_LIMIT = 20;

/** The highest allowance an administrator may grant from the admin app. */
export const MAX_GRANTED_SCHOOL_LIMIT = 100;

/** Bounds of the reason a person gives for more schools. */
export const SCHOOL_REQUEST_REASON_MIN = 20;
export const SCHOOL_REQUEST_REASON_MAX = 1000;

/**
 * The tier of the trial a self-created school starts on: Plus, the smallest
 * tier. Stated here rather than derived from the tier order, so adding a
 * lower tier later does not silently change what new schools get.
 */
export const SELF_SERVICE_TRIAL_TIER: SchoolTier = 'plus';

/** How long that trial runs, in 28-day billing periods (docs/school-billing.md). */
export const SELF_SERVICE_TRIAL_PERIODS = 1;

/**
 * The AI assistant's spend limit per billing period, in USD, a self-created
 * school gets (the feature's `monthlyLimitUsd`, which counts per billing
 * period once the school has one). The assistant is an add-on on every tier
 * (docs/feature-flags.md), so a new school has it switched on with this
 * limit; an administrator changes it on the school's AI page.
 */
export const SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD = 5;
