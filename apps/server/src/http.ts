import {
  type Context,
  createContext,
  createContextFromHeaders,
  createOAuthContext,
} from '@campuspilot/api/context';
import { toRpcError } from '@campuspilot/api/errors';
import { appRouter } from '@campuspilot/api/routers/index';
import {
  handleProfileImageRead,
  handleProfileImageUpload,
} from '@campuspilot/api/routers/auth/auth.http';
import { handleSchoolLogoUpload } from '@campuspilot/api/routers/system-admin/school/school.http';
import { handleSchoolLogoBlob } from '@campuspilot/api/routers/school/logo/logo.blob';
import { handleSchoolManifestBlob } from '@campuspilot/api/routers/school/manifest/manifest.blob';
import {
  handleAdmissionDocumentDelete,
  handleAdmissionDocumentRead,
  handleAdmissionDocumentUpload,
  handleAdmissionPhotoRead,
  handleAdmissionPhotoUpload,
} from '@campuspilot/api/routers/school/admission/admission.http';
import { normalizeApiKeyRequest } from '@campuspilot/auth/api-key-headers';
import {
  findLiveOAuthGrant,
  recordOAuthGrantUse,
  verifyMcpAccessToken,
} from '@campuspilot/auth/mcp-credential';
import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import type { Logger } from '@campuspilot/logger';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { AsyncLocalStorage } from 'node:async_hooks';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

import { createConfiguredApp } from './config';
import { log } from './log';
import { buildMcpCatalog, createCampusPilotMcpHandler } from './mcp';
import { createMcpGate } from './mcp-auth';
import { createRateLimit } from './rate-limit';

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

/**
 * `/blob/*` serves public assets at URLs that never expire, without session
 * or permission checks. Use it only for assets that must outlive a presigned
 * URL and are safe for anyone to read (see the root AGENTS.md). Private files
 * stay on the authenticated `/api/blob/*` routes. Each client IP may make 20
 * `/blob/*` requests per second, since no session bounds who can call them.
 */
app.use('/blob/*', createRateLimit({ id: 'blob', limit: 20, windowMs: 1_000 }));

app.get('/blob/school/:schoolId/logo', (context) => {
  const input = {
    schoolId: context.req.param('schoolId'),
    size: context.req.query('size'),
  };
  return handleSchoolLogoBlob({ db }, input, context.req.raw, (error) =>
    reportUploadError(context.var.logger, 'school.logo.blob.error', input, error),
  );
});

app.get('/blob/school/:schoolId/manifest.webmanifest', (context) => {
  const input = { schoolId: context.req.param('schoolId') };
  return handleSchoolManifestBlob({ db }, input, (error) =>
    reportUploadError(context.var.logger, 'school.manifest.blob.error', input, error),
  );
});

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

app.post('/api/blob/schools/:schoolId/admissions/:admissionId/documents/:documentValue', async (context) => {
  const input = {
    schoolId: context.req.param('schoolId'),
    admissionId: context.req.param('admissionId'),
    documentValue: context.req.param('documentValue'),
    documentLabel: context.req.query('label'),
  };
  const apiContext = await createContext({ context });
  return handleAdmissionDocumentUpload(context.req.raw, apiContext, input, (error) =>
    reportUploadError(context.var.logger, 'admission.document.upload.error', input, error),
  );
});

app.post('/api/blob/schools/:schoolId/admissions/:admissionId/photo', async (context) => {
  const input = {
    schoolId: context.req.param('schoolId'),
    admissionId: context.req.param('admissionId'),
  };
  const apiContext = await createContext({ context });
  return handleAdmissionPhotoUpload(context.req.raw, apiContext, input, (error) =>
    reportUploadError(context.var.logger, 'admission.photo.upload.error', input, error),
  );
});

