'use client';

import type { AppRouterClient } from '@campuspilot/api/routers/index';
import { env } from '@campuspilot/env/management.client';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { featureFlagsOutdatedBy } from '@/components/require-feature-model';

const link = new RPCLink({
  url: new URL('/rpc', env.NEXT_PUBLIC_SERVER_URL).toString(),
  fetch(url, options) {
    return fetch(url, { ...options, credentials: 'include' });
  },
});

export const client: AppRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

/**
 * The app's query client. Any query or mutation the server refuses because
 * a school feature is switched off (the disabled-feature error, see
 * docs/feature-flags.md) means the flags this app holds are out of date:
 * they are read again at once, so the feature's navigation, actions and
 * pages close without waiting for the next refetch. Handled here, once, so
 * no screen has to remember to do it.
 */
export function createQueryClient() {
  const refreshOutdatedFlags = (error: unknown) => {
    if (featureFlagsOutdatedBy(error)) void queryClient.invalidateQueries({ queryKey: orpc.school.getFeatureFlags.key() });
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: refreshOutdatedFlags }),
    mutationCache: new MutationCache({ onError: refreshOutdatedFlags }),
  });
  return queryClient;
}

