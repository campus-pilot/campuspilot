import { env } from '@campuspilot/env/server';
import type { getRedisClient } from '@campuspilot/redis/client';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { AltchaChallenge } from './altcha-solver';

/**
 * The server half of the lead form's proof-of-work ("app check"), in the
 * ALTCHA format (see `altcha-solver.ts` for the client half). It makes every
 * public submission cost the sender CPU time and binds it to a challenge
 * this server issued recently; it does not prove a human is present. The
 * per-IP rate limits on the routes bound the rest.
 *
 * - The challenge is stateless: the expiry travels inside the salt
 *   (`…?expires=<unix seconds>`, as ALTCHA does) and the HMAC over the
 *   challenge (`LEAD_CHALLENGE_HMAC_KEY`) proves the server issued it.
 * - A solution is spent once: its signature is claimed in Redis until the
 *   challenge expires ({@link claimAltchaSolution}), so one solve cannot
 *   carry many submissions.
 */

/**
 * Largest secret number of a challenge. The browser hashes about half of it
 * on average: roughly half a second to two seconds on a phone.
 */
export const ALTCHA_MAX_NUMBER = 50_000;
/** How long an issued challenge may be solved and submitted. */
export const ALTCHA_TTL_MS = 10 * 60 * 1000;

/**
 * The signing key. Production requires `LEAD_CHALLENGE_HMAC_KEY` (env
 * validation); elsewhere a random key per process is used, so a local stack
 * needs no setup but challenges do not survive a restart.
 */
const signingKey = env.LEAD_CHALLENGE_HMAC_KEY ?? randomBytes(32).toString('hex');

function sha256Hex(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function hmacHex(key: string, text: string) {
  return createHmac('sha256', key).update(text).digest('hex');
}

/** Issues a fresh challenge. */
export function createAltchaChallenge(options: { key?: string; now?: number; maxNumber?: number } = {}): AltchaChallenge {
  const key = options.key ?? signingKey;
  const now = options.now ?? Date.now();
  const maxnumber = options.maxNumber ?? ALTCHA_MAX_NUMBER;
  const expires = Math.floor((now + ALTCHA_TTL_MS) / 1000);
  const salt = `${randomBytes(12).toString('hex')}?expires=${expires}`;
  const challenge = sha256Hex(`${salt}${randomInt(0, maxnumber + 1)}`);
  return { algorithm: 'SHA-256', challenge, maxnumber, salt, signature: hmacHex(key, challenge) };
}

const solutionSchema = z.object({
  algorithm: z.literal('SHA-256'),
  challenge: z.string().regex(/^[0-9a-f]{64}$/),
  number: z.number().int().min(0),
  salt: z.string().min(1).max(200),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Why a solution was refused; logged, never shown in detail to the caller. */
export type AltchaRefusal = 'missing' | 'malformed' | 'bad_signature' | 'wrong_number' | 'expired';

export type AltchaVerdict = { ok: true; signature: string; expiresAt: number } | { ok: false; reason: AltchaRefusal };

function readExpiry(salt: string): number | null {
  const query = salt.split('?')[1];
  const expires = query ? new URLSearchParams(query).get('expires') : null;
  return expires && /^\d{1,12}$/.test(expires) ? Number(expires) * 1000 : null;
}

/**
 * Checks a solution header (base64 JSON): issued by this server (HMAC), the
 * number solves it, and it has not expired. Whether it was already spent is
 * checked separately, with {@link claimAltchaSolution}, once the request is
 * otherwise valid.
 */
export function verifyAltchaSolution(header: string | null | undefined, options: { key?: string; now?: number } = {}): AltchaVerdict {
  if (!header) return { ok: false, reason: 'missing' };
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const parsed = solutionSchema.safeParse(decoded);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  const solution = parsed.data;
  const expected = Buffer.from(hmacHex(options.key ?? signingKey, solution.challenge), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(solution.signature, 'hex'))) return { ok: false, reason: 'bad_signature' };
  if (sha256Hex(`${solution.salt}${solution.number}`) !== solution.challenge) return { ok: false, reason: 'wrong_number' };
  const expiresAt = readExpiry(solution.salt);
  if (expiresAt === null || expiresAt <= (options.now ?? Date.now())) return { ok: false, reason: 'expired' };
  return { ok: true, signature: solution.signature, expiresAt };
}

/**
 * Spends a verified solution: true the first time, false for a replay. The
 * claim lives in Redis (shared by every replica) until the challenge would
 * have expired anyway.
 */
export async function claimAltchaSolution(redis: ReturnType<typeof getRedisClient>, verdict: { signature: string; expiresAt: number }, now = Date.now()) {
  const ttlMs = Math.max(1_000, verdict.expiresAt - now);
  const result = await redis.set(`server:altcha:spent:${verdict.signature}`, '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
}