app.get('/api/blob/schools/:schoolId/admissions/:admissionId/photo', async (context) => {
  const input = {
    schoolId: context.req.param('schoolId'),
    admissionId: context.req.param('admissionId'),
  };
  const apiContext = await createContext({ context });
  return handleAdmissionPhotoRead(apiContext, input, (error) =>
    reportUploadError(context.var.logger, 'admission.photo.read.error', input, error),
  );
});

app.get('/api/blob/schools/:schoolId/admissions/:admissionId/documents/:fileId', async (context) => {
  const input = {
    schoolId: context.req.param('schoolId'),
    admissionId: context.req.param('admissionId'),
    fileId: context.req.param('fileId'),
  };
  const apiContext = await createContext({ context });
  return handleAdmissionDocumentRead(apiContext, input, (error) =>
    reportUploadError(context.var.logger, 'admission.document.read.error', input, error),
  );
});

app.delete('/api/blob/schools/:schoolId/admissions/:admissionId/documents/:fileId', async (context) => {
  const input = {
    schoolId: context.req.param('schoolId'),
    admissionId: context.req.param('admissionId'),
    fileId: context.req.param('fileId'),
  };
  const apiContext = await createContext({ context });
  return handleAdmissionDocumentDelete(apiContext, input, (error) =>
    reportUploadError(context.var.logger, 'admission.document.delete.error', input, error),
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

export const mcpCatalog = buildMcpCatalog(appRouter);

/**
 * The context the MCP gate verified, scoped to the async chain serving that
 * request. The SDK serves a copy of the request on some paths, so the context
 * cannot be keyed by the Request object itself.
 */
const mcpRequestContext = new AsyncLocalStorage<Context>();

export const mcpHandler = createCampusPilotMcpHandler({
  catalog: mcpCatalog,
  currentContext: () => mcpRequestContext.getStore(),
  reportError: (error, toolName) => {
    log.error({ err: error, toolName }, 'mcp.error');
  },
  // Usage data for revisiting the core/advanced split.
  reportToolCall: (event) => {
    log.info(event, 'mcp.tool.call');
  },
});

const authenticateMcpRequest = createMcpGate({
  catalog: mcpCatalog,
  resource: env.MCP_RESOURCE_URL,
  verifyAccessToken: (token) => verifyMcpAccessToken(auth, token),
  findLiveGrant: (claims) => findLiveOAuthGrant(db, claims),
  // Only the key authenticates: cookies and other credentials are dropped.
  createApiKeyContext: (apiKey) =>
    createContextFromHeaders(new Headers({ 'x-api-key': apiKey })),
  createOAuthContext,
  recordGrantUse: (grantId) => recordOAuthGrantUse(db, grantId),
});

app.all('/mcp', async (context) => {
  const request = context.req.raw;
  const result = await authenticateMcpRequest(request);
  if (!result.ok) return result.response;
  return mcpRequestContext.run(result.credential.context, () =>
    mcpHandler.fetch(
      request,
      result.credential.authInfo ? { authInfo: result.credential.authInfo } : {},
    ),
  );
});

/**
 * OAuth discovery documents, public by protocol (D4). RFC 9728 protected
 * resource metadata is served by the Better Auth `mcp()` plugin at the origin
 * root and at the resource-path alias; RFC 8414 / OIDC discovery for the
 * `/api/auth` issuer is also served at the path-inserted URLs clients try
 * first. Better Auth itself serves `/api/auth/.well-known/*` (Gemini's
 * append style) with the same issuer. These are Better Auth documents, not
 * application auth handlers, so they live here rather than as oRPC
 * procedures (recorded exception in packages/api/AGENTS.md).
 */
app.get('/.well-known/oauth-protected-resource', (context) =>
  auth.handler(context.req.raw),
);
app.get('/.well-known/oauth-protected-resource/*', (context) =>
  auth.handler(context.req.raw),
);
app.get('/.well-known/oauth-authorization-server/api/auth', async (context) =>
  context.json(await auth.api.getOAuthServerConfig()),
);
app.get('/.well-known/openid-configuration/api/auth', async (context) =>
  context.json(await auth.api.getOpenIdConfig()),
);

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
