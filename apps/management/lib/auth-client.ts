'use client';

import { env } from '@campuspilot/env/management.client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { auth } from '@campuspilot/auth/server';

export const authClient = createAuthClient({
  baseURL: new URL('/api/auth', env.NEXT_PUBLIC_SERVER_URL).toString(),
  plugins: [inferAdditionalFields<typeof auth>()],
});
