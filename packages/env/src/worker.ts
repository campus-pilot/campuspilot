import 'dotenv/config';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

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
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
