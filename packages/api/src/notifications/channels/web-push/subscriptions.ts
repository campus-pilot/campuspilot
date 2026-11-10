import type { DatabaseExecutor } from '@campuspilot/db';
import { cadetUser } from '@campuspilot/db/schema/cadet';
import { cadetPushSubscriptionTable } from '@campuspilot/db/schema/notification';
import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';

/**
 * Push subscription storage (plan §3b). Every query is bound to one cadet
 * login (`cadetUserId` from the session), except the dispatcher's lookup by
 * admission and the sender's lookup by subscription ID.
 */

/** Browser `PushSubscription` facts, as `PushSubscription.toJSON()` gives them. */
export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/**
 * Most active subscriptions one Cadet login keeps (review round 2 #6): a
 * student uses a handful of devices; a client re-subscribing in a loop must
 * not grow the table or the fan-out without bound.
 */
export const MAX_ACTIVE_PUSH_SUBSCRIPTIONS = 10;

/**
 * Stores (or re-activates) this login's subscription for one endpoint. The
 * browser may hand out new keys for the same endpoint, so keys are always
 * overwritten; a revoked row becomes active again. The login then keeps its
 * {@link MAX_ACTIVE_PUSH_SUBSCRIPTIONS} most recently subscribed devices;
 * older ones are revoked (that device stops getting pushes until it turns
 * notifications on again).
 *
 * `cadetSessionId` is the portal session doing this (null only for a caller
 * without one). It replaces any earlier session on the row: the device now
 * belongs to this sign-in, and the end of that session (sign-out or any
 * other deletion of the `cadet_session` row) revokes the subscription
 * through the database trigger of migration 0052.
 */
export async function upsertPushSubscription(
  db: DatabaseExecutor,
  cadetUserId: string,
  subscription: PushSubscriptionInput,
  userAgent: string | null,
  cadetSessionId: string | null,
) {
  const now = new Date();
  await db
    .insert(cadetPushSubscriptionTable)
    .values({
      cadetUserId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
      cadetSessionId,
    })
    .onConflictDoUpdate({
      target: [cadetPushSubscriptionTable.cadetUserId, cadetPushSubscriptionTable.endpoint],
      set: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
        cadetSessionId,
        revokedAt: null,
        updatedAt: now,
      },
    });
  const newest = db
    .select({ id: cadetPushSubscriptionTable.id })
    .from(cadetPushSubscriptionTable)
    .where(and(eq(cadetPushSubscriptionTable.cadetUserId, cadetUserId), isNull(cadetPushSubscriptionTable.revokedAt)))
    .orderBy(desc(cadetPushSubscriptionTable.updatedAt), desc(cadetPushSubscriptionTable.createdAt), desc(cadetPushSubscriptionTable.id))
    .limit(MAX_ACTIVE_PUSH_SUBSCRIPTIONS);
  await db
    .update(cadetPushSubscriptionTable)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(cadetPushSubscriptionTable.cadetUserId, cadetUserId),
        isNull(cadetPushSubscriptionTable.revokedAt),
        notInArray(cadetPushSubscriptionTable.id, newest),
      ),
    );
}

/** Revokes this login's subscription for one endpoint; true when one was active. */
export async function revokePushSubscription(db: DatabaseExecutor, cadetUserId: string, endpoint: string): Promise<boolean> {
  const rows = await db
    .update(cadetPushSubscriptionTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(cadetPushSubscriptionTable.cadetUserId, cadetUserId),
        eq(cadetPushSubscriptionTable.endpoint, endpoint),
        isNull(cadetPushSubscriptionTable.revokedAt),
      ),
    )
    .returning({ id: cadetPushSubscriptionTable.id });
  return rows.length > 0;
}

/** Whether this login has an active subscription for one endpoint. */
export async function isPushSubscriptionActive(db: DatabaseExecutor, cadetUserId: string, endpoint: string): Promise<boolean> {
  const [row] = await db
    .select({ id: cadetPushSubscriptionTable.id })
    .from(cadetPushSubscriptionTable)
    .where(
      and(
        eq(cadetPushSubscriptionTable.cadetUserId, cadetUserId),
        eq(cadetPushSubscriptionTable.endpoint, endpoint),
        isNull(cadetPushSubscriptionTable.revokedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Active subscription IDs per admission (through its Cadet login), oldest
 * first. An admission without a login, or whose login has none, is absent.
 */
export async function activePushSubscriptionIdsByAdmission(
  db: DatabaseExecutor,
  admissionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (admissionIds.length === 0) return result;
  const rows = await db
    .select({ admissionId: cadetUser.admissionId, id: cadetPushSubscriptionTable.id })
    .from(cadetPushSubscriptionTable)
    .innerJoin(cadetUser, eq(cadetUser.id, cadetPushSubscriptionTable.cadetUserId))
    .where(and(inArray(cadetUser.admissionId, [...admissionIds]), isNull(cadetPushSubscriptionTable.revokedAt)))
    .orderBy(asc(cadetPushSubscriptionTable.createdAt), asc(cadetPushSubscriptionTable.id));
  for (const row of rows) {
    const ids = result.get(row.admissionId) ?? [];
    ids.push(row.id);
    result.set(row.admissionId, ids);
  }
  return result;
}

/** The sender's view of one subscription; null when it no longer exists. */
export async function loadPushSubscription(db: DatabaseExecutor, id: string) {
  const [row] = await db
    .select({
      id: cadetPushSubscriptionTable.id,
      endpoint: cadetPushSubscriptionTable.endpoint,
      p256dh: cadetPushSubscriptionTable.p256dh,
      auth: cadetPushSubscriptionTable.auth,
      revokedAt: cadetPushSubscriptionTable.revokedAt,
    })
    .from(cadetPushSubscriptionTable)
    .where(eq(cadetPushSubscriptionTable.id, id))
    .limit(1);
  return row ?? null;
}

/** Marks a subscription gone (the push service answered 404/410). */
export async function revokePushSubscriptionById(db: DatabaseExecutor, id: string) {
  await db
    .update(cadetPushSubscriptionTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(cadetPushSubscriptionTable.id, id), isNull(cadetPushSubscriptionTable.revokedAt)));
}

/** Records that a push service accepted a message for a subscription. */
export async function markPushSubscriptionSuccess(db: DatabaseExecutor, id: string) {
  await db.update(cadetPushSubscriptionTable).set({ lastSuccessAt: new Date() }).where(eq(cadetPushSubscriptionTable.id, id));
}
