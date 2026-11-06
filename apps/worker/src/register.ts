import { env } from '@campuspilot/env/worker';

import type { log as workerLog } from './log';

type Logger = typeof workerLog;

/**
 * Registers this worker as a Restate deployment. Idempotent: registering the
 * same URI with the same services again succeeds without changes. `force`
 * replaces a registration whose service definitions changed at the same URI,
 * which happens whenever a release (or a dev edit) changes handlers.
 */
export async function registerWorkerDeployment(options: { force?: boolean; signal?: AbortSignal } = {}) {
  const response = await fetch(new URL('/deployments', env.RESTATE_ADMIN_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: env.RESTATE_WORKER_URL, force: options.force ?? false }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Restate deployment registration failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string; services: Array<{ name: string }> };
  return { id: body.id, services: body.services.map((service) => service.name) };
}

/** First wait between registration attempts; doubles up to the cap. */
const RETRY_INITIAL_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Bound for one attempt: Restate calls the worker back before it answers. */
const ATTEMPT_TIMEOUT_MS = 15_000;

/**
 * Registers this worker on every start, retrying until Restate accepts. This
 * replaces a separate deploy-time step: the worker's address is stable (the
 * Kubernetes Service URL), so registering the same address again is harmless,
 * and `force` lets a new release replace changed service definitions there.
 * Every replica and every restart does it.
 *
 * Early attempts are expected to fail in Kubernetes: Restate reaches the worker
 * through its Service, which routes to the pod only once it is marked ready,
 * shortly after it starts listening. Failures are logged and retried with
 * backoff for as long as the process runs; the worker keeps serving
 * meanwhile. Resolves once registered, or when `signal` aborts (shutdown).
 */
export async function registerUntilAccepted(log: Logger, signal: AbortSignal) {
  let wait = RETRY_INITIAL_MS;
  for (let attempt = 1; !signal.aborted; attempt += 1) {
    try {
      const deployment = await registerWorkerDeployment({
        force: true,
        signal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
      });
      log.info({ ...deployment, attempt }, 'worker.registered');
      return;
    } catch (err) {
      if (signal.aborted) return;
      log.warn({ err, attempt, retryInMs: wait }, 'worker.register.retry');
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, wait);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    wait = Math.min(wait * 2, RETRY_MAX_MS);
  }
}
