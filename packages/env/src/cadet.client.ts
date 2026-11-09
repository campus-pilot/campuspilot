import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Environment exposed to the Cadet Portal app (`apps/cadet`). */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {
    NEXT_PUBLIC_SERVER_URL: z.url(),
    /**
     * The web push application server key (base64url), the same value as
     * the server's VAPID_PUBLIC_KEY. Optional: without it the portal does
     * not offer to turn on notifications on this device.
     */
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/).optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  emptyStringAsUndefined: true,
});
