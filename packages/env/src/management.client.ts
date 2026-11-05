import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Environment exposed to the statically exported management application.
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {
    NEXT_PUBLIC_SERVER_URL: z.url(),
    /**
     * Public MCP endpoint users paste into AI clients. Its own value, not
     * derived from NEXT_PUBLIC_SERVER_URL; it must equal the server's
     * MCP_RESOURCE_URL.
     */
    NEXT_PUBLIC_MCP_URL: z.url(),
    NEXT_PUBLIC_ENABLE_THREEJS_CONTROLS: z.boolean().default(false),
    /**
     * Public URL of the assistant service (apps/assistant). Optional: when
     * unset the deployment has no assistant and its UI is not shown.
     */
    NEXT_PUBLIC_ASSISTANT_URL: z.url().optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
    NEXT_PUBLIC_ENABLE_THREEJS_CONTROLS: process.env.ENABLE_THREEJS_CONTROLS,
    NEXT_PUBLIC_ASSISTANT_URL: process.env.NEXT_PUBLIC_ASSISTANT_URL,
  },
  emptyStringAsUndefined: true,
});
