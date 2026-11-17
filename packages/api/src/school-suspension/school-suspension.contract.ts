import { z } from 'zod';

/**
 * The suspended-school error contract, importable by the browser apps (Zod
 * only; see docs/school-suspension.md).
 *
 * `data.reason` of the FORBIDDEN error every API surface (staff RPC, cadet
 * RPC, upload routes, the assistant) throws when a change is asked of a
 * suspended school. It is a stable contract: clients tell "the school is
 * suspended" from "you lack permission" and from "the feature is off" by
 * this value, never by the message.
 */
export const SCHOOL_SUSPENDED_REASON = 'SCHOOL_SUSPENDED';

/** What a member of a suspended school is told, in every app. The administrator's reason is never part of it. */
export const SCHOOL_SUSPENDED_MESSAGE =
  'This school is suspended. You can still view everything, but nothing can be changed. Contact CampusPilot support.';

/** `data` of the suspended-school FORBIDDEN error. */
export const schoolSuspendedDataSchema = z.object({
  reason: z.literal(SCHOOL_SUSPENDED_REASON),
});
export type SchoolSuspendedData = z.infer<typeof schoolSuspendedDataSchema>;

/**
 * Whether a caught API error is the suspended-school refusal. Works on the
 * server's `ORPCError` and on the client's deserialized copy alike (both
 * expose `code` and `data`).
 */
export function isSchoolSuspendedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error) || error.code !== 'FORBIDDEN') return false;
  if (!('data' in error)) return false;
  return schoolSuspendedDataSchema.safeParse(error.data).success;
}
