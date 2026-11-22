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
    /**
     * The public website (for example https://campuspilot.in), for links to
     * its pages such as /contact from a personal space whose trial ended
     * (docs/personal-space.md). Its own value, never derived from the API's
     * or the app's address.
     */
    NEXT_PUBLIC_WEBSITE_URL: z.url(),
    NEXT_PUBLIC_ENABLE_THREEJS_CONTROLS: z.boolean().default(false),
  },
  runtimeEnv: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
    NEXT_PUBLIC_WEBSITE_URL: process.env.NEXT_PUBLIC_WEBSITE_URL,
    NEXT_PUBLIC_ENABLE_THREEJS_CONTROLS: process.env.ENABLE_THREEJS_CONTROLS,
  },
  emptyStringAsUndefined: true,
});
