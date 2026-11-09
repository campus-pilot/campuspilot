import { db } from '@campuspilot/db';
import type { NotificationType } from '@campuspilot/db/notifications/catalogue';
import { cadetUser } from '@campuspilot/db/schema/cadet';
import { createRouterClient } from '@orpc/server';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';

import type { CadetContext } from '../src/cadet/context';
import { runNotificationDispatch, type NotificationDispatchResult } from '../src/notifications/dispatch';
import { notify, type NotifyInput } from '../src/notifications/notify';
import { cadetRouter, type CadetRouterClient } from '../src/routers/cadet/cadet.router';

/** Runs a dispatch with plain calls in place of journaled Restate steps. */
export function dispatchNow(eventId: string): Promise<NotificationDispatchResult> {
  return runNotificationDispatch({ eventId, step: (_name, action) => action(), sleep: async () => undefined });
}

/** Emits an event in its own transaction and fans it out at once. */
export async function emitAndDispatch<T extends NotificationType>(input: Omit<NotifyInput<T>, 'key'> & { key?: string }) {
  const { eventId } = await db.transaction((tx) => notify(tx, { ...input, key: input.key ?? `test:${randomUUID()}` } as NotifyInput<T>));
  const result = await dispatchNow(eventId);
  return { eventId, result };
}

/** Facts of a `bill.issued` notification for an admission. */
export function billIssuedData(admissionId: string, overrides: Partial<{ billNumber: string }> = {}) {
  return {
    billId: `fbill_${randomUUID().replaceAll('-', '').slice(0, 21)}`,
    sessionId: 'sess_test',
    admissionId,
    billNumber: overrides.billNumber ?? 'BILL/2026-27/000001',
    totalAmountMinor: '250000',
    currency: 'INR',
    issueDate: '2026-10-01',
    studentName: 'Test Student',
    periodKey: '2026-10',
  };
}

/** Facts of a `billing.run_posted` notification. */
export function billingRunPostedData(billCount = 3) {
  return { billRunId: `frun_${randomUUID().slice(0, 8)}`, sessionId: 'sess_test', periodKey: '2026-10', billCount };
}

/**
 * A cadet router client for an admission, with the context the cadet
 * session middleware would produce (no real sign-in needed).
 */
export function createCadetClientForAdmission(admissionId: string): CadetRouterClient {
  const context: CadetContext = {
    db,
    headers: new Headers(),
    login: { userId: `cadet_${randomUUID()}`, admissionId },
    principal: { authMethod: 'session' },
  };
  return createRouterClient(cadetRouter, { context });
}

/**
 * Inserts a Cadet Portal login for an admission (no password; tests never
 * sign in with it) and returns a router client bound to it, as the cadet
 * session middleware would.
 */
export async function createCadetLogin(admissionId: string, headers: Headers = new Headers()) {
  const userId = `cadet_${randomUUID()}`;
  await db.insert(cadetUser).values({
    id: userId,
    email: `${admissionId}-${userId}@cadet.campuspilot.invalid`,
    admissionId,
    passwordSource: 'issued',
    issuedAt: new Date(),
  });
  const context: CadetContext = { db, headers, login: { userId, admissionId }, principal: { authMethod: 'session' } };
  return { userId, client: createRouterClient(cadetRouter, { context }) as CadetRouterClient };
}

/** A browser-like push subscription (valid P-256 key and auth secret) on FCM. */
export function fakePushSubscription(endpointId: string = randomUUID()) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${endpointId}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}
