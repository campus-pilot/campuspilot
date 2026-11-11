import { env } from '@campuspilot/env/server';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';

import { log } from './log';
import { assistantRouter } from './router';

/** Where the API server mounts the assistant's browser procedures (`/model/rpc/<procedure>`). */
export const ASSISTANT_RPC_PREFIX = '/model/rpc';

/**
 * The assistant's browser procedures over oRPC, served by the API server at
 * {@link ASSISTANT_RPC_PREFIX} with the user's CampusPilot session cookie.
 *
 * CORS (the API's `applicationCors`) only stops another site from reading a
 * response; the browser still sends the request, with the user's cookie. So
 * a request that names an origin outside `CORS_ORIGIN` is refused before it
 * runs. Browsers put `Origin` on every cross-site request that can change
 * something; a request without one comes from a server or a script, which
 * has no user's cookie to borrow.
 *
 * Returns null when no procedure matches, so the server can answer 404.
 */
export function createAssistantRequestHandler() {
  const allowedOrigins = new Set(env.CORS_ORIGIN.split(',').map((origin) => origin.trim()));
  const rpcHandler = new RPCHandler(assistantRouter, {
    interceptors: [
      onError((error) => {
        log.error({ err: error }, 'assistant.rpc.error');
      }),
    ],
  });

  return async (request: Request): Promise<Response | null> => {
    const origin = request.headers.get('origin');
    if (origin !== null && !allowedOrigins.has(origin)) {
      log.warn({ origin, path: new URL(request.url).pathname }, 'assistant.rpc.origin.refused');
      return new Response('Forbidden', { status: 403 });
    }
    const result = await rpcHandler.handle(request, {
      prefix: ASSISTANT_RPC_PREFIX,
      context: { headers: request.headers },
    });
    return result.matched ? result.response : null;
  };
}
