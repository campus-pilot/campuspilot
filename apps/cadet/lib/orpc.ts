'use client';

import type { CadetRouterClient } from '@campuspilot/api/routers/cadet/cadet.router';
import { env } from '@campuspilot/env/cadet.client';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { isSchoolSuspendedError } from '@campuspilot/api/school-access/school-access.contract';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { shouldRetryQuery } from './query-retry';

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

/**
 * The portal's query client. A change the server refuses because the
 * school is suspended (the suspended-school error, see
 * docs/school-suspension.md) means the school this app holds is out of
 * date: it is read again at once, so the suspended-school notice appears in
 * a portal that was open when the school was suspended. The refused change
 * is not retried (mutations never are here), and the screen that asked
 * handles it as it handles any failure.
 */
export function createQueryClient() {
  const refreshSuspendedSchool = (error: unknown) => {
    if (isSchoolSuspendedError(error)) void queryClient.invalidateQueries({ queryKey: orpc.getSchool.key() });
  };
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: shouldRetryQuery } },
    queryCache: new QueryCache({ onError: refreshSuspendedSchool }),
    mutationCache: new MutationCache({ onError: refreshSuspendedSchool }),
  });
  return queryClient;
}
