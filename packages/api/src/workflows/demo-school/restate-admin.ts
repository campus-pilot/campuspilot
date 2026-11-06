import { env } from '@campuspilot/env/server';

import { DEMO_SCHOOL_WORKFLOW_NAME } from './constants';

/**
 * Read-only queries against the Restate admin API (`/query` over
 * `sys_invocation`), shared by the API (outbox sweep) and the worker (control
 * authentication, purge). The admin API must never be publicly reachable.
 */

/** Invocation states from Restate's `sys_invocation` (`completed` is final). */
export type RestateInvocationStatus =
  | 'pending' | 'scheduled' | 'ready' | 'running' | 'paused' | 'backing-off' | 'suspended' | 'completed';

const INVOCATION_ID = /^inv_[A-Za-z0-9]+$/;
const JOB_ID = /^dsj_[a-z0-9]{21}$/;
const QUERY_TIMEOUT_MS = 5_000;

async function query<T>(sql: string, signal?: AbortSignal): Promise<T[]> {
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
  if (!INVOCATION_ID.test(invocationId)) throw new Error('Invalid Restate invocation ID.');
  const [row] = await query<{ status: RestateInvocationStatus; created_at: string }>(
    `SELECT status, created_at FROM sys_invocation WHERE id = '${invocationId}'`,
    signal,
  );
  return row ? { status: row.status, createdAt: Date.parse(row.created_at) } : null;
}

/**
 * Every `DemoSchool` run of these jobs that has not completed, whatever
 * attempt started it. Found by workflow key (`{jobId}.{attempt}`) rather than
 * by the invocation ID recorded on the job, so a run that started just before
 * a purge recorded its intent is found even if its ID was not recorded yet.
 */
export async function listLiveDemoSeedInvocations(jobIds: string[]): Promise<string[]> {
  const ids = jobIds.filter((id) => JOB_ID.test(id));
  if (ids.length === 0) return [];
  const keyFilter = ids.map((id) => `target_service_key LIKE '${id}.%'`).join(' OR ');
  const rows = await query<{ id: string }>(
    `SELECT id FROM sys_invocation WHERE target_service_name = '${DEMO_SCHOOL_WORKFLOW_NAME}' AND status <> 'completed' AND (${keyFilter})`,
  );
  return rows.map((row) => row.id).filter((id) => INVOCATION_ID.test(id)).sort();
}

/**
 * Cancels an invocation through the admin API. An invocation that already
 * finished is not an error (404/409 mean nothing is running).
 */
export async function cancelRestateInvocation(invocationId: string) {
  if (!INVOCATION_ID.test(invocationId)) throw new Error('Invalid Restate invocation ID.');
  const response = await fetch(new URL(`/invocations/${encodeURIComponent(invocationId)}/cancel`, env.RESTATE_ADMIN_URL), {
    method: 'PATCH',
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error(`Restate refused to cancel invocation (${response.status}).`);
  }
}
