'use client';

import type { AssistantContract } from '@campuspilot/assistant-contract/contract';
import { env } from '@campuspilot/env/management.client';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

export type AssistantClient = ContractRouterClient<AssistantContract>;

/**
 * Client for the separate assistant service. It sends the CampusPilot session
 * cookie, which the service checks with the API. Null when this deployment
 * has no assistant (`NEXT_PUBLIC_ASSISTANT_URL` unset).
 */
export const assistantClient: AssistantClient | null = env.NEXT_PUBLIC_ASSISTANT_URL
  ? createORPCClient(
      new RPCLink({
        url: new URL('/rpc', env.NEXT_PUBLIC_ASSISTANT_URL).toString(),
        fetch(url, options) {
          return fetch(url, { ...options, credentials: 'include' });
        },
      }),
    )
  : null;

export const assistantOrpc = assistantClient
  ? createTanstackQueryUtils(assistantClient, { path: ['assistant'] })
  : null;
