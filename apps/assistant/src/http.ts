import { env } from '@campuspilot/env/assistant';
import { logger as rootLogger } from '@campuspilot/logger';
import { pinoLogger, type LoggerVariables } from '@campuspilot/logger/hono';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { log } from './log';
import { assistantRouter } from './router';

/** The assistant's own HTTP API, called by the management app with the user's cookie. */
export function createAssistantApp() {
  const app = new Hono<{ Variables: LoggerVariables }>();
  const allowedOrigins = new Set(env.CORS_ORIGIN.split(',').map((origin) => origin.trim()));

  app.use(pinoLogger());
  app.use(
    '/*',
    cors({
      origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      credentials: true,
    }),
  );
  app.onError((error, context) => {
    (context.var.logger ?? rootLogger).error(
      { err: error, path: context.req.path, method: context.req.method },
      'hono.unhandled',
    );
    return context.text('Internal Server Error', 500);
  });

  const rpcHandler = new RPCHandler(assistantRouter, {
    interceptors: [
      onError((error) => {
        log.error({ err: error }, 'rpc.error');
      }),
    ],
  });

  app.use('/rpc/*', async (context, next) => {
    const result = await rpcHandler.handle(context.req.raw, {
      prefix: '/rpc',
      context: { headers: context.req.raw.headers },
    });
    if (result.matched) return context.newResponse(result.response.body, result.response);
    await next();
  });

  app.get('/', (context) => context.text('OK'));
  return app;
}
