'use client';

import type { AppRouterClient } from '@campuspilot/api/routers/index';
import { env } from '@campuspilot/env/management.client';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { QueryClient } from '@tanstack/react-query';

const link = new RPCLink({
  url: new URL('/rpc', env.NEXT_PUBLIC_SERVER_URL).toString(),
  fetch(url, options) {
    return fetch(url, { ...options, credentials: 'include' });
  },
});

export const client: AppRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

export function createQueryClient() {
  return new QueryClient();
}

