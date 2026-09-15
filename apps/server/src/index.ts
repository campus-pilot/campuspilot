import {
  createContext,
  createContextFromHeaders,
} from '@campuspilot/api/context';
import { handleSchoolLogoUpload } from '@campuspilot/api/routers/system-admin/school/school.http';
import { toRpcError } from '@campuspilot/api/errors';
import { appRouter } from '@campuspilot/api/routers/index';
import { normalizeApiKeyRequest } from '@campuspilot/auth/api-key-headers';
import { auth } from '@campuspilot/auth/server';
import { env } from '@campuspilot/env/server';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { logger as rootLogger, type Logger } from '@campuspilot/logger';
import { pinoLogger, type LoggerVariables } from '@campuspilot/logger/hono';

import { log } from './log';
import { buildMcpToolDefinitions, createCampusPilotMcpHandler } from './mcp';

const app = new Hono<{ Variables: LoggerVariables }>();

/**
 * The logo handlers return mapped error responses, so those failures never
 * reach Hono's global error hook. Log the original exception here while the
 * request-scoped logger and operation context are still available.
 */
function reportSchoolLogoError(
  logger: Logger,
  schoolId: string,
  error: unknown,
) {
  const failure = toRpcError(error);
  const details = { err: error, schoolId, status: failure.status };
  const event = 'school.logo.upload.error';

  if (failure.status >= 500) logger.error(details, event);
  else logger.warn(details, event);
}

/**
 * Whitelist origins for browser requests: configured frontend apps, auth baseURL,
 * and same-origin requests (such as the interactive Scalar API reference hosted at /api-reference).
 */
const configuredOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
const authOrigin = env.BETTER_AUTH_URL
  ? new URL(env.BETTER_AUTH_URL).origin
  : undefined;
const allowedOrigins = new Set(
  [...configuredOrigins, authOrigin].filter((o): o is string => Boolean(o)),
);

app.use(pinoLogger());
app.use(
  '/*',
  cors({
    origin: (origin, c) => {
      if (!origin) return null;
      const host = c.req.header('host');
      if (
        host &&
        (origin === `http://${host}` || origin === `https://${host}`)
      ) {
        return origin;
      }
      if (allowedOrigins.has(origin)) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'x-api-key'],
    credentials: true,
  }),
);

app.on(['POST', 'GET'], '/api/auth/*', (c) =>
  auth.handler(normalizeApiKeyRequest(c.req.raw)),
);

app.post('/api/blob/schools/:schoolId/logo', async (c) => {
  const schoolId = c.req.param('schoolId');
  const context = await createContext({ context: c });
  return handleSchoolLogoUpload(c.req.raw, context, schoolId, (error) =>
    reportSchoolLogoError(c.var.logger, schoolId, error),
  );
});

const mcpTools = buildMcpToolDefinitions(appRouter);

export const mcpHandler = createCampusPilotMcpHandler({
  tools: mcpTools,
  createContext: createContextFromHeaders,
  reportError: (error, toolName) => {
    log.error({ err: error, toolName }, 'mcp.error');
  },
});

app.all('/api/mcp', (c) => mcpHandler.fetch(c.req.raw));

/**
 * Serves the OpenAPI specification and interactive Scalar API reference at /api-reference.
 * While the reference UI lives at /api-reference, the target server for oRPC endpoints
 * is explicitly configured as /rpc with x-api-key authentication so that reference
 * documentation and client code samples target the actual RPC endpoints directly.
 */
export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      docsTitle: 'CampusPilot API Reference',
      docsConfig: {
        authentication: {
          preferredSecurityScheme: 'ApiKeyAuth',
        },
      },
      specGenerateOptions: (options) => {
        const origin = options?.request?.url?.origin ?? env.BETTER_AUTH_URL;
        return {
          info: {
            title: 'CampusPilot API Reference',
            version: '0.0.0',
            description:
              'API Reference for CampusPilot RPC services. Endpoints are served at /rpc and authenticate via the x-api-key header.',
          },
          servers: [
            {
              url: new URL('/rpc', origin).toString(),
              description: 'oRPC Server',
            },
          ],
          components: {
            securitySchemes: {
              ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'x-api-key',
                description: 'User API key token (sent as x-api-key: token)',
              },
            },
          },
          security: [
            {
              ApiKeyAuth: [],
            },
          ],
        };
      },
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
  await phase('mcp.catalog', async () => {
    await mcpTools;
  });
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
    void mcpHandler.close().catch((err) => {
      log.error({ err }, 'mcp.shutdown.error');
    });
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
