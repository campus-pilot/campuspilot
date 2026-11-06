'use client';

import type { CadetRouterClient } from '@campuspilot/api/routers/cadet/cadet.router';
import { env } from '@campuspilot/env/cadet.client';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { QueryClient } from '@tanstack/react-query';

/**
 * The Cadet Portal talks only to `/api/cadet/rpc` (`cadetRouter`), never to
 * the staff `/rpc`. The `cpc_` session cookie identifies the student.
 */
const link = new RPCLink({
  url: new URL('/api/cadet/rpc', env.NEXT_PUBLIC_SERVER_URL).toString(),
  fetch(url, options) {
    return fetch(url, { ...options, credentials: 'include' });
  },
});

export const client: CadetRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

export function createQueryClient() {
  return new QueryClient();
}
