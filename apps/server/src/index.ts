import { createContext } from '@campuspilot/api/context';
import { appRouter } from '@campuspilot/api/routers/index';
import { auth } from '@campuspilot/auth/server';
import { env } from '@campuspilot/env/server';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { logger as rootLogger } from '@campuspilot/logger';
import { pinoLogger, type LoggerVariables } from '@campuspilot/logger/hono';

import { log } from './log';
const app = new Hono<{ Variables: LoggerVariables }>();

app.use(pinoLogger());
app.use(
  '/*',
  cors({
    origin: env.CORS_ORIGIN.split(','),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.post('/api/account/set-password', async (c) => {
  const body = (await c.req.json()) as { newPassword?: unknown };
  if (typeof body.newPassword !== 'string') {
    return c.json({ message: 'A new password is required.' }, 400);
  }

  try {
    const result = await auth.api.setPassword({
      body: { newPassword: body.newPassword },
      headers: c.req.raw.headers,
    });
    return c.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to set password.';
    return c.json({ message }, 400);
  }
});

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use('/*', async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: '/rpc',
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: '/api-reference',
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get('/', (c) => {
  return c.text('OK');
});

app.onError((err, c) => {
  (c.var.logger ?? rootLogger).error(
    { err, path: c.req.path, method: c.req.method },
    'hono.unhandled',
  );
  return c.text('Internal Server Error', 500);
});

import { serve } from '@hono/node-server';
import { runMigrations } from '@campuspilot/db/migrate';

async function phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  log.info({ phase: name }, 'boot.phase.start');
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);
    log.info({ phase: name, durationMs }, 'boot.phase.ok');
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    log.error({ phase: name, durationMs, err }, 'boot.phase.fail');
    throw err;
  }
}

async function main() {
  await phase('db.migrate', () => runMigrations());
  // await phase('auth.seed', () => seedIamDatabase());

  const server = serve(
    {
      fetch: app.fetch,
      port: 3000,
    },
    (info) => {
      log.info(
        { port: info.port, url: `http://localhost:${info.port}` },
        'boot.server.listening',
      );
    },
  );

  const shutdown = (signal: string) => {
    log.info({ signal }, 'boot.shutdown.start');
    server.close((err) => {
      if (err) log.error({ err }, 'boot.shutdown.error');
      else log.info('boot.shutdown.ok');
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'boot.failed');
  process.exit(1);
});
