import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Environment exposed to the statically exported management application.
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {
    NEXT_PUBLIC_SERVER_URL: z.url(),
    NEXT_PUBLIC_ENABLE_THREEJS_CONTROLS: z.boolean().default(false),
  },
  runtimeEnv: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_ENABLE_THREEJS_CONTROLS: process.env.ENABLE_THREEJS_CONTROLS,
  },
  emptyStringAsUndefined: true,
});
