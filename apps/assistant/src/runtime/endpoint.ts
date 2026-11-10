import { createServer } from 'node:http2';

import { env } from '@campuspilot/env/assistant';
import { createEndpointHandler } from '@restatedev/restate-sdk';

import { log } from '../log';
import { createAssistantConversationObject } from './conversation';
import { providerRegistry } from './providers/registry';
import { registerUntilAccepted } from './register';

/** The running Restate endpoint, for shutdown. */
export type RestateEndpoint = {
  /** Stops registering, refuses new invocations and resolves once in-flight ones have let go. */
  close: () => Promise<void>;
};

/**
 * Serves the conversation object to Restate on its own HTTP/2 server, as
 * `apps/worker` does: `restate.serve` offers no way to close its server, so
 * the handler is mounted on one this service owns, which shutdown can close.
 * Restate resumes any turn that was interrupted.
 *
 * Request signing is not used, as for the worker: Restate and this endpoint
 * run in the same private network and the endpoint is never routed from
 * outside it. Once listening, the service registers itself with Restate in
 * the background when `RESTATE_SERVICE_URL` is set (see `registerUntilAccepted`).
 */
export function startRestateEndpoint(): Promise<RestateEndpoint> {
  const providers = providerRegistry();
  const handler = createEndpointHandler({
    services: [createAssistantConversationObject({ providers, log })],
  });
  const server = createServer(handler);
  const registration = new AbortController();
  return new Promise((resolve) => {
    server.listen(env.RESTATE_SERVICE_PORT, () => {
      log.info({ port: env.RESTATE_SERVICE_PORT }, 'assistant.restate.listening');
      if (env.RESTATE_SERVICE_URL) {
        void registerUntilAccepted(env.RESTATE_SERVICE_URL, log, registration.signal);
      }
      if (providers.current) {
        log.info({ provider: providers.current.id, model: providers.current.model }, 'assistant.provider');
      } else {
        log.warn({ reason: providers.unavailableReason }, 'assistant.not-configured');
      }
      resolve({
        close: () => {
          registration.abort();
          return new Promise((closed) => server.close(() => closed()));
        },
      });
    });
  });
}
