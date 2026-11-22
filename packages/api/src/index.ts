import { os } from "@orpc/server";

import type { Context } from "./context";
import { rpcError } from "./errors";
import type { ProcedureMeta } from "./mcp-metadata";
import { assistantToolDecision } from "./assistant/tool-policy";
import { assertSchoolGatesByCaller, servedSchoolKinds } from "./school-access/school-kind.service";
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
 * The two school gates of every protected procedure, for the school its
 * input names, decided from one read (`assertSchoolGatesByCaller`):
 *
 * - The school kind gate (docs/personal-space.md): a procedure serves the
 *   kinds of school its `schoolKinds` names (real schools only when it names
 *   none), and a school of another kind is refused, reads included.
 * - The read-only gate (docs/school-suspension.md, docs/school-billing.md): a
 *   suspended school, and a school without an active plan, refuses every
 *   procedure that is not an explicit read (`mcp.access`; a procedure without
 *   metadata is treated as a write, as for OAuth scopes), for its members.
 *
 * Here, on every protected procedure, rather than on each one: a new
 * procedure is covered without remembering to add anything, whichever way it
 * is reached (the apps, an API key, a connected AI app, the in-app
 * assistant).
 *
 * The school is the input's `schoolId`, the name every school-scoped
 * procedure uses (`school-suspension.integration.test.ts` checks that every
 * write of the school router has it). The input is read before its own
 * validation, so only a string is taken from it, trimmed as the inputs trim
 * it (`z.string().trim()`): otherwise " sch_x" would name no school here and
 * the school the procedure then acts on.
 *
 * Platform administration (`meta.platformAdministration`, every
 * `systemAdmin.*` procedure) is held by neither: it acts on a school from
 * outside it, even when the administrator is also a member (the principal of
 * a demo school they created). Decided from the procedure's own metadata,
 * never from its path, which a call through MCP may not carry.
 */
async function assertSchoolGates(
  context: Context,
  meta: ProcedureMeta,
  input: unknown,
) {
  if (meta.platformAdministration) return;
  const schoolId =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).schoolId
      : undefined;
  if (typeof schoolId !== "string") return;
  await assertSchoolGatesByCaller(context, schoolId.trim(), {
    served: servedSchoolKinds(meta.schoolKinds),
    write: meta.mcp?.access !== "read",
  });
}

const requireAuth = o.middleware(async ({ context, next, procedure }, input) => {
  if (!context.session?.user) {
    throw rpcError.unauthorized();
  }
  assertOAuthScope(context, procedure["~orpc"].meta);
  assertAssistantToolPolicy(context, procedure["~orpc"].meta, input);
  await assertSchoolGates(context, procedure["~orpc"].meta, input);
  return next({
    context: {
      db: context.db,
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * The builder of platform administration (`systemAdmin.*`): a protected
 * procedure whose metadata says `platformAdministration`, so the school gates
 * of `requireAuth` do not hold it and every kind of school is served
 * (`school-kind.integration.test.ts` checks every `systemAdmin` procedure is
 * built with it and no other is).
 */
export const platformAdminProcedure = protectedProcedure.meta({ platformAdministration: true });
