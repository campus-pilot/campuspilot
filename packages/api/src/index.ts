import { os } from "@orpc/server";

import type { Context } from "./context";
import { rpcError } from "./errors";
import type { ProcedureMeta } from "./mcp-metadata";
import {
  assistantToolDecision,
  assistantToolInputDecision,
} from "./assistant/tool-policy";
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
} from "@campuspilot/auth/mcp-oauth-policy";

export const o = os.$context<Context>().$meta<ProcedureMeta>({});

export const publicProcedure = o;

/**
 * OAuth connectors may only use what their grant allows: a procedure's
 * explicit `mcp.access` decides whether it needs `mcp:read` or `mcp:write`
 * (a procedure without metadata is treated as a write). Session and API-key
 * callers carry the user's full rights and skip this check. The MCP endpoint
 * already answers missing scopes with HTTP 403; this keeps the rule enforced
 * for every path into a procedure.
 */
function assertOAuthScope(
  context: Context,
  meta: ProcedureMeta,
) {
  if (context.principal.authMethod !== "oauth") return;
  const required =
    meta.mcp?.access === "read" ? MCP_READ_SCOPE : MCP_WRITE_SCOPE;
  if (!context.principal.oauthGrant.scopes.includes(required)) {
    throw rpcError.forbidden(
      `This connection is missing the ${required} scope. Reconnect CampusPilot and allow ${required === MCP_WRITE_SCOPE ? "changes" : "read access"} to use this tool.`,
    );
  }
}

/**
 * The assistant service is an ordinary MCP client, so the API itself enforces
 * what the assistant may do: the tool policy (no billing, no hidden or
 * platform procedures), input rules metadata cannot express (no finance
 * documents) and the conversation's school. The service cannot widen any of
 * this; it can only add its own rules, such as asking for approval.
 */
function assertAssistantToolPolicy(
  context: Context,
  meta: ProcedureMeta,
  input: unknown,
) {
  if (context.principal.authMethod !== "assistant") return;
  const decision = assistantToolDecision(meta.mcp);
  if (!decision.allowed) throw rpcError.forbidden(decision.reason);
  const inputDecision = assistantToolInputDecision(meta.mcp!, input);
  if (!inputDecision.allowed) throw rpcError.forbidden(inputDecision.reason);
  const schoolId =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).schoolId
      : undefined;
  if (
    schoolId !== undefined &&
    schoolId !== context.principal.assistantRun.schoolId
  ) {
    throw rpcError.forbidden(
      "This assistant conversation can only act in its own school.",
    );
  }
}

const requireAuth = o.middleware(async ({ context, next, procedure }, input) => {
  if (!context.session?.user) {
    throw rpcError.unauthorized();
  }
  assertOAuthScope(context, procedure["~orpc"].meta);
  assertAssistantToolPolicy(context, procedure["~orpc"].meta, input);
  return next({
    context: {
      db: context.db,
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
