import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// contains env for building apps/web
export const env = createEnv({
  clientPrefix: 'VITE_',
  client: {
    VITE_SERVER_URL: z.url(),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
