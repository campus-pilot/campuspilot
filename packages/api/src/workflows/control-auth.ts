import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Caller authentication for worker services reachable through Restate ingress
 * (today `DemoSchoolControl`; every future ingress-public entry point must use
 * it too). Restate OSS does not authenticate ingress callers, so the API signs
 * every call with `WORKER_CONTROL_SECRET` and the service verifies the
 * signature before it reads the database or writes any journal entry.
 * Ingress-private services need no signature: only other handlers can call
 * them.
 *
 * Signed message: `v1\n{service}/{handler}\n{timestamp}\n{canonical JSON of the input}`,
 * HMAC-SHA256, hex. Service and handler are part of it, so a signature for
 * one handler cannot be replayed against another with a lookalike input.
 *
 * Freshness is anchored to when Restate *accepted* the invocation
 * (`sys_invocation.created_at`), not to when the worker first runs it: a call
 * handed over while the worker is down may only run an hour later, and
 * Restate replays the original headers on every retry. A captured request
 * replayed later becomes a new invocation with a new creation time and is
 * refused. Re-sending under the same idempotency key joins the original
 * invocation and never re-runs it.
 */

export const WORKER_CONTROL_TIMESTAMP_HEADER = 'x-worker-control-timestamp';
export const WORKER_CONTROL_SIGNATURE_HEADER = 'x-worker-control-signature';

/** Allowed distance between signing and Restate accepting the call, either way (clock skew). */
export const WORKER_CONTROL_SIGNATURE_WINDOW_MS = 2 * 60 * 1000;

/** The handler a signature is bound to. */
export type WorkerControlTarget = { service: string; handler: string };

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

function signature(secret: string, target: WorkerControlTarget, timestamp: string, input: unknown) {
  const message = `v1\n${target.service}/${target.handler}\n${timestamp}\n${canonicalJson(input)}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** Headers for one signed control call, signed now. */
export function signWorkerControlCall(secret: string, target: WorkerControlTarget, input: unknown, now = Date.now()) {
  const timestamp = String(now);
  return {
    [WORKER_CONTROL_TIMESTAMP_HEADER]: timestamp,
    [WORKER_CONTROL_SIGNATURE_HEADER]: signature(secret, target, timestamp, input),
  };
}

export type WorkerControlVerification =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

/**
 * Verifies a control call's headers against the parsed input. `acceptedAt` is
 * when Restate accepted the invocation (see the module comment). The
 * signature is compared in constant time; the timestamp is checked first only
 * for shape, so a wrong signature and a stale one are indistinguishable in
 * timing beyond what the caller already knows (its own timestamp).
 */
export function verifyWorkerControlCall(options: {
  secret: string;
  target: WorkerControlTarget;
  input: unknown;
  headers: ReadonlyMap<string, string>;
  acceptedAt: number;
}): WorkerControlVerification {
  const timestamp = options.headers.get(WORKER_CONTROL_TIMESTAMP_HEADER);
  const provided = options.headers.get(WORKER_CONTROL_SIGNATURE_HEADER);
  if (!timestamp || !provided) return { ok: false, reason: 'missing' };
  if (!/^\d{1,16}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(provided)) return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(signature(options.secret, options.target, timestamp, options.input), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(provided, 'hex'))) return { ok: false, reason: 'mismatch' };
  if (Math.abs(options.acceptedAt - Number(timestamp)) > WORKER_CONTROL_SIGNATURE_WINDOW_MS) return { ok: false, reason: 'stale' };
  return { ok: true };
}
