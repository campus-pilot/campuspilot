import {
  type Context,
  createContext,
  createAssistantContext,
  createContextFromHeaders,
  createOAuthContext,
} from '@campuspilot/api/context';
import { createAssistantRequestHandler } from '@campuspilot/assistant/http';
import { verifyAssistantToken } from '@campuspilot/auth/assistant-token';
import {
  type CadetContext,
  createCadetContextFromHeaders,
  createCadetOAuthContext,
} from '@campuspilot/api/cadet/context';
import { toRpcError } from '@campuspilot/api/errors';
import { cadetRouter } from '@campuspilot/api/routers/cadet/cadet.router';
import { appRouter } from '@campuspilot/api/routers/index';
import {
  handleProfileImageRead,
  handleProfileImageUpload,
} from '@campuspilot/api/routers/auth/auth.http';
import { handleSchoolLogoUpload } from '@campuspilot/api/routers/system-admin/school/school.http';
import { handleSchoolLogoBlob } from '@campuspilot/api/routers/school/logo/logo.blob';
import {
  handleQuestionPaperPageRead,
  handleQuestionPaperPageUpload,
} from '@campuspilot/api/routers/school/question-paper/question-paper.http';
import { handleSchoolManifestBlob } from '@campuspilot/api/routers/school/manifest/manifest.blob';
import { handleCadetManifestBlob } from '@campuspilot/api/routers/school/manifest/cadet-manifest.blob';
import {
  handleWhatsAppWebhook,
  handleWhatsAppWebhookVerification,
  whatsappWebhookConfigFromEnv,
} from '@campuspilot/api/notifications/channels/whatsapp/webhook';
import {
  handleAdmissionDocumentDelete,
  handleAdmissionDocumentRead,
  handleAdmissionDocumentUpload,
  handleAdmissionPhotoRead,
  handleAdmissionPhotoUpload,
} from '@campuspilot/api/routers/school/admission/admission.http';
import { normalizeApiKeyRequest } from '@campuspilot/auth/api-key-headers';
import { cadetAuth, cadetOauthIssuer } from '@campuspilot/auth/cadet';
import { CADET_MCP_DEFAULT_SCOPES } from '@campuspilot/auth/cadet-policy';
import {
  CADET_OAUTH_GRANT_TABLES,
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

/** Installs a school's Cadet Portal as its own app (school name and logo only). */
app.get('/blob/school/:schoolId/cadet.webmanifest', (context) => {
  const input = { schoolId: context.req.param('schoolId') };
  return handleCadetManifestBlob({ db }, input, (error) =>
    reportUploadError(context.var.logger, 'school.cadet-manifest.blob.error', input, error),
  );
});

/**
 * WhatsApp Cloud API webhook (Meta): GET answers the subscription check,
 * POST carries delivery receipts and inbound messages (STOP → consent
 * withdrawn), trusted only after the X-Hub-Signature-256 check over the raw
 * body. 404 while the webhook secrets are not configured.
 */
app.get('/webhooks/whatsapp', (context) =>
  handleWhatsAppWebhookVerification(
    whatsappWebhookConfigFromEnv(),
    new URL(context.req.url).searchParams,
  ),
);
app.post('/webhooks/whatsapp', (context) => handleWhatsAppWebhook(context.req.raw));

/**
 * The Cadet Portal's own Better Auth instance (`cpc_` cookies, cadet tables,
 * admission sign-in, cadet MCP OAuth). API keys do not exist for cadets, so
 * the request is passed through unchanged.
 */
app.on(['POST', 'GET'], '/api/cadet/auth/*', (context) =>
  cadetAuth.handler(context.req.raw),
);

/**
 * `cadetRouter` over RPC for the Cadet Portal app. Its context is resolved by
 * the cadet instance only, so staff cookies and API keys are anonymous here,
 * and `appRouter` is never reachable through this handler.
 */
export const cadetRpcHandler = new RPCHandler(cadetRouter, {
  interceptors: [
    onError((error) => {
      log.error({ err: error }, 'cadet.rpc.error');
    }),
  ],
});

/**
 * `searchSchools` and `getSignInSchool` are the public cadet procedures (the
 * sign-in page calls them as the student types and picks), so each client IP
 * may call them 30 times per 10 s together. Registered before the RPC handler
 * so the limit runs first.
 */
const cadetSignInSchoolRateLimit = createRateLimit({
  id: 'cadet-sign-in-school',
  limit: 30,
  windowMs: 10_000,
});
app.use('/api/cadet/rpc/searchSchools', cadetSignInSchoolRateLimit);
app.use('/api/cadet/rpc/getSignInSchool', cadetSignInSchoolRateLimit);

app.all('/api/cadet/rpc/*', async (context) => {
  const cadetContext: CadetContext = await createCadetContextFromHeaders(
    context.req.raw.headers,
  );
  const result = await cadetRpcHandler.handle(context.req.raw, {
    prefix: '/api/cadet/rpc',
    context: cadetContext,
  });
  if (!result.matched) return context.notFound();
  return context.newResponse(result.response.body, result.response);
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

/**
 * Question paper page photos. Each client IP may upload 30 pages a minute (a
 * 20 page paper plus retries); the photo itself is capped at 15 MiB by the
 * handler. Reads are not limited here: they are permissioned redirects.
 */
const QUESTION_PAPER_PAGES_PATH =
  '/api/blob/schools/:schoolId/sessions/:sessionId/exams/:examSlug/classes/:classId/question-papers/:subjectSlug/:modeSlug/pages';
const questionPaperUploadRateLimit = createRateLimit({
  id: 'question-paper-upload',
  limit: 30,
  windowMs: 60_000,
});

/** The paper a question paper route names; the handlers validate every part. */
const questionPaperKey = (context: { req: { param: (name: string) => string } }) => ({
  schoolId: context.req.param('schoolId'),
  sessionId: context.req.param('sessionId'),
  examSlug: context.req.param('examSlug'),
  classId: context.req.param('classId'),
  subjectSlug: context.req.param('subjectSlug'),
  modeSlug: context.req.param('modeSlug'),
});

app.post(QUESTION_PAPER_PAGES_PATH, questionPaperUploadRateLimit, async (context) => {
  const key = questionPaperKey(context);
  const apiContext = await createContext({ context });
  return handleQuestionPaperPageUpload(context.req.raw, apiContext, key, (error) =>
    reportUploadError(context.var.logger, 'question-paper.page.upload.error', key, error),
  );
});

app.get(`${QUESTION_PAPER_PAGES_PATH}/:pageId/:variant`, async (context) => {
  const key = questionPaperKey(context);
  const apiContext = await createContext({ context });
  return handleQuestionPaperPageRead(
    apiContext,
    key,
    { pageId: context.req.param('pageId'), variant: context.req.param('variant') },
    (error) => reportUploadError(context.var.logger, 'question-paper.page.read.error', key, error),
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

/**
 * The in-app assistant's browser procedures (`packages/assistant`), with the
 * user's session cookie: conversations, sending, approvals, stop and the live
 * stream (an SSE event iterator, so nothing on this path may buffer the
 * response). The turn itself runs in `apps/worker`.
 */
const handleAssistantRequest = createAssistantRequestHandler();
app.all('/model/rpc/*', async (context) => {
  const response = await handleAssistantRequest(context.req.raw);
  if (!response) return context.notFound();
  return context.newResponse(response.body, response);
});

export const mcpCatalog = buildMcpCatalog(appRouter);

/**
 * The context the MCP gate verified, scoped to the async chain serving that
 * request. The SDK serves a copy of the request on some paths, so the context
 * cannot be keyed by the Request object itself.
 */
const mcpRequestContext = new AsyncLocalStorage<Context>();

export const mcpHandler = createCampusPilotMcpHandler<Context>({
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

const authenticateMcpRequest = createMcpGate<Context>({
  catalog: mcpCatalog,
  resource: env.MCP_RESOURCE_URL,
  verifyAccessToken: (token) => verifyMcpAccessToken(auth, token),
  findLiveGrant: (claims) => findLiveOAuthGrant(db, claims),
  // Only the key authenticates: cookies and other credentials are dropped.
  createApiKeyContext: (apiKey) =>
    createContextFromHeaders(new Headers({ 'x-api-key': apiKey })),
  createOAuthContext,
  assistant: { verifyToken: verifyAssistantToken, createContext: createAssistantContext },
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
 * The cadet MCP: a second catalog built from `cadetRouter` and a second gate
 * bound to CADET_MCP_RESOURCE_URL and the cadet issuer. OAuth only (no API
 * keys for students), read-only scope; grants are checked in the cadet
 * consent table, so a staff token can never pass this gate and a cadet token
 * can never pass the staff one (different issuer and audience).
 */
export const cadetMcpCatalog = buildMcpCatalog(cadetRouter);

/** The cadet MCP's own verified context, separate from the staff store. */
const cadetMcpRequestContext = new AsyncLocalStorage<CadetContext>();

export const cadetMcpHandler = createCampusPilotMcpHandler<CadetContext>({
  catalog: cadetMcpCatalog,
  serverName: 'campuspilot-cadet',
  currentContext: () => cadetMcpRequestContext.getStore(),
  reportError: (error, toolName) => {
    log.error({ err: error, toolName }, 'cadet.mcp.error');
  },
  reportToolCall: (event) => {
    log.info(event, 'cadet.mcp.tool.call');
  },
});

const authenticateCadetMcpRequest = createMcpGate<CadetContext>({
  catalog: cadetMcpCatalog,
  resource: env.CADET_MCP_RESOURCE_URL,
  challengeScopes: CADET_MCP_DEFAULT_SCOPES,
  verifyAccessToken: (token) =>
    verifyMcpAccessToken(cadetAuth, token, {
      issuer: cadetOauthIssuer(),
      audience: env.CADET_MCP_RESOURCE_URL,
    }),
  findLiveGrant: (claims) =>
    findLiveOAuthGrant(db, claims, CADET_OAUTH_GRANT_TABLES),
  createOAuthContext: createCadetOAuthContext,
  recordGrantUse: (grantId) =>
    recordOAuthGrantUse(db, grantId, new Date(), CADET_OAUTH_GRANT_TABLES),
});

app.all('/cadet/mcp', async (context) => {
  const request = context.req.raw;
  const result = await authenticateCadetMcpRequest(request);
  if (!result.ok) return result.response;
  return cadetMcpRequestContext.run(result.credential.context, () =>
    cadetMcpHandler.fetch(
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
// The cadet resource's metadata and the cadet issuer's discovery documents
// come first: the staff wildcard below would otherwise answer for them.
app.get('/.well-known/oauth-protected-resource/cadet/mcp', (context) =>
  cadetAuth.handler(context.req.raw),
);
app.get('/.well-known/oauth-authorization-server/api/cadet/auth', async (context) =>
  context.json(await cadetAuth.api.getOAuthServerConfig()),
);
app.get('/.well-known/openid-configuration/api/cadet/auth', async (context) =>
  context.json(await cadetAuth.api.getOpenIdConfig()),
);
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
