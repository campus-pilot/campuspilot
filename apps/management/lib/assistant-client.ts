'use client';

import type { AssistantContract } from '@campuspilot/assistant-contract/contract';
import { env } from '@campuspilot/env/management.client';
import { createORPCClient, onError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

import { notifyIfSchoolSuspended } from './orpc';

export type AssistantClient = ContractRouterClient<AssistantContract>;

/**
 * Client for the in-app assistant's procedures, which the API server serves
 * at `/model/rpc` on its own origin. It sends the CampusPilot session cookie
 * like every other API call. Whether the assistant is shown at all is the
 * school's `assistant` feature and the user's access (`AssistantAccess`),
 * never whether this client exists.
 */
export const assistantClient: AssistantClient = createORPCClient(
  new RPCLink({
    url: new URL('/model/rpc', env.NEXT_PUBLIC_SERVER_URL).toString(),
    fetch(url, options) {
      return fetch(url, { ...options, credentials: 'include' });
    },
    // A message refused because the school is suspended refreshes the school list, as for every other call.
    interceptors: [onError(notifyIfSchoolSuspended)],
  }),
);

export const assistantOrpc = createTanstackQueryUtils(assistantClient, { path: ['assistant'] });
