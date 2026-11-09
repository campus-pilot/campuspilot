import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import { generateRequestDetails } from 'web-push';

import { parseRetryAfter } from '../retry-after';
import type { ChannelFetch, ClaimedDelivery, DeliverySendOutcome, NotificationChannelAdapter, ResolvedRecipient } from '../types';
import { isAllowedPushEndpoint } from './endpoints';
import { renderWebPushMessage } from './render';
import { loadPushSubscription, markPushSubscriptionSuccess, revokePushSubscriptionById } from './subscriptions';

/** VAPID identity of this platform (see `@campuspilot/env/server/web-push.env`). */
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/**
 * How long a push service keeps an undelivered message (device offline).
 * Bills, receipts and results stay relevant for days; the inbox is the
 * record anyway, so a message older than this is simply dropped.
 */
export const WEB_PUSH_TTL_SECONDS = 3 * 24 * 60 * 60;
/** One push service request may take this long before it counts as transient. */
const WEB_PUSH_TIMEOUT_MS = 15_000;

/**
 * A copy per active subscription of the admission's Cadet login; none means
 * `skipped: no_subscription`. Staff recipients never get web push (the
 * catalogue gives staff types the inbox only), so they get no decision.
 */
export function decideWebPush(recipient: ResolvedRecipient) {
  if (recipient.kind !== 'admission') return [];
  if (recipient.pushSubscriptionIds.length === 0) {
    return [{ status: 'skipped' as const, reason: 'no_subscription' as const, destination: null }];
  }
  return recipient.pushSubscriptionIds.map((id) => ({ status: 'owed' as const, destination: id }));
}

/**
 * Classifies a push service answer (RFC 8030 / 8292):
 * - 201 (or any 2xx) → sent;
 * - 404 / 410 → the subscription expired or was unsubscribed: revoked,
 *   delivery failed (`subscription_gone`), never retried;
 * - 429 and 5xx → transient, retried with backoff (`Retry-After` honoured);
 * - any other status (400 bad request, 403 VAPID mismatch, 413 too large) →
 *   failed with the status as the error code.
 */
export function classifyPushResponse(status: number, retryAfter: string | null): DeliverySendOutcome | 'gone' {
  if (status >= 200 && status < 300) return { kind: 'sent', providerMessageId: null };
  if (status === 404 || status === 410) return 'gone';
  if (status === 429 || status >= 500) {
    return { kind: 'retry', errorCode: `http_${status}`, scope: 'recipient', retryAfterMs: parseRetryAfter(retryAfter) };
  }
  return { kind: 'failed', errorCode: `http_${status}` };
}

/**
 * Web push sender. `web-push` builds the VAPID-signed, aes128gcm-encrypted
 * request; the request itself goes through `fetch`, so tests mock HTTP only.
 */
export function createWebPushAdapter(options: {
  vapid: VapidConfig;
  fetch?: ChannelFetch;
  db?: DatabaseExecutor;
}): NotificationChannelAdapter {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const db = options.db ?? defaultDb;

  async function send(delivery: ClaimedDelivery): Promise<DeliverySendOutcome> {
    if (!delivery.destination) return { kind: 'failed', errorCode: 'no_destination' };
    const subscription = await loadPushSubscription(db, delivery.destination);
    if (!subscription || subscription.revokedAt) return { kind: 'failed', errorCode: 'subscription_revoked' };
    // Checked at subscribe time too; re-checked so no stored row can make the worker call another host.
    if (!isAllowedPushEndpoint(subscription.endpoint)) return { kind: 'failed', errorCode: 'endpoint_not_allowed' };
    const message = renderWebPushMessage(delivery.notificationId, delivery.type, delivery.data);
    if (!message) return { kind: 'failed', errorCode: 'no_push_text' };

    const request = generateRequestDetails(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(message),
      {
        TTL: WEB_PUSH_TTL_SECONDS,
        urgency: 'normal',
        vapidDetails: options.vapid,
        contentEncoding: 'aes128gcm',
      },
    );
    // `fetch` sets the length itself and refuses a caller-set Content-Length.
    const headers = Object.fromEntries(
      Object.entries(request.headers)
        .filter(([name]) => name.toLowerCase() !== 'content-length')
        .map(([name, value]) => [name, String(value)]),
    );
    let response: Response;
    try {
      response = await fetcher(request.endpoint, {
        method: request.method,
        headers,
        body: request.body ? new Uint8Array(request.body) : null,
        signal: AbortSignal.timeout(WEB_PUSH_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      return { kind: 'retry', errorCode: 'network_error', scope: 'recipient' };
    }
    const outcome = classifyPushResponse(response.status, response.headers.get('retry-after'));
    await response.body?.cancel().catch(() => undefined);
    // Bookkeeping after the push service answered must never throw: a thrown
    // send is retried, and the message may already have been accepted.
    if (outcome === 'gone') {
      await revokePushSubscriptionById(db, subscription.id).catch(() => undefined);
      return { kind: 'failed', errorCode: 'subscription_gone' };
    }
    if (outcome.kind === 'sent') await markPushSubscriptionSuccess(db, subscription.id).catch(() => undefined);
    return outcome;
  }

  return { channel: 'web_push', available: true, decide: decideWebPush, send };
}

/** The platform's web push adapter: unavailable unless `WEB_PUSH_ENABLED=true`. */
export function createWebPushAdapterFromEnv(): NotificationChannelAdapter {
  if (!env.WEB_PUSH_ENABLED || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return { channel: 'web_push', available: false, unavailableReason: 'Web push is switched off (WEB_PUSH_ENABLED).' };
  }
  return createWebPushAdapter({
    vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT },
  });
}
