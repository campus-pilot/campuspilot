import { z } from 'zod';

/**
 * The exam name rule (`examNameKey`, `findExamNameClash`), re-exported so the
 * browser apps, which do not depend on `@campuspilot/db`, apply the server's
 * own comparison. The module is pure (Zod only).
 */
export {
  examNameKey,
  findExamNameClash,
} from '@campuspilot/db/schema/jsonb/session-config';

/**
 * The contract of the refusals of the exam definition procedures, importable
 * by the browser apps (Zod only).
 *
 * `createExam` refuses a slug the session already has with CONFLICT carrying
 * `data.reason: 'EXAM_SLUG_TAKEN'`. CONFLICT alone does not mean that: the
 * shared error mapping (`toRpcError`) also answers CONFLICT for database
 * unique violations, serialization failures and deadlocks. Clients tell a
 * taken slug from those by this reason, never by the code or the message.
 *
 * Exam names are unique within a session (compared by `examNameKey`: trimmed,
 * ignoring case). `createExam`, a rename through `updateExam`, and a session
 * configuration save (`createSession`, `updateSession`) that introduces a
 * clash are refused with CONFLICT carrying `data.reason: 'EXAM_NAME_TAKEN'`,
 * told apart the same way (`isExamNameTakenError`). `createExam` checks the
 * slug first, so a request whose slug and name are both taken is refused as a
 * taken slug.
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

export const EXAM_NAME_TAKEN_REASON = 'EXAM_NAME_TAKEN';

/** What the caller is told when another exam of the session has the name. */
export const EXAM_NAME_TAKEN_MESSAGE =
  'Another exam in the session already has this name.';

/** `data` of the taken-name CONFLICT error. */
export const examNameTakenDataSchema = z.object({
  reason: z.literal(EXAM_NAME_TAKEN_REASON),
});
export type ExamNameTakenData = z.infer<typeof examNameTakenDataSchema>;

/**
 * Whether a caught API error is the refusal of a name another exam of the
 * session already has. Works on the server's `ORPCError` and on the client's
 * deserialized copy alike (both expose `code` and `data`).
 */
export function isExamNameTakenError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error) || error.code !== 'CONFLICT') return false;
  if (!('data' in error)) return false;
  return examNameTakenDataSchema.safeParse(error.data).success;
}
