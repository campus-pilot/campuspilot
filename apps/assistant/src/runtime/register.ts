import { env } from '@campuspilot/env/assistant';

import type { log as serviceLog } from '../log';

type Logger = typeof serviceLog;

/** First wait between registration attempts; doubles up to the cap. */
const RETRY_INITIAL_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Bound for one attempt: Restate calls the service back before it answers. */
const ATTEMPT_TIMEOUT_MS = 15_000;

/**
 * Registers this service as a Restate deployment at `serviceUrl`.
 * Registering the same address again is harmless, and `force` replaces
 * service definitions that changed there (a release, or a dev edit).
 */
async function registerDeployment(serviceUrl: string, signal: AbortSignal) {
  const response = await fetch(new URL('/deployments', env.RESTATE_ADMIN_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: serviceUrl, force: true }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Restate deployment registration failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string; services: Array<{ name: string }> };
  return { id: body.id, services: body.services.map((service) => service.name) };
}

/**
 * Registers on every start, retrying with backoff until Restate accepts,
 * the same way `apps/worker` does (see its `register.ts`). Early attempts
 * can fail while the platform routes traffic to the new instance only after
 * it is ready; the service keeps serving meanwhile. Resolves once
 * registered, or when `signal` aborts (shutdown).
 */
export async function registerUntilAccepted(serviceUrl: string, log: Logger, signal: AbortSignal) {
  let wait = RETRY_INITIAL_MS;
  for (let attempt = 1; !signal.aborted; attempt += 1) {
    try {
      const deployment = await registerDeployment(
        serviceUrl,
        AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
      );
      log.info({ ...deployment, serviceUrl, attempt }, 'assistant.restate.registered');
      return;
    } catch (err) {
      if (signal.aborted) return;
      log.warn({ err, attempt, retryInMs: wait }, 'assistant.restate.register.retry');
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, wait);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    wait = Math.min(wait * 2, RETRY_MAX_MS);
  }
}
