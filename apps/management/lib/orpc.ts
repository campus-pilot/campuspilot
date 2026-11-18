'use client';

import type { AppRouterClient } from '@campuspilot/api/routers/index';
import { env } from '@campuspilot/env/management.client';
import { createORPCClient, onError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { featureFlagsOutdatedBy, schoolListOutdatedBy } from '@/components/require-feature-model';

/**
 * Called when the server refuses a change because the school is read-only:
 * suspended (docs/school-suspension.md) or without an active plan
 * (docs/school-billing.md). Module state, because the refusal is seen by
 * the link (below) while what must be refreshed lives in the query client:
 * the app's query client registers its refresh here once it exists. One
 * slot, not a list: the browser has one query client, and a newer one (a
 * remount in development) simply replaces the older.
 */
let refreshSchoolList: (() => void) | null = null;

/**
 * Link interceptor callback: a call refused with the suspended-school or
 * no-plan error means the school list this app holds (`isSuspended`,
 * `hasActivePlan`) is out of date. It
 * sits on the link rather than on the query client's caches because most
 * saves here call `client.*` directly inside a form submit, which the
 * caches never see. The error itself is passed on untouched: the screen
 * that asked shows the server's message, like every other failed save.
 */
export function notifyIfSchoolReadOnly(error: unknown) {
  if (schoolListOutdatedBy(error)) refreshSchoolList?.();
}

const link = new RPCLink({
  url: new URL('/rpc', env.NEXT_PUBLIC_SERVER_URL).toString(),
  fetch(url, options) {
    return fetch(url, { ...options, credentials: 'include' });
  },
  interceptors: [onError(notifyIfSchoolReadOnly)],
});

export const client: AppRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

/**
 * Query data that holds something outside the JavaScript heap (a PDF opened
 * with pdf.js keeps a worker and its parsed pages) has a `release` method; it
 * is called when the cache drops the query, after its last viewer left and
 * its `gcTime` passed.
 */
function releaseHeldData(data: unknown) {
  if (data && typeof data === 'object' && 'release' in data && typeof data.release === 'function') {
    Promise.resolve(data.release()).catch(() => undefined);
  }
}

/**
 * The app's query client. Two server refusals mean something this app holds
 * about the school is out of date, and it is read again at once, so no
 * screen has to remember to do it:
 * - a school feature is switched off (the disabled-feature error, see
 *   docs/feature-flags.md), for any query or mutation: the flags are read
 *   again, so the feature's navigation, actions and pages close without
 *   waiting for the next refetch;
 * - the school is read-only (the suspended-school or no-plan error, see
 *   docs/school-suspension.md and docs/school-billing.md), for any call
 *   through {@link client} or the assistant client: the user's school list
 *   is read again, so the read-only warning appears in a tab that was open
 *   when the school was suspended or its trial ended.
 */
export function createQueryClient() {
  const refreshOutdatedFlags = (error: unknown) => {
    if (featureFlagsOutdatedBy(error)) void queryClient.invalidateQueries({ queryKey: orpc.school.getFeatureFlags.key() });
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: refreshOutdatedFlags }),
    mutationCache: new MutationCache({ onError: refreshOutdatedFlags }),
  });
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') releaseHeldData(event.query.state.data);
  });
  // In the browser only: the server renders a provider per request and makes
  // no calls through the link, so there is nothing to refresh there.
  if (typeof window !== 'undefined') {
    refreshSchoolList = () => void queryClient.invalidateQueries({ queryKey: orpc.school.listMySchools.key() });
  }
  return queryClient;
}
