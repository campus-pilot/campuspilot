import 'dotenv/config';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { DEMO_CONTROL_ENV_SHAPE, requireDemoControlSecretInProduction } from './server/services.env';

/**
 * Environment of `apps/worker`, the Restate endpoint host. The workflows it
 * serves also read the API server environment (`@campuspilot/env/server`);
 * these are only the worker's own settings.
 */
export const env = createEnv({
  server: {
    /** Port the Restate endpoint listens on. */
    WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(9080),
    /**
     * The URI Restate uses to reach this worker, registered as its deployment
     * (e.g. `http://host.docker.internal:9080` when Restate runs in Docker).
     * Its own value: it is not derivable from the port or host name.
     */
    RESTATE_WORKER_URL: z.url(),
    RESTATE_ADMIN_URL: z.url(),
    /**
     * Comma-separated Restate request identity public keys
     * (`publickeyv1_…`). When set, the worker accepts only requests signed by
     * that Restate server. Required in production; when absent outside
     * production (local dev), requests are accepted unsigned.
     */
    RESTATE_IDENTITY_KEYS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value.split(',').map((key) => key.trim()).filter(Boolean)
          : undefined,
      )
      .pipe(z.array(z.string().regex(/^publickeyv1_[A-Za-z0-9]+$/)).min(1).optional()),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    /** Verifies `DemoSchoolControl` calls; the same value as the API server's. */
    ...DEMO_CONTROL_ENV_SHAPE,
  },
  createFinalSchema: (shape) =>
    z.object(shape).superRefine((value, context) => {
      if (value.NODE_ENV === 'production' && !value.RESTATE_IDENTITY_KEYS) {
        context.addIssue({
          code: 'custom',
          path: ['RESTATE_IDENTITY_KEYS'],
          message: 'RESTATE_IDENTITY_KEYS is required in production so the worker accepts only signed Restate requests.',
        });
      }
      requireDemoControlSecretInProduction(value, context);
    }),
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
