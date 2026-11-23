import { randomUUID } from "node:crypto";

import { createLogger } from "@campuspilot/logger";
import { getRedisClient } from "@campuspilot/redis/client";

import { rpcError } from "../../../errors";

const log = createLogger({ pkg: "document-preview" });

/**
 * How many template preview conversions one person may have in flight at
 * once, across every server replica (docs/document-system.md, "Preview
 * limits"). The template builder has one preview in flight at a time (a
 * newer source cancels the request for the older one, and the server aborts
 * that conversion), but a cancelled request frees its slot only when the
 * abort reaches the server, so the next one can briefly overlap it; a second
 * tab, or a revision viewed beside the editor, adds one more. Three covers
 * that and still keeps one person from occupying the converter with many
 * Chromium conversions at once.
 */
export const PREVIEW_CONVERSIONS_PER_USER = 3;

/**
 * How long a slot is held at most. Longer than a preview's conversion
 * timeout (`TEMPLATE_PREVIEW_LIMITS.timeoutMs`) plus the render before it, so
 * a slot is never dropped while its conversion can still run, and short
 * enough that a slot a crashed process never released frees itself soon.
 */
export const PREVIEW_SLOT_TTL_MS = 45_000;

/**
 * Takes a slot when fewer than the limit are held: one sorted set per user,
 * each member a slot scored by when it was taken. Slots older than the TTL
 * are dropped first, so a replica that died mid-conversion never holds a
 * slot for longer than that. Atomic in Redis, so two replicas cannot both
 * take the last slot. Returns 1 when the slot was taken, 0 when refused.
 */
const ACQUIRE_SLOT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const slotKey = (userId: string) => `server:doc-preview:slots:${userId}`;

/** What the slot needs from Redis: a script call and a member removal (narrowed for tests). */
export type PreviewSlotRedis = {
  eval(script: string, keys: number, ...args: (string | number)[]): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
};

/**
 * Runs one template preview conversion in one of the person's
 * {@link PREVIEW_CONVERSIONS_PER_USER} slots, released when it ends however
 * it ends (an abort included). The slots live in Redis, shared by every
 * replica, so the limit holds however many servers there are. A person over
 * the limit is refused with TOO_MANY_REQUESTS (the editor retries it after a
 * moment).
 *
 * When Redis cannot be reached the conversion runs without a slot (logged):
 * the limit is a guard on top of the per-conversion bounds (page cap, render
 * budget, timeout), which still hold, and a Redis outage must not take every
 * template preview down with it.
 */
export async function withPreviewConversionSlot<T>(
  userId: string,
  convert: () => Promise<T>,
  deps: { redis?: PreviewSlotRedis; now?: () => number } = {},
): Promise<T> {
  const redis = deps.redis ?? getRedisClient();
  const key = slotKey(userId);
  const slot = randomUUID();
  let taken: boolean | null;
  try {
    taken = (await redis.eval(ACQUIRE_SLOT, 1, key, (deps.now ?? Date.now)(), PREVIEW_SLOT_TTL_MS, PREVIEW_CONVERSIONS_PER_USER, slot)) === 1;
  } catch (err) {
    log.warn({ err, userId }, "doc.preview.slot.unavailable");
    taken = null;
  }
  if (taken === false) {
    throw rpcError.tooManyRequests("Several previews are already being made for you. Wait a moment and try again.");
  }
  try {
    return await convert();
  } finally {
    if (taken) await redis.zrem(key, slot).catch((err: unknown) => log.warn({ err, userId }, "doc.preview.slot.release-failed"));
  }
}
