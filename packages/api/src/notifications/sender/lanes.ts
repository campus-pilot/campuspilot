import { REMOTE_NOTIFICATION_CHANNELS, type RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';

/**
 * Sender lanes (D-39). Each remote channel is drained by Restate virtual
 * objects (`NotificationSender`), one per lane, whose key is the lane's
 * {@link senderKey}. A virtual object runs one `drain` at a time per key,
 * so a lane is never sent from twice concurrently and its rate limit is
 * enforced in one place.
 * - WhatsApp has one lane (`whatsapp`): every message goes out from the one
 *   CampusPilot number (D-1), whose throughput and limits are channel-wide.
 * - Web push has {@link WEB_PUSH_SENDER_LANES} lanes (`web_push:0` …),
 *   sharded by school: push services limit per subscription, not per
 *   sender, so lanes only spread the work; one school's big batch never
 *   holds up every other school.
 * A delivery's lane is written on the row at fan-out, so changing the lane
 * count later never strands rows: the sweep pokes every lane that has due
 * rows, whatever its number.
 */
export const WEB_PUSH_SENDER_LANES = 4;

/** One sender: a channel and its lane. */
export type SenderTarget = { channel: RemoteNotificationChannel; lane: number };

/** 32-bit FNV-1a; stable across processes and releases (unlike `hashtext`, which is not a documented contract). */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The lane a school's copies on a channel are sent from. */
export function senderLaneFor(channel: RemoteNotificationChannel, schoolId: string): number {
  switch (channel) {
    case 'whatsapp':
      return 0;
    case 'web_push':
      return fnv1a(schoolId) % WEB_PUSH_SENDER_LANES;
    default: {
      const unhandled: never = channel;
      throw new Error(`Unhandled channel ${String(unhandled)}.`);
    }
  }
}

/** Virtual object key of a sender: `whatsapp` (its only lane) or `web_push:<lane>`. */
export function senderKey(target: SenderTarget): string {
  return target.channel === 'whatsapp' ? 'whatsapp' : `${target.channel}:${target.lane}`;
}

/** The sender a virtual object key names; null for anything else. */
export function parseSenderKey(key: string): SenderTarget | null {
  if (key === 'whatsapp') return { channel: 'whatsapp', lane: 0 };
  const match = /^([a-z_]+):(\d{1,3})$/.exec(key);
  if (!match) return null;
  const channel = match[1] as RemoteNotificationChannel;
  if (channel === 'whatsapp' || !(REMOTE_NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) return null;
  return { channel, lane: Number(match[2]) };
}

/** Distinct targets, in first-seen order. */
export function uniqueSenderTargets(targets: readonly SenderTarget[]): SenderTarget[] {
  const seen = new Map<string, SenderTarget>();
  for (const target of targets) if (!seen.has(senderKey(target))) seen.set(senderKey(target), target);
  return [...seen.values()];
}

/** Pokes of one sender within this window share one idempotency key, so a burst of fan-outs starts one drain. */
export const SENDER_POKE_WINDOW_MS = 10_000;

/**
 * Restate idempotency key of a poke: one per sender and
 * {@link SENDER_POKE_WINDOW_MS} window. A poke folded into a drain that
 * already ran loses nothing: a drain ends only on a pick made after the
 * window it started in (`idleNotBeforeMs` in `./drain.ts`), and the sweep
 * pokes again within 30 s while due rows remain.
 */
export function senderPokeIdempotencyKey(target: SenderTarget, nowMs: number): string {
  return `notification-sender:${senderKey(target)}:${Math.floor(nowMs / SENDER_POKE_WINDOW_MS)}`;
}
