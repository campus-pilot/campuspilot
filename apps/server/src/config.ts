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

  /**
   * OAuth discovery documents and signing keys are public (D4): any origin may
   * GET them without credentials, so browser-based MCP clients can discover
   * the authorization server. Public `/blob/*` assets follow the same rule.
   */
  const publicDiscoveryCors = cors({
    origin: '*',
    allowMethods: ['GET', 'OPTIONS'],
    credentials: false,
  });
  const isPublicDiscoveryPath = (path: string) =>
    path.startsWith('/.well-known/') ||
    path.startsWith('/api/auth/.well-known/') ||
    path === '/api/auth/jwks' ||
    path.startsWith('/blob/');

  const applicationCors = cors({
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
  });

  app.use(pinoLogger());
  app.use('/*', async (context, next) =>
    isPublicDiscoveryPath(context.req.path)
      ? publicDiscoveryCors(context, next)
      : applicationCors(context, next),
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
