import { env } from '@campuspilot/env/server';
import { getRestateClient, rpc } from '@campuspilot/restate/client';

import { signWorkerControlCall } from '../workflows/control-auth';
import { NOTIFICATION_CONTROL_SERVICE_NAME, notificationHandoverKey } from '../workflows/notification/constants';
import type { NotificationControlService } from '../workflows/notification/control-service';
import { senderPokeIdempotencyKey, type SenderTarget } from './sender/lanes';

/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * Hands one notification event to Restate: a signed, one-way, idempotent
 * send to `NotificationControl.dispatch`. Restate answers once it has durably
 * accepted the call, whether or not a worker runs, so no request waits for
 * the worker. A repeated send (sweep retry, replica race) joins the same
 * invocation through the idempotency key; each fan-out attempt has its own.
 */
export async function sendNotificationDispatch(eventId: string, attempt: number) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  // The attempt is always explicit, so the signed input equals what the worker parses.
  const input = { eventId, attempt };
  const headers = signWorkerControlCall(secret, { service: NOTIFICATION_CONTROL_SERVICE_NAME, handler: 'dispatch' }, input);
  const sent = await getRestateClient()
    .serviceSendClient<NotificationControlService>({ name: NOTIFICATION_CONTROL_SERVICE_NAME })
    .dispatch(input, rpc.sendOpts({ idempotencyKey: notificationHandoverKey(eventId, attempt), headers, timeout: SEND_TIMEOUT_MS }));
  return { invocationId: sent.invocationId };
}

/**
 * Pokes one sender lane through the signed `NotificationControl.poke`
 * (D-39): one-way, so the sweep never waits for a drain. The idempotency
 * key folds pokes of the same lane within a window into one.
 */
export async function sendNotificationSenderPoke(target: SenderTarget, now: Date = new Date()) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  const input = { channel: target.channel, lane: target.lane };
  const headers = signWorkerControlCall(secret, { service: NOTIFICATION_CONTROL_SERVICE_NAME, handler: 'poke' }, input);
  await getRestateClient()
    .serviceSendClient<NotificationControlService>({ name: NOTIFICATION_CONTROL_SERVICE_NAME })
    .poke(input, rpc.sendOpts({ idempotencyKey: senderPokeIdempotencyKey(target, now.getTime()), headers, timeout: SEND_TIMEOUT_MS }));
}
