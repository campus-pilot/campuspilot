import { z } from 'zod';

/**
 * The contract of the errors that refuse a change to a read-only school,
 * importable by the browser apps (Zod only; see docs/school-suspension.md and
 * docs/school-billing.md).
 *
 * A school is read-only for two separate reasons, each its own fact: an
 * administrator suspended it (`SCHOOL_SUSPENDED`), or it has no active plan,
 * neither a subscription nor an active trial (`SCHOOL_NO_PLAN`). Every API
 * surface (staff RPC, cadet RPC, upload routes, the assistant) refuses a
 * change with FORBIDDEN carrying one of these as `data.reason`. It is a
 * stable contract: clients tell these refusals from "you lack permission"
 * and from "the feature is off" by this value, never by the message.
 */
export const SCHOOL_SUSPENDED_REASON = 'SCHOOL_SUSPENDED';

/** `data.reason` of the refusal for a school without an active plan. */
export const SCHOOL_NO_PLAN_REASON = 'SCHOOL_NO_PLAN';

/** Why a change to a school is refused, when it is; a suspension wins over a missing plan. */
export const SCHOOL_WRITE_REFUSAL_REASONS = [SCHOOL_SUSPENDED_REASON, SCHOOL_NO_PLAN_REASON] as const;
export type SchoolWriteRefusalReason = (typeof SCHOOL_WRITE_REFUSAL_REASONS)[number];

/** What a member of a suspended school is told, in every app. The administrator's reason is never part of it. */
export const SCHOOL_SUSPENDED_MESSAGE =
  'This school is suspended. You can still view everything, but nothing can be changed. Contact CampusPilot support.';

/** What a member of a school without an active plan is told. */
export const SCHOOL_NO_PLAN_MESSAGE =
  'This school has no active plan, so it is blocked: nothing can be changed and the features of a plan are off. Contact CampusPilot to continue.';

/** The message of each refusal, as the server sends it. */
export const SCHOOL_WRITE_REFUSAL_MESSAGES = {
  SCHOOL_SUSPENDED: SCHOOL_SUSPENDED_MESSAGE,
  SCHOOL_NO_PLAN: SCHOOL_NO_PLAN_MESSAGE,
} as const satisfies Record<SchoolWriteRefusalReason, string>;

/** `data` of the read-only school FORBIDDEN error. */
export const schoolWriteRefusedDataSchema = z.object({
  reason: z.enum(SCHOOL_WRITE_REFUSAL_REASONS),
});
export type SchoolWriteRefusedData = z.infer<typeof schoolWriteRefusedDataSchema>;

/**
 * Why a caught API error refused a change to a read-only school, or null
 * when it is any other error. Works on the server's `ORPCError` and on the
 * client's deserialized copy alike (both expose `code` and `data`).
 */
export function schoolWriteRefusalOf(error: unknown): SchoolWriteRefusalReason | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('code' in error) || error.code !== 'FORBIDDEN') return null;
  if (!('data' in error)) return null;
  const parsed = schoolWriteRefusedDataSchema.safeParse(error.data);
  return parsed.success ? parsed.data.reason : null;
}

/** Whether a caught API error is the suspended-school refusal. */
export function isSchoolSuspendedError(error: unknown): boolean {
  return schoolWriteRefusalOf(error) === SCHOOL_SUSPENDED_REASON;
}

/** Whether a caught API error is the refusal for a school without an active plan. */
export function isSchoolNoPlanError(error: unknown): boolean {
  return schoolWriteRefusalOf(error) === SCHOOL_NO_PLAN_REASON;
}
