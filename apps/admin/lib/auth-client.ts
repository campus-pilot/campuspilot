'use client';

import { env } from '@campuspilot/env/admin.client';
import { createAuthClient } from 'better-auth/react';
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import type { auth } from '@campuspilot/auth/server';

export const authClient = createAuthClient({
  baseURL: new URL('/api/auth', env.NEXT_PUBLIC_SERVER_URL).toString(),
  plugins: [adminClient(), inferAdditionalFields<typeof auth>()],
});
