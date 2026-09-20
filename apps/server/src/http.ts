import {
  createContext,
  createContextFromHeaders,
} from '@campuspilot/api/context';
import { toRpcError } from '@campuspilot/api/errors';
import { appRouter } from '@campuspilot/api/routers/index';
import {
  handleProfileImageRead,
  handleProfileImageUpload,
} from '@campuspilot/api/routers/auth/auth.http';
import { handleSchoolLogoUpload } from '@campuspilot/api/routers/system-admin/school/school.http';
import { normalizeApiKeyRequest } from '@campuspilot/auth/api-key-headers';
import { auth } from '@campuspilot/auth/server';
import { env } from '@campuspilot/env/server';
import type { Logger } from '@campuspilot/logger';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

import { createConfiguredApp } from './config';
import { log } from './log';
import { buildMcpToolDefinitions, createCampusPilotMcpHandler } from './mcp';

const app = createConfiguredApp();

/** Logs mapped upload failures while request and resource context are present. */
function reportUploadError(
  logger: Logger,
  event: string,
  details: Record<string, unknown>,
  error: unknown,
) {
  const failure = toRpcError(error);
  const payload = { err: error, ...details, status: failure.status };
  if (failure.status >= 500) logger.error(payload, event);
  else logger.warn(payload, event);
}

app.on(['POST', 'GET'], '/api/auth/*', (context) =>
  auth.handler(normalizeApiKeyRequest(context.req.raw)),
);

app.post('/api/blob/schools/:schoolId/logo', async (context) => {
  const schoolId = context.req.param('schoolId');
  const apiContext = await createContext({ context });
  return handleSchoolLogoUpload(context.req.raw, apiContext, schoolId, (error) =>
    reportUploadError(
      context.var.logger,
      'school.logo.upload.error',
      { schoolId },
      error,
    ),
  );
});

app.post('/api/blob/users/me/profile-image', async (context) => {
  const apiContext = await createContext({ context });
  return handleProfileImageUpload(context.req.raw, apiContext, (error) =>
    reportUploadError(
      context.var.logger,
      'user.profile-image.upload.error',
      { userId: apiContext.session?.user.id },
      error,
    ),
  );
});

app.get('/api/blob/users/me/profile-image', async (context) => {
  const apiContext = await createContext({ context });
  return handleProfileImageRead(apiContext, (error) =>
    reportUploadError(
      context.var.logger,
      'user.profile-image.read.error',
      { userId: apiContext.session?.user.id },
      error,
    ),
  );
});

export const mcpTools = buildMcpToolDefinitions(appRouter);

export const mcpHandler = createCampusPilotMcpHandler({
  tools: mcpTools,
  createContext: createContextFromHeaders,
  reportError: (error, toolName) => {
    log.error({ err: error, toolName }, 'mcp.error');
  },
});

app.all('/api/mcp', (context) => mcpHandler.fetch(context.req.raw));

/** Serves the OpenAPI specification and interactive Scalar reference. */
export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      docsTitle: 'CampusPilot API Reference',
      docsConfig: {
        authentication: { preferredSecurityScheme: 'ApiKeyAuth' },
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
          security: [{ ApiKeyAuth: [] }],
        };
      },
    }),
  ],
  interceptors: [
    onError((error) => {
      log.error({ err: error }, 'openapi.error');
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      log.error({ err: error }, 'rpc.error');
    }),
  ],
});

app.use('/*', async (context, next) => {
  const apiContext = await createContext({ context });
  const rpcResult = await rpcHandler.handle(context.req.raw, {
    prefix: '/rpc',
    context: apiContext,
  });
  if (rpcResult.matched) {
    return context.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(context.req.raw, {
    prefix: '/api-reference',
    context: apiContext,
  });
  if (apiResult.matched) {
    return context.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get('/', (context) => context.text('OK'));

export { app };
