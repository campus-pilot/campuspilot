import { z } from 'zod';

/**
 * Shared secret the API uses to sign every `DemoSchoolControl` call (HMAC-SHA256
 * over handler, input and timestamp) and the worker uses to verify it. Restate
 * OSS ingress does not authenticate callers, so this is what keeps anyone who
 * reaches ingress from starting demo workflows. Read by both the API server
 * and the worker (which serves the control service). Required in production
 * (see {@link requireDemoControlSecretInProduction}); when absent elsewhere,
 * the API cannot sign and the worker refuses every control call.
 */
export const DEMO_CONTROL_ENV_SHAPE = {
  DEMO_CONTROL_SECRET: z.string().min(32, 'Use at least 32 characters (e.g. openssl rand -hex 32).').optional(),
};

/** Final-schema check shared by the server and worker env: the secret is required in production. */
export function requireDemoControlSecretInProduction(
  value: { NODE_ENV?: string; DEMO_CONTROL_SECRET?: string },
  context: z.RefinementCtx,
) {
  if (value.NODE_ENV === 'production' && !value.DEMO_CONTROL_SECRET) {
    context.addIssue({
      code: 'custom',
      path: ['DEMO_CONTROL_SECRET'],
      message: 'DEMO_CONTROL_SECRET is required in production: it authenticates calls to DemoSchoolControl.',
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
  ...DEMO_CONTROL_ENV_SHAPE,
};
