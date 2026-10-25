import 'dotenv/config';
import { createEnv } from '@t3-oss/env-core';
import { DB_ENV_SHAPE } from './server/api-db.env';

/** Minimal environment contract for the isolated database migration process. */
export const env = createEnv({
  server: DB_ENV_SHAPE,
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
