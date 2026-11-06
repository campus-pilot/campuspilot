import type { DatabaseExecutor } from '@campuspilot/db';
import { cadetAccount, cadetUser } from '@campuspilot/db/schema/cadet';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { cadetPlaceholderEmail } from './cadet-policy';
import { generateCadetPassword } from './cadet-password';

/** Better Auth's provider id for password accounts. */
const CREDENTIAL_PROVIDER_ID = 'credential';

export type IssuedCadetLogin = {
  /** The cadet login (`cadet_user.id`). */
  userId: string;
  /** The new plain password. Returned once; only its hash is stored. */
  password: string;
};

/**
 * Issues a new Cadet Portal password for an admission inside the caller's
 * transaction, creating the login on first issue. Only the hash is stored;
 * the login is marked `passwordSource: 'issued'` with `issuedAt` and
 * `issuedBy`. The rows are written with Drizzle rather than through the
 * cadet auth instance so they commit or roll back with the caller's
 * transaction (for example together with a new admission).
 *
 * Hashing uses Better Auth's default password hasher, the same one the
 * cadet instance verifies with at sign-in.
 *
 * This does not sign the student out: the caller revokes existing sessions
 * and grants after its transaction commits (`revokeCadetLoginAccess`).
 */
export async function issueCadetLogin(
  executor: DatabaseExecutor,
  input: { admissionId: string; issuedBy: string; now?: Date },
): Promise<IssuedCadetLogin> {
  const now = input.now ?? new Date();
  const password = generateCadetPassword();
  const passwordHash = await hashPassword(password);

  // ON CONFLICT locks an existing login row, so concurrent issues for one
  // admission serialise here and the account write below never races.
  const [login] = await executor
    .insert(cadetUser)
    .values({
      id: randomUUID(),
      email: cadetPlaceholderEmail(input.admissionId),
      admissionId: input.admissionId,
      passwordSource: 'issued',
      issuedAt: now,
      issuedBy: input.issuedBy,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cadetUser.admissionId,
      set: {
        passwordSource: 'issued',
        issuedAt: now,
        issuedBy: input.issuedBy,
        updatedAt: now,
      },
    })
    .returning({ id: cadetUser.id });
  if (!login) throw new Error('Cadet login was not written.');

  const updated = await executor
    .update(cadetAccount)
    .set({ password: passwordHash, updatedAt: now })
    .where(
      and(
        eq(cadetAccount.userId, login.id),
        eq(cadetAccount.providerId, CREDENTIAL_PROVIDER_ID),
        eq(cadetAccount.accountId, login.id),
      ),
    )
    .returning({ id: cadetAccount.id });
  if (updated.length === 0) {
    await executor.insert(cadetAccount).values({
      id: randomUUID(),
      // Better Auth identifies a credential account by the user's own id.
      accountId: login.id,
      providerId: CREDENTIAL_PROVIDER_ID,
      userId: login.id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { userId: login.id, password };
}

/** The cadet login of an admission, or null when none was ever issued. */
export async function findCadetLoginId(
  executor: DatabaseExecutor,
  admissionId: string,
): Promise<string | null> {
  const [login] = await executor
    .select({ id: cadetUser.id })
    .from(cadetUser)
    .where(eq(cadetUser.admissionId, admissionId))
    .limit(1);
  return login?.id ?? null;
}
