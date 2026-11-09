import { env } from '@campuspilot/env/server';

/**
 * Read-only queries against the Restate admin API (`/query` over
 * `sys_invocation`) and invocation cancels, shared by the API (outbox sweeps)
 * and the worker (control authentication). The admin API must never be
 * publicly reachable.
 */

/** Invocation states from Restate's `sys_invocation` (`completed` is final). */
export type RestateInvocationStatus =
  | 'pending' | 'scheduled' | 'ready' | 'running' | 'paused' | 'backing-off' | 'suspended' | 'completed';

export const RESTATE_INVOCATION_ID = /^inv_[A-Za-z0-9]+$/;
const QUERY_TIMEOUT_MS = 5_000;

/**
 * Runs one SQL query against Restate's admin API. Callers must only embed
 * values they validated against a strict pattern (the API has no parameters).
 */
export async function queryRestateAdmin<T>(sql: string, signal?: AbortSignal): Promise<T[]> {
  const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
  const response = await fetch(new URL('/query', env.RESTATE_ADMIN_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: sql }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Restate admin query failed (${response.status}).`);
  return ((await response.json()) as { rows: T[] }).rows;
}

/**
 * Status and creation time of one invocation, or null when Restate no longer
 * knows it (purged after its retention period, or never existed).
 */
export async function getRestateInvocation(
  invocationId: string,
  signal?: AbortSignal,
): Promise<{ status: RestateInvocationStatus; createdAt: number } | null> {
  if (!RESTATE_INVOCATION_ID.test(invocationId)) throw new Error('Invalid Restate invocation ID.');
  const [row] = await queryRestateAdmin<{ status: RestateInvocationStatus; created_at: string }>(
    `SELECT status, created_at FROM sys_invocation WHERE id = '${invocationId}'`,
    signal,
  );
  return row ? { status: row.status, createdAt: Date.parse(row.created_at) } : null;
}

/**
 * Cancels an invocation through the admin API. An invocation that already
 * finished is not an error (404/409 mean nothing is running).
 */
export async function cancelRestateInvocation(invocationId: string) {
  if (!RESTATE_INVOCATION_ID.test(invocationId)) throw new Error('Invalid Restate invocation ID.');
  const response = await fetch(new URL(`/invocations/${encodeURIComponent(invocationId)}/cancel`, env.RESTATE_ADMIN_URL), {
    method: 'PATCH',
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error(`Restate refused to cancel invocation (${response.status}).`);
  }
}

/** Service and virtual object names we query by: plain identifiers only (the query is built as text). */
const RESTATE_SERVICE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** One invocation that has not completed: its ID, key (virtual objects and workflows) and status. */
export type LiveRestateInvocation = { id: string; key: string | null; status: Exclude<RestateInvocationStatus, 'completed'> };

/**
 * Every invocation of one service, virtual object or workflow that has not
 * completed (inboxed, scheduled, running, backing off, suspended or
 * paused), with its key.
 */
export async function listLiveRestateInvocations(serviceName: string, signal?: AbortSignal): Promise<LiveRestateInvocation[]> {
  if (!RESTATE_SERVICE_NAME.test(serviceName)) throw new Error('Invalid Restate service name.');
  const rows = await queryRestateAdmin<{ id: string; target_service_key: string | null; status: LiveRestateInvocation['status'] }>(
    `SELECT id, target_service_key, status FROM sys_invocation WHERE target_service_name = '${serviceName}' AND status <> 'completed'`,
    signal,
  );
  return rows.filter((row) => RESTATE_INVOCATION_ID.test(row.id)).map((row) => ({ id: row.id, key: row.target_service_key, status: row.status }));
}

/**
 * Kills an invocation through the admin API: it ends at once without
 * running any more of its code (unlike a cancel, which a paused invocation
 * only acts on once it resumes). An invocation that already finished is not
 * an error (404/409).
 */
export async function killRestateInvocation(invocationId: string) {
  if (!RESTATE_INVOCATION_ID.test(invocationId)) throw new Error('Invalid Restate invocation ID.');
  const response = await fetch(new URL(`/invocations/${encodeURIComponent(invocationId)}/kill`, env.RESTATE_ADMIN_URL), {
    method: 'PATCH',
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error(`Restate refused to kill invocation (${response.status}).`);
  }
}
