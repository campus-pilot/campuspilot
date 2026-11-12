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
};

/** Metadata carried by every CampusPilot procedure. */
export type ProcedureMeta = {
  /** Required on every appRouter leaf; the MCP catalog fails to build without it. */
  mcp?: McpProcedureMeta;
};
