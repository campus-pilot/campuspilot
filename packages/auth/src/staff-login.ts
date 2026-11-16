import type { DatabaseExecutor } from '@campuspilot/db';
import {
  account,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  user,
} from '@campuspilot/db/schema/auth';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { generateCadetPassword } from './cadet-password';
import { auth, authDb } from './server';
import { STAFF_PLACEHOLDER_EMAIL_DOMAIN } from './staff-login-policy';

/** Better Auth's provider id for password accounts. */
const CREDENTIAL_PROVIDER_ID = 'credential';

type StaffAuth = typeof auth;

/**
 * A fresh placeholder email for a staff account created by phone number
 * alone. Better Auth requires a unique, non-null email; the random local part
 * carries no personal data and the `.invalid` domain never delivers. The
 * account is also marked `emailIsPlaceholder`, which is what every reader
 * checks; nothing infers it from this domain.
 */
export function staffPlaceholderEmail(): string {
  return `${randomUUID()}@${STAFF_PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * A password for staff to hand over, in the same `word-word-NN` format as
 * Cadet Portal passwords (for example `happy-tiger-27`): easy to read out or
 * write down, and always longer than the eight-character minimum.
 */
export function generateStaffPassword(): string {
  return generateCadetPassword();
}

/**
 * Sets a staff account's password inside the caller's transaction, creating
 * the credential account when the person had none (for example someone who
 * only ever signed in with Google). Phone and email sign-in share this one
 * credential, so the same password works for both.
 *
 * Written with Drizzle rather than through the auth instance so it commits
 * or rolls back with the caller (for example together with a new user).
 * Hashing uses Better Auth's default hasher, the one sign-in verifies with.
 *
 * Locks the user row first, so concurrent sets for one person run one after
 * the other: `account` has no unique key on the credential, and two
 * first-time sets would otherwise both insert one, leaving one issued
 * password that never works.
 *
 * This does not sign anyone out: callers run `revokeStaffAccess` after their
 * transaction commits.
 */
export async function setStaffPassword(
  executor: DatabaseExecutor,
  input: { userId: string; password: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const passwordHash = await hashPassword(input.password);
  await executor
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, input.userId))
    .for('update');
  const updated = await executor
    .update(account)
    .set({ password: passwordHash, updatedAt: now })
    .where(
      and(
        eq(account.userId, input.userId),
        eq(account.providerId, CREDENTIAL_PROVIDER_ID),
      ),
    )
    .returning({ id: account.id });
  if (updated.length > 0) return;

  await executor.insert(account).values({
    id: randomUUID(),
    // Better Auth identifies a credential account by the user's own id.
    accountId: input.userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    userId: input.userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Signs staff accounts out everywhere after a password was set for them:
 * every session (through the auth instance, so the Redis copies go too) and
 * every AI-app (MCP) connection, by deleting its access tokens, refresh
 * tokens and consents. The staff MCP gate checks the consent on every
 * request, so an unexpired access token stops working at once. API keys are
 * separate, deliberately created credentials and are kept. Idempotent.
 */
export async function revokeStaffAccess(
  userIds: readonly string[],
  instance: StaffAuth = auth,
  db: DatabaseExecutor = authDb,
): Promise<void> {
  if (userIds.length === 0) return;
  const context = await instance.$context;
  for (const userId of userIds) {
    await context.internalAdapter.deleteUserSessions(userId);
  }
  const ids = [...userIds];
  await db.transaction(async (transaction) => {
    await transaction
      .delete(oauthAccessToken)
      .where(inArray(oauthAccessToken.userId, ids));
    await transaction
      .delete(oauthRefreshToken)
      .where(inArray(oauthRefreshToken.userId, ids));
    await transaction
      .delete(oauthConsent)
      .where(inArray(oauthConsent.userId, ids));
  });
}
