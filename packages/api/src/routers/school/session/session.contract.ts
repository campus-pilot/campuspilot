import { z } from 'zod';

/**
 * The contract of the refusals of `school.updateSession` that a client acts
 * on, importable by the browser apps (Zod only).
 *
 * `updateSession` replaces the whole `sessionConfig` it is given. A caller
 * that edits a copy of the configuration (the session settings screen) sends
 * `expectedUpdatedAt`, the `updatedAt` of the session its copy was read from.
 * When the stored session has been written since (an exam created from the
 * Examinations list or by an MCP client, a rename, another settings save),
 * the save is refused with CONFLICT carrying `data.reason: 'SESSION_STALE'`
 * and nothing is written, so a stale copy never silently drops what was
 * written meanwhile. The caller reads the session again and lets the user
 * review the latest settings before saving again.
 *
 * CONFLICT alone does not mean that: `updateSession` also answers CONFLICT
 * for an inactive session, a taken exam name, an exam that cannot be removed
 * and database conflicts (`toRpcError`). Clients tell a stale save from those
 * by this reason (`isSessionStaleError`), never by the code or the message.
 */
export const SESSION_STALE_REASON = 'SESSION_STALE';

/** What the caller is told when the session changed after its copy was read. */
export const SESSION_STALE_MESSAGE =
  'This session was changed after you loaded it. Load the latest settings, review them and save again.';

/** `data` of the stale-save CONFLICT error. */
export const sessionStaleDataSchema = z.object({
  reason: z.literal(SESSION_STALE_REASON),
});
export type SessionStaleData = z.infer<typeof sessionStaleDataSchema>;

/**
 * Whether a caught API error is the refusal of a save based on an outdated
 * copy of the session. Works on the server's `ORPCError` and on the client's
 * deserialized copy alike (both expose `code` and `data`).
 */
export function isSessionStaleError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error) || error.code !== 'CONFLICT') return false;
  if (!('data' in error)) return false;
  return sessionStaleDataSchema.safeParse(error.data).success;
}

/**
 * The version token of a session as `expectedUpdatedAt` carries it: its
 * `updatedAt` as an ISO 8601 instant, or null for a session whose
 * `updatedAt` was never set. Accepts the `Date` the RPC client returns and
 * the ISO string a JSON client sees, so every caller derives the token the
 * same way. Compared at millisecond precision, the precision the API returns.
 */
export function sessionVersionToken(
  updatedAt: Date | string | null | undefined,
): string | null {
  if (updatedAt === null || updatedAt === undefined) return null;
  return new Date(updatedAt).toISOString();
}
