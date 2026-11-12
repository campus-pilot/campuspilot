import type { McpModule, McpProcedureMeta } from '../mcp-metadata';

/**
 * Modules whose procedures the in-app assistant may call. This is an
 * allowlist so a newly added module stays unavailable until someone decides
 * otherwise. Money work (`billing`, and `dashboard` with its collections and
 * dues) is in scope: the assistant acts as the signed-in user, OPA decides
 * every call for that user's role, and every write waits for the user's
 * approval, exactly as for any other module. Every exclusion is an explicit
 * product decision, not a guess:
 * - `platform`, `system`: platform administration, not school work.
 * - `account`: the user's own credentials (API keys, connected apps, profile).
 * - `assistant`: the assistant's own procedures.
 * - `notices`, `notifications`: added after the assistant and not yet
 *   reviewed for it, so they keep the allowlist's default (unavailable)
 *   until someone decides to add them.
 */
export const ASSISTANT_TOOL_MODULES = [
  'admissions',
  'billing',
  'classes',
  'dashboard',
  'documents',
  'exams',
  'members',
  'schools',
  'sessions',
  'students',
] as const satisfies readonly McpModule[];

export type AssistantToolModule = (typeof ASSISTANT_TOOL_MODULES)[number];

export type AssistantToolDecision =
  | { allowed: false; reason: string }
  | { allowed: true; requiresApproval: boolean };

function isAssistantModule(module: McpModule): module is AssistantToolModule {
  return (ASSISTANT_TOOL_MODULES as readonly McpModule[]).includes(module);
}

/**
 * Approval policy: every write waits for the user's explicit confirmation,
 * whether or not it is destructive; reads run immediately. Kept as one
 * function so a later, finer policy (for example, auto-approving additive
 * writes) changes exactly here.
 */
export function assistantToolRequiresApproval(meta: McpProcedureMeta): boolean {
  return meta.access === 'write';
}

/**
 * Decides whether the assistant may call a procedure, from its explicit MCP
 * metadata only. Hidden procedures "must stay a human action" by definition,
 * so they are never available. OPA still authorizes every allowed call as the
 * user; this policy can only narrow what the user could do.
 */
export function assistantToolDecision(
  meta: McpProcedureMeta | undefined,
): AssistantToolDecision {
  if (!meta) {
    return { allowed: false, reason: 'The procedure declares no tool metadata.' };
  }
  if (meta.exposure === 'hidden') {
    return { allowed: false, reason: 'This action must be done by a person.' };
  }
  if (!isAssistantModule(meta.module)) {
    return {
      allowed: false,
      reason: `The assistant cannot use ${meta.module} tools.`,
    };
  }
  return { allowed: true, requiresApproval: assistantToolRequiresApproval(meta) };
}
