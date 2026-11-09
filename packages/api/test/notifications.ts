import { db } from '@campuspilot/db';
import type { NotificationType } from '@campuspilot/db/notifications/catalogue';
import { cadetUser } from '@campuspilot/db/schema/cadet';
import { createRouterClient } from '@orpc/server';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';

import type { CadetContext } from '../src/cadet/context';
import type { RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';

import type { NotificationChannelAdapter } from '../src/notifications/channels';
import { runNotificationDispatch, type NotificationDispatchResult } from '../src/notifications/dispatch';
import { notify, type NotifyInput } from '../src/notifications/notify';
import { runSenderDrain, type SenderPacing } from '../src/notifications/sender/drain';
import { WEB_PUSH_SENDER_LANES, type SenderTarget } from '../src/notifications/sender/lanes';
import { cadetRouter, type CadetRouterClient } from '../src/routers/cadet/cadet.router';

/**
 * Runs a fan-out with plain calls in place of journaled Restate steps. It
 * writes rows only; sending is the senders' job ({@link drainSchool}).
 */
export function dispatchNow(
  eventId: string,
  adapters?: Record<RemoteNotificationChannel, NotificationChannelAdapter>,
): Promise<NotificationDispatchResult> {
  return runNotificationDispatch({ eventId, step: (_name, action) => action(), poke: async () => undefined, adapters });
}

/** An emit as tests write it: key and priority are optional (a fresh key, `immediate`). */
export type TestNotifyInput<T extends NotificationType> = Omit<NotifyInput<T>, 'key' | 'sendPriority'> & {
  key?: string;
  sendPriority?: NotifyInput<T>['sendPriority'];
};

/** Emits an event in its own transaction. */
export async function emit<T extends NotificationType>(input: TestNotifyInput<T>) {
  return db.transaction((tx) =>
    notify(tx, { ...input, key: input.key ?? `test:${randomUUID()}`, sendPriority: input.sendPriority ?? 'immediate' } as NotifyInput<T>),
  );
}

/** Emits an event in its own transaction and fans it out at once. */
export async function emitAndDispatch<T extends NotificationType>(input: TestNotifyInput<T>) {
  const { eventId } = await emit(input);
  const result = await dispatchNow(eventId);
  return { eventId, result };
}

/** A clock the sender reads; sleeps and waits for retries move it forward. */
export function fakeClock(start: Date = new Date()) {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
    set: (at: Date) => {
      now = Math.max(now, at.getTime());
    },
  };
}

/** Fast pacing for tests: no rate waits worth mentioning. */
export const TEST_PACING: SenderPacing = { perSecond: 1000, concurrency: 1, groupSize: 50 };

/**
 * Drains one school's owed deliveries on every sender lane, as the
 * `NotificationSender` objects would, with plain steps and a fake clock:
 * a drain's sleeps advance the clock, and when a drain ends with a retry
 * scheduled later the clock jumps to it and the lane is drained again,
 * until nothing is owed or `maxDrains` drains ran. Jitter is pinned
 * (random 0.5 = no jitter). Scoped to the school, so parallel test files
 * never send each other's rows. A drain's settle wait before it ends idle
 * (the lost-poke guard, `idleNotBeforeMs`) is counted in `settles` and does
 * not move the clock, so `sleeps` and `waits` stay the retry and pause
 * timings the tests are about.
 */
export async function drainSchool(
  schoolId: string,
  options: {
    adapters: Record<RemoteNotificationChannel, NotificationChannelAdapter>;
    clock?: ReturnType<typeof fakeClock>;
    maxDrains?: number;
    step?: <T>(name: string, action: () => Promise<T>) => Promise<T>;
  },
) {
  const clock = options.clock ?? fakeClock();
  const sleeps: number[] = [];
  const waits: number[] = [];
  let settles = 0;
  const targets: SenderTarget[] = [
    { channel: 'whatsapp', lane: 0 },
    ...Array.from({ length: WEB_PUSH_SENDER_LANES }, (_, lane) => ({ channel: 'web_push' as const, lane })),
  ];
  let drains = 0;
  for (const target of targets) {
    while (drains < (options.maxDrains ?? 30)) {
      drains += 1;
      const result = await runSenderDrain({
        target,
        scope: { schoolId },
        step: options.step ?? ((_name, action) => action()),
        sleep: async (name, ms) => {
          if (name.startsWith('settle:')) {
            settles += 1;
            return;
          }
          sleeps.push(ms);
          clock.advance(ms);
        },
        clock: clock.now,
        random: () => 0.5,
        adapters: options.adapters,
        pacing: TEST_PACING,
      });
      if (result.status === 'continue') continue;
      if (!result.nextDueAt) break;
      waits.push(new Date(result.nextDueAt).getTime() - clock.now().getTime());
      clock.set(new Date(result.nextDueAt));
    }
  }
  return { sleeps, waits, settles, clock };
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
