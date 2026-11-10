import { z } from 'zod';

/**
 * Shared secret the API uses to sign every call to a worker service reachable
 * through Restate ingress (HMAC-SHA256 over service, handler, input and
 * timestamp; today `DemoSchoolControl`) and the worker uses to verify it.
 * Restate OSS ingress does not authenticate callers, so this is what keeps
 * anyone who reaches ingress from starting workflows. It belongs to the worker
 * as a whole, not to one workflow. Read by both the API server and the worker.
 * Required in production (see {@link requireWorkerControlSecretInProduction});
 * when absent elsewhere, the API cannot sign and the worker refuses every
 * control call.
 */
export const WORKER_CONTROL_ENV_SHAPE = {
  WORKER_CONTROL_SECRET: z.string().min(32, 'Use at least 32 characters (e.g. openssl rand -hex 32).').optional(),
};

/** Final-schema check shared by the server and worker env: the secret is required in production. */
export function requireWorkerControlSecretInProduction(
  value: { NODE_ENV?: string; WORKER_CONTROL_SECRET?: string },
  context: z.RefinementCtx,
) {
  if (value.NODE_ENV === 'production' && !value.WORKER_CONTROL_SECRET) {
    context.addIssue({
      code: 'custom',
      path: ['WORKER_CONTROL_SECRET'],
      message: 'WORKER_CONTROL_SECRET is required in production: it authenticates calls to worker services through Restate ingress.',
    });
  }
}

export const SERVICES_ENV_SHAPE = {
  GOTENBERG_URL: z.url(),
  OPA_URL: z.url(),
  REDIS_URL: z.url(),
  RESTATE_ADMIN_URL: z.url(),
  RESTATE_FABRIC_URL: z.url(),
  RESTATE_INGRESS_URL: z.url(),
  ...WORKER_CONTROL_ENV_SHAPE,
};
