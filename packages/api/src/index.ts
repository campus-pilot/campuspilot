import { os } from "@orpc/server";

import type { Context } from "./context";
import { rpcError } from "./errors";
import type { ProcedureMeta } from "./mcp-metadata";
import { assistantToolDecision } from "./assistant/tool-policy";
import { assertSchoolWritableByCaller } from "./school-access/school-access.service";
import { assertSchoolKindServedByCaller, servedSchoolKinds } from "./school-access/school-kind.service";
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
 * what the assistant may do: the tool policy from metadata (only allowlisted
 * school modules, billing included; no hidden, platform or account
 * procedures) and the conversation's school. Rules that depend on a call's
 * input, such as the school check below, live here, next to the input; the
 * tool policy itself decides from metadata only. The service cannot widen any
 * of this; it can only add its own rules, such as asking for approval.
 */
function assertAssistantToolPolicy(
  context: Context,
  meta: ProcedureMeta,
  input: unknown,
) {
  if (context.principal.authMethod !== "assistant") return;
  const decision = assistantToolDecision(meta.mcp);
  if (!decision.allowed) throw rpcError.forbidden(decision.reason);
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

/**
 * A suspended school, and a school without an active plan, is read-only
 * (docs/school-suspension.md, docs/school-billing.md): every procedure that
 * is not an explicit read (`mcp.access`; a procedure without metadata is
 * treated as a write, as for OAuth scopes) is refused for the school its
 * input names. Here, on every protected procedure, rather than on each one:
 * a new procedure is covered without remembering to add anything, whichever
 * way it is reached (the apps, an API key, a connected AI app, the in-app
 * assistant).
 *
 * The school is the input's `schoolId`, the name every school-scoped
 * procedure uses (`school-suspension.integration.test.ts` checks that every
 * write of the school router has it). The input is read before its own
 * validation, so only a string is taken from it, trimmed as the inputs trim
 * it (`z.string().trim()`): otherwise " sch_x" would name no school here and
 * the school the procedure then acts on.
 *
 * Platform administration (`systemAdmin.*`) is not held: it acts on a school
 * from outside it, even when the administrator is also a member (the
 * principal of a demo school they created).
 */
async function assertSchoolWritableForWrite(
  context: Context,
  meta: ProcedureMeta,
  path: readonly string[],
  input: unknown,
) {
  if (meta.mcp?.access === "read") return;
  if (path[0] === "systemAdmin") return;
  const schoolId =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).schoolId
      : undefined;
  if (typeof schoolId !== "string") return;
  await assertSchoolWritableByCaller(context, schoolId.trim());
}

/**
 * The school kind gate (docs/personal-space.md): a procedure serves the kinds
 * of school its `schoolKinds` names (real schools only when it names none),
 * and a call whose input's `schoolId` names a school of another kind is
 * refused, reads included (`school-kind.service.ts`). Here, beside the
 * read-only gate and for the same reason: a new procedure is covered without
 * anyone remembering, whichever way it is reached. The school is read from the
 * input exactly as the read-only gate reads it. Platform administration is not
 * held.
 */
async function assertSchoolKindServed(
  context: Context,
  meta: ProcedureMeta,
  path: readonly string[],
  input: unknown,
) {
  if (path[0] === "systemAdmin") return;
  const schoolId =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).schoolId
      : undefined;
  if (typeof schoolId !== "string") return;
  await assertSchoolKindServedByCaller(context, schoolId.trim(), servedSchoolKinds(meta.schoolKinds));
}

const requireAuth = o.middleware(async ({ context, next, procedure, path }, input) => {
  if (!context.session?.user) {
    throw rpcError.unauthorized();
  }
  assertOAuthScope(context, procedure["~orpc"].meta);
  assertAssistantToolPolicy(context, procedure["~orpc"].meta, input);
  await assertSchoolKindServed(context, procedure["~orpc"].meta, path, input);
  await assertSchoolWritableForWrite(context, procedure["~orpc"].meta, path, input);
  return next({
    context: {
      db: context.db,
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
