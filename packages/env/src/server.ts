import 'dotenv/config';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { DB_ENV_SHAPE } from './server/api-db.env';
import { AUTH_ENV_SHAPE } from './server/auth.env';
import { SERVICES_ENV_SHAPE } from './server/services.env';

export const env = createEnv({
  server: {
    ...AUTH_ENV_SHAPE,
    PUBLIC_APP_URL: z.url(),

    CORS_ORIGIN: z.string().min(1),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    ...DB_ENV_SHAPE,
    ...SERVICES_ENV_SHAPE,
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
