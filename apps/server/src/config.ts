import { env } from '@campuspilot/env/server';
import { logger as rootLogger } from '@campuspilot/logger';
import { pinoLogger, type LoggerVariables } from '@campuspilot/logger/hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

/** Creates the transport shell and applies cross-cutting HTTP configuration. */
export function createConfiguredApp() {
  const app = new Hono<{ Variables: LoggerVariables }>();
  const configuredOrigins = env.CORS_ORIGIN.split(',').map((origin) =>
    origin.trim(),
  );
  const authOrigin = env.BETTER_AUTH_URL
    ? new URL(env.BETTER_AUTH_URL).origin
    : undefined;
  const allowedOrigins = new Set(
    [...configuredOrigins, authOrigin].filter(
      (origin): origin is string => Boolean(origin),
    ),
  );

  app.use(pinoLogger());
  app.use(
    '/*',
    cors({
      origin: (origin, context) => {
        if (!origin) return null;
        const host = context.req.header('host');
        if (
          host &&
          (origin === `http://${host}` || origin === `https://${host}`)
        ) {
          return origin;
        }
        return allowedOrigins.has(origin) ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'x-api-key'],
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

  return app;
}
