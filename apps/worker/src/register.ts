import { env } from '@campuspilot/env/worker';

/**
 * Registers this worker as a Restate deployment. Idempotent: registering the
 * same URI with the same services again succeeds without changes. `force`
 * replaces a registration whose service definitions changed at the same URI,
 * which happens in development when handlers are edited; deployments with a
 * new URI per release do not need it.
 */
export async function registerWorkerDeployment(options: { force?: boolean } = {}) {
  const response = await fetch(new URL('/deployments', env.RESTATE_ADMIN_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: env.RESTATE_WORKER_URL, force: options.force ?? false }),
  });
  if (!response.ok) {
    throw new Error(`Restate deployment registration failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string; services: Array<{ name: string }> };
  return { id: body.id, services: body.services.map((service) => service.name) };
}
