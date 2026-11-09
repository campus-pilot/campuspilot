import type { RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';

/**
 * Per-delivery retry policy (D-7, D-41). A transient send outcome puts the
 * delivery back in the queue with a later `next_attempt_at`, or gives up
 * (`failed`, alerted by D-38) once the channel's budget is spent. Pure:
 * time and randomness are passed in, so the sender computes it inside a
 * journaled step and tests can pin it.
 *
 * WhatsApp has two paths:
 * - **daily messaging limit** (Meta's 24 h unique-recipient budget is
 *   spent): no quick retries; one retry a day later, up to
 *   {@link WHATSAPP_DAILY_LIMIT_RETRIES} times (the rolling window frees up);
 * - **any other transient failure** (throughput throttling, 5xx before the
 *   request was sent, network): {@link QUICK_RETRY_LIMIT} quick retries with
 *   exponential backoff and jitter, then {@link WHATSAPP_DEFERRED_RETRIES}
 *   retry a day later.
 * Each path counts in its own column, so a mix of both stays bounded by
 * their sum.
 *
 * Web push has quick retries only ({@link WEB_PUSH_QUICK_RETRY_LIMIT}):
 * the inbox is the record and a push older than a few hours is noise, so
 * nothing is retried a day later.
 */

export const QUICK_RETRY_LIMIT = 4;
export const WEB_PUSH_QUICK_RETRY_LIMIT = 5;
export const WHATSAPP_DEFERRED_RETRIES = 1;
export const WHATSAPP_DAILY_LIMIT_RETRIES = 3;
/** First quick retry after one minute, then ×4 (1, 4, 16, 64 min, …). */
const QUICK_RETRY_BASE_MS = 60_000;
const QUICK_RETRY_FACTOR = 4;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest provider `Retry-After` honoured for a quick retry. */
const MAX_QUICK_RETRY_MS = 6 * 60 * 60 * 1000;
/** Spread of a day-later retry, so a whole batch does not return in the same second. */
const DEFERRED_JITTER_MS = 30 * 60 * 1000;

/** Retries a delivery already used, per path. */
export type RetryCounters = { quickRetries: number; deferredRetries: number; dailyLimitRetries: number };

/** What a transient outcome reported. */
export type TransientFailure = {
  /** `daily_messaging_limit`: the provider's daily unique-recipient limit is reached (WhatsApp). */
  limit?: 'daily_messaging_limit';
  /** The provider's own hint (`Retry-After`), if any. */
  retryAfterMs?: number | null;
};

export type RetryDecision =
  | { kind: 'retry'; nextAttemptAt: Date; counters: RetryCounters }
  | { kind: 'give_up' };

/** ±25 % jitter around `ms`; `random` is in [0, 1). */
function jittered(ms: number, random: number) {
  return Math.round(ms * (0.75 + random * 0.5));
}

/**
 * The longest a quick retry can be scheduled ahead: the {@link
 * MAX_QUICK_RETRY_MS} cap with the most jitter. Every day-later retry is
 * scheduled further out ({@link DAY_MS} or more), so "owed within this
 * horizon" is exactly "will be attempted on the quick path" (used by the
 * batch failure alerts, D-38).
 */
export const QUICK_RETRY_HORIZON_MS = jittered(MAX_QUICK_RETRY_MS, 1);

/** Delay of quick retry number `retry` (1-based): exponential, at least the provider's hint, jittered. */
export function quickRetryDelayMs(retry: number, retryAfterMs: number | null | undefined, random: number): number {
  const exponential = QUICK_RETRY_BASE_MS * QUICK_RETRY_FACTOR ** (retry - 1);
  const base = Math.min(Math.max(exponential, retryAfterMs ?? 0), MAX_QUICK_RETRY_MS);
  return jittered(base, random);
}

/** A day plus up to {@link DEFERRED_JITTER_MS}. */
function dayLaterMs(random: number) {
  return DAY_MS + Math.round(random * DEFERRED_JITTER_MS);
}

/** Decides the next attempt of a delivery whose send came back transient. */
export function decideRetry(
  channel: RemoteNotificationChannel,
  failure: TransientFailure,
  counters: RetryCounters,
  now: Date,
  random: number,
): RetryDecision {
  const at = (ms: number) => new Date(now.getTime() + ms);
  switch (channel) {
    case 'whatsapp': {
      if (failure.limit === 'daily_messaging_limit') {
        if (counters.dailyLimitRetries >= WHATSAPP_DAILY_LIMIT_RETRIES) return { kind: 'give_up' };
        return { kind: 'retry', nextAttemptAt: at(dayLaterMs(random)), counters: { ...counters, dailyLimitRetries: counters.dailyLimitRetries + 1 } };
      }
      if (counters.quickRetries < QUICK_RETRY_LIMIT) {
        const retry = counters.quickRetries + 1;
        return { kind: 'retry', nextAttemptAt: at(quickRetryDelayMs(retry, failure.retryAfterMs, random)), counters: { ...counters, quickRetries: retry } };
      }
      if (counters.deferredRetries < WHATSAPP_DEFERRED_RETRIES) {
        return { kind: 'retry', nextAttemptAt: at(dayLaterMs(random)), counters: { ...counters, deferredRetries: counters.deferredRetries + 1 } };
      }
      return { kind: 'give_up' };
    }
    case 'web_push': {
      if (counters.quickRetries >= WEB_PUSH_QUICK_RETRY_LIMIT) return { kind: 'give_up' };
      const retry = counters.quickRetries + 1;
      return { kind: 'retry', nextAttemptAt: at(quickRetryDelayMs(retry, failure.retryAfterMs, random)), counters: { ...counters, quickRetries: retry } };
    }
    default: {
      const unhandled: never = channel;
      throw new Error(`Unhandled channel ${String(unhandled)}.`);
    }
  }
}

/** First channel-wide pause after a throttle, then doubled per consecutive throttle. */
const CHANNEL_BACKOFF_BASE_MS = 30_000;
const MAX_CHANNEL_BACKOFF_MS = 15 * 60 * 1000;

/**
 * How long a sender pauses the whole channel after its `consecutive`-th
 * channel-scoped throttle in a row (1-based): 30 s doubling to 15 min, at
 * least the provider's hint, jittered so lanes and restarts do not resume
 * in lockstep.
 */
export function channelBackoffMs(consecutive: number, retryAfterMs: number | null | undefined, random: number): number {
  const exponential = CHANNEL_BACKOFF_BASE_MS * 2 ** (consecutive - 1);
  return jittered(Math.min(Math.max(exponential, retryAfterMs ?? 0), MAX_CHANNEL_BACKOFF_MS), random);
}
