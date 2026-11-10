import type { McpModule, McpProcedureMeta } from '../mcp-metadata';
import {
  documentTypeSchema,
  isFinanceDocumentType,
} from '../routers/school/document/document.dto';

/**
 * Modules whose procedures the in-app assistant may call. This is an
 * allowlist so a newly added module stays unavailable until someone decides
 * otherwise. Every exclusion is an explicit product decision, not a guess:
 * - `billing`: money tasks are out of scope for the assistant for now.
 * - `dashboard`: the school dashboard reports collections and dues, which is
 *   money data; excluded with billing until money tasks are in scope.
 * - `platform`, `system`: platform administration, not school work.
 * - `account`: the user's own credentials (API keys, connected apps, profile).
 * - `assistant`: the assistant's own procedures.
 */
export const ASSISTANT_TOOL_MODULES = [
  'admissions',
  'classes',
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

/**
 * Where document tools name a document type in their input. Listed per input
 * shape instead of searched for, so a new field is a deliberate addition.
 */
function documentTypesInInput(input: unknown): unknown[] {
  if (typeof input !== 'object' || input === null) return [];
  const record = input as Record<string, unknown>;
  const nested = (key: string) => {
    const value = record[key];
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>).documentType
      : undefined;
  };
  return [record.documentType, nested('source'), nested('filters')].filter(
    (value) => value !== undefined,
  );
}

/**
 * The document domain a document tool is asked for (`filters.documentDomain`
 * on listings), or undefined when the input names none. Listed per input
 * shape, like the document types above.
 */
function documentDomainInInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return undefined;
  const filters = (input as Record<string, unknown>).filters;
  return typeof filters === 'object' && filters !== null
    ? (filters as Record<string, unknown>).documentDomain
    : undefined;
}

const FINANCE_DOCUMENTS_REFUSAL = 'The assistant cannot work with bills, receipts or statements.';

/**
 * Input-level rules that metadata cannot express. The documents module
 * serves academic and finance documents alike; finance types (bills,
 * receipts, statements) are money tasks and stay out of scope, like billing.
 * Finance documents can be asked for by type or by domain, so both are
 * checked. The domain is an allowlist: only `academic` (or no domain, which
 * the API treats as academic) passes, so `finance`, `all` and any domain
 * added later are refused until someone decides otherwise.
 */
export function assistantToolInputDecision(
  meta: McpProcedureMeta,
  input: unknown,
): AssistantToolDecision {
  if (meta.module === 'documents') {
    const domain = documentDomainInInput(input);
    if (domain !== undefined && domain !== 'academic') {
      return { allowed: false, reason: FINANCE_DOCUMENTS_REFUSAL };
    }
    for (const value of documentTypesInInput(input)) {
      const parsed = documentTypeSchema.safeParse(value);
      if (parsed.success && isFinanceDocumentType(parsed.data)) {
        return { allowed: false, reason: FINANCE_DOCUMENTS_REFUSAL };
      }
    }
  }
  return { allowed: true, requiresApproval: assistantToolRequiresApproval(meta) };
}
