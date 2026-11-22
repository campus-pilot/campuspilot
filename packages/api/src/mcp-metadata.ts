import type { SchoolKind } from '@campuspilot/db/school-kind';

/**
 * Explicit MCP facts every procedure declares through `.meta({ mcp })`.
 * Each fact is its own field: nothing is inferred from a procedure's name,
 * HTTP method, tags or the other fields.
 */

/**
 * How an MCP client reaches a tool. This never decides who may use it; OPA
 * authorizes core and advanced tools alike.
 * - `core`: listed directly in `tools/list` (everyday work).
 * - `advanced`: reached through the discovery and run meta tools.
 * - `hidden`: not exposed over MCP; still available over RPC and OpenAPI.
 */
export const MCP_EXPOSURES = ['core', 'advanced', 'hidden'] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];

/** `read` only when the procedure never changes persisted state. */
export const MCP_ACCESS_LEVELS = ['read', 'write'] as const;
export type McpAccess = (typeof MCP_ACCESS_LEVELS)[number];

/** Functional area used to filter the advanced tool index. */
export const MCP_MODULES = [
  'account',
  'admissions',
  'billing',
  'classes',
  'dashboard',
  'documents',
  'exams',
  'members',
  'notices',
  'notifications',
  'platform',
  'schools',
  'sessions',
  'students',
  'system',
] as const;
export type McpModule = (typeof MCP_MODULES)[number];

export type McpProcedureMeta = {
  exposure: McpExposure;
  access: McpAccess;
  /**
   * MCP `destructiveHint`: true when the tool may overwrite or remove existing
   * data; false for reads and purely additive writes.
   */
  destructive: boolean;
  module: McpModule;
  /**
   * How many characters of this tool's result the in-app assistant gives the
   * model, when the default (24,000) would cut off a result that is the point
   * of the call, such as a whole question paper. The stored and displayed
   * result stays truncated either way. An explicit fact, never inferred from
   * the tool's name or output type.
   */
  outputChars?: number;
  /**
   * The in-app assistant runs this write without asking the user to approve
   * it first. Only for a write that adds and never overwrites or removes
   * (`destructive: false`), whose result the user can see and undo themselves,
   * such as a new question paper version (the previous one stays and can be
   * saved again). An explicit fact, never inferred; every other write keeps
   * the approval.
   */
  skipsApproval?: true;
};

/** Metadata carried by every CampusPilot procedure. */
export type ProcedureMeta = {
  /** Required on every appRouter leaf; the MCP catalog fails to build without it. */
  mcp?: McpProcedureMeta;
  /**
   * The kinds of school this procedure serves (docs/personal-space.md). An
   * explicit fact, never inferred from the procedure's name or module.
   * Without it the procedure serves real schools only (`DEFAULT_SCHOOL_KINDS`),
   * so a new procedure is refused for a personal space until someone decides
   * it belongs there. `requireAuth` enforces it for the input's `schoolId`,
   * reads included; the MCP listing and the in-app assistant offer a tool only
   * for the kinds it serves.
   */
  schoolKinds?: readonly SchoolKind[];
};
