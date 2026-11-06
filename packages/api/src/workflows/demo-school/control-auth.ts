import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Caller authentication for `DemoSchoolControl`, the only demo service
 * reachable through Restate ingress (Restate OSS does not authenticate
 * ingress callers). The API signs every call with `DEMO_CONTROL_SECRET`;
 * the control service verifies the signature before it reads the database or
 * writes any journal entry.
 *
 * Signed message: `v1\n{handler}\n{timestamp}\n{canonical JSON of the input}`,
 * HMAC-SHA256, hex. The handler name is part of it, so a signature for
 * `startSeed` cannot be replayed against `startPurge` with a lookalike input.
 *
 * Freshness is anchored to when Restate *accepted* the invocation
 * (`sys_invocation.created_at`), not to when the worker first runs it: a
 * start handed over while the worker is down may only run an hour later, and
 * Restate replays the original headers on every retry. A captured request
 * replayed later becomes a new invocation with a new creation time and is
 * refused. Re-sending under the same idempotency key joins the original
 * invocation and never re-runs it.
 */

export const DEMO_CONTROL_TIMESTAMP_HEADER = 'x-demo-control-timestamp';
export const DEMO_CONTROL_SIGNATURE_HEADER = 'x-demo-control-signature';

/** Allowed distance between signing and Restate accepting the call, either way (clock skew). */
export const DEMO_CONTROL_SIGNATURE_WINDOW_MS = 2 * 60 * 1000;

export type DemoControlHandler = 'startSeed' | 'startPurge';

/** JSON with object keys sorted at every level, so both sides sign the same bytes. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function signature(secret: string, handler: DemoControlHandler, timestamp: string, input: unknown) {
  return createHmac('sha256', secret).update(`v1\n${handler}\n${timestamp}\n${canonicalJson(input)}`).digest('hex');
}

/** Headers for one signed control call, signed now. */
export function signDemoControlCall(secret: string, handler: DemoControlHandler, input: unknown, now = Date.now()) {
  const timestamp = String(now);
  return {
    [DEMO_CONTROL_TIMESTAMP_HEADER]: timestamp,
    [DEMO_CONTROL_SIGNATURE_HEADER]: signature(secret, handler, timestamp, input),
  };
}

export type DemoControlVerification =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

/**
 * Verifies a control call's headers against the parsed input. `acceptedAt` is
 * when Restate accepted the invocation (see the module comment). The
 * signature is compared in constant time; the timestamp is checked first only
 * for shape, so a wrong signature and a stale one are indistinguishable in
 * timing beyond what the caller already knows (its own timestamp).
 */
export function verifyDemoControlCall(options: {
  secret: string;
  handler: DemoControlHandler;
  input: unknown;
  headers: ReadonlyMap<string, string>;
  acceptedAt: number;
}): DemoControlVerification {
  const timestamp = options.headers.get(DEMO_CONTROL_TIMESTAMP_HEADER);
  const provided = options.headers.get(DEMO_CONTROL_SIGNATURE_HEADER);
  if (!timestamp || !provided) return { ok: false, reason: 'missing' };
  if (!/^\d{1,16}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(provided)) return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(signature(options.secret, options.handler, timestamp, options.input), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(provided, 'hex'))) return { ok: false, reason: 'mismatch' };
  if (Math.abs(options.acceptedAt - Number(timestamp)) > DEMO_CONTROL_SIGNATURE_WINDOW_MS) return { ok: false, reason: 'stale' };
  return { ok: true };
}
