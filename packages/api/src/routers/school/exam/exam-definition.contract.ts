import { z } from 'zod';

/**
 * The contract of the refusals of the exam definition procedures, importable
 * by the browser apps (Zod only).
 *
 * `createExam` refuses a slug the session already has with CONFLICT carrying
 * `data.reason: 'EXAM_SLUG_TAKEN'`. CONFLICT alone does not mean that: the
 * shared error mapping (`toRpcError`) also answers CONFLICT for database
 * unique violations, serialization failures and deadlocks. Clients tell a
 * taken slug from those by this reason, never by the code or the message.
 */
export const EXAM_SLUG_TAKEN_REASON = 'EXAM_SLUG_TAKEN';

/** What the caller is told when the session already has an exam with the slug. */
export const EXAM_SLUG_TAKEN_MESSAGE =
  'An exam with this slug already exists in the session.';

/** `data` of the taken-slug CONFLICT error. */
export const examSlugTakenDataSchema = z.object({
  reason: z.literal(EXAM_SLUG_TAKEN_REASON),
});
export type ExamSlugTakenData = z.infer<typeof examSlugTakenDataSchema>;

/**
 * Whether a caught API error is the refusal of a slug the session already
 * has. Works on the server's `ORPCError` and on the client's deserialized
 * copy alike (both expose `code` and `data`).
 */
export function isExamSlugTakenError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error) || error.code !== 'CONFLICT') return false;
  if (!('data' in error)) return false;
  return examSlugTakenDataSchema.safeParse(error.data).success;
}
