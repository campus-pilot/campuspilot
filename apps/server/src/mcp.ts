import type { CadetContext } from '@campuspilot/api/cadet/context';
import type { Context } from '@campuspilot/api/context';
import {
  MCP_ACCESS_LEVELS,
  MCP_EXPOSURES,
  MCP_MODULES,
  type McpProcedureMeta,
} from '@campuspilot/api/mcp-metadata';
import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
  type McpHttpHandler,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import {
  type AnyProcedure,
  type AnyRouter,
  call,
  isProcedure,
  ORPCError,
  resolveContractProcedures,
} from '@orpc/server';
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
} from '@campuspilot/auth/mcp-oauth-policy';
import { APIError } from 'better-auth';
import { z } from 'zod';

import { registerAdvancedToolMetaTools } from './mcp-meta-tools';

const EMPTY_INPUT_SCHEMA = z.object({});

/** JSON Schema dialect the MCP SDK uses for tool input schemas. */
const MCP_JSON_SCHEMA_TARGET = 'draft-2020-12';

export type JsonSchemaObject = Record<string, unknown>;

/**
 * Standard Schema handed to the MCP SDK: it advertises the input JSON Schema
 * converted once at boot and validates with the procedure's Zod schema.
 */
type McpToolInputSchema = StandardSchemaWithJSON<unknown, unknown>;

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  /** Input JSON Schema converted once while the catalog is built. */
  inputJsonSchema: JsonSchemaObject;
  acceptsInput: boolean;
  /** Explicit exposure/access/destructive/module facts from `.meta({ mcp })`. */
  mcp: McpProcedureMeta & { exposure: 'core' | 'advanced' };
  procedure: AnyProcedure;
};

/** The tools one credential may see. */
export type McpCatalogView = {
  /** Listed directly in tools/list. */
  core: readonly McpToolDefinition[];
  /** Reached through the advanced-tool meta tools. */
  advanced: readonly McpToolDefinition[];
  advancedByName: ReadonlyMap<string, McpToolDefinition>;
};

/**
 * The tools a CampusPilot MCP server exposes, resolved once per process.
 * Hidden procedures are validated but never enter the catalog. `readOnly` is
 * the precomputed view for credentials without write access (B6): listing
 * filters in memory only, while calls are still enforced by the gate (403),
 * the scope middleware and OPA.
 */
export type McpCatalog = McpCatalogView & {
  readOnly: McpCatalogView;
};

/**
 * The oRPC context an MCP request runs with: the staff `Context` on `/mcp`,
 * the `CadetContext` on `/cadet/mcp`. Each endpoint has its own catalog
 * built from its own router, so a tool only ever receives the context type
 * its router was built for.
 */
export type McpContext = Context | CadetContext;

/** Returns the context the MCP gate verified for the current request. */
type CreateMcpContext = () => Promise<McpContext>;

type ReportMcpError = (error: unknown, toolName?: string) => void;

/** One executed tool call, for usage analytics of the core/advanced split. */
export type McpToolCallEvent = {
  toolName: string;
  exposure: 'core' | 'advanced';
  /** The meta tool that ran an advanced tool, if any. */
  via?: string;
};

export type McpToolCallOptions = {
  createContext: CreateMcpContext;
  reportError: ReportMcpError;
  reportToolCall?: (event: McpToolCallEvent) => void;
};

type CreateCampusPilotMcpHandlerOptions<TContext extends McpContext> = {
  catalog: Promise<McpCatalog>;
  /**
   * Context the MCP gate verified for the request being served. Returning
   * undefined means the request bypassed the gate; the handler then fails
   * closed instead of serving it anonymously.
   */
  currentContext: () => TContext | undefined;
  reportError: ReportMcpError;
  reportToolCall?: (event: McpToolCallEvent) => void;
  /** MCP server name reported to clients; defaults to `campuspilot`. */
  serverName?: string;
};

type CreateCampusPilotMcpServerOptions = McpToolCallOptions & {
  catalog: McpCatalog;
  serverName?: string;
  /**
   * Whether the credential may use write tools; read-only credentials are
   * not shown them. Defaults to true (sessions and API keys).
   */
  writeAccess?: boolean;
};

type McpErrorPayload = {
  code: string;
  message: string;
  /** Validation problems, so a model can correct its arguments. */
  issues?: Array<{ path: string; message: string }>;
};

/** Returns the child schemas a Zod schema accepts as input, keyed by path segment. */
function inputChildren(schema: z.ZodType): Array<[string, z.ZodType]> {
  const def = schema._zod.def as unknown as Record<string, unknown> & {
    type: string;
  };
  switch (def.type) {
    case 'object':
      return Object.entries((schema as z.ZodObject).shape);
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      return [['', def.innerType as z.ZodType]];
    case 'pipe':
      return [['', def.in as z.ZodType]];
    case 'array':
      return [['[]', def.element as z.ZodType]];
    case 'record':
      return [['{}', def.valueType as z.ZodType]];
    case 'union':
      return (def.options as z.ZodType[]).map((option, index) => [
        `|${index}`,
        option,
      ]);
    case 'intersection':
      return [
        ['&left', def.left as z.ZodType],
        ['&right', def.right as z.ZodType],
      ];
    default:
      return [];
  }
}

function convertsToJsonSchema(schema: z.ZodType): boolean {
  try {
    z.toJSONSchema(schema, { io: 'input', target: MCP_JSON_SCHEMA_TARGET });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the deepest input field whose schema cannot be represented in JSON
 * Schema, so a boot failure names the field instead of only the procedure.
 */
function findUnrepresentableField(
  schema: z.ZodType,
  path: string,
): string {
  for (const [segment, child] of inputChildren(schema)) {
    if (convertsToJsonSchema(child)) continue;
    const childPath = !segment
      ? path
      : segment.startsWith('[') ||
          segment.startsWith('{') ||
          segment.startsWith('|') ||
          segment.startsWith('&')
        ? `${path}${segment}`
        : path
          ? `${path}.${segment}`
          : segment;
    return findUnrepresentableField(child, childPath);
  }
  return path || '(root)';
}

/**
 * Converts a procedure input to the JSON Schema advertised by tools/list.
 * Conversion runs once while the catalog is built, so an unrepresentable
 * field fails boot (and the catalog tests) naming the procedure and field,
 * instead of failing every tools/list request at runtime.
 *
 * Three size reductions apply to every tool, because the catalog is paid for
 * in model tokens on each conversation: the root `$schema` is dropped (MCP
 * defaults to draft 2020-12); a `pattern` is dropped where `format`
 * (`date-time`, `date`, `email`) already states the same rule; and Zod's
 * implicit safe-integer bounds (±2^53−1 on every `.int()`) are dropped since
 * they are not API limits. Explicit bounds are kept, and the procedure's Zod
 * schema still validates every call.
 */
export function convertMcpInputSchema(
  name: string,
  schema: z.ZodObject,
): JsonSchemaObject {
  try {
    const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema, {
      io: 'input',
      target: MCP_JSON_SCHEMA_TARGET,
      override: ({ jsonSchema: node }) => {
        if (typeof node.format === 'string' && 'pattern' in node) {
          delete node.pattern;
        }
        if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
        if (node.minimum === Number.MIN_SAFE_INTEGER) delete node.minimum;
      },
    });
    return jsonSchema as JsonSchemaObject;
  } catch (error) {
    const field = findUnrepresentableField(schema, '');
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(
      `oRPC procedure ${name} has an input field that cannot be represented in JSON Schema for MCP at ${field}: ${reason}`,
      { cause: error },
    );
  }
}

/**
 * Wraps a tool's Zod input for the MCP SDK. The SDK reads the precomputed JSON
 * Schema instead of converting on every tools/list, and still rejects invalid
 * arguments with Zod's messages. A successful validation returns the raw
 * arguments rather than Zod's parsed output: the oRPC procedure parses them
 * itself, and its transforms (for example ISO strings into Dates) must see the
 * JSON values a client sent, not already-transformed values.
 */
function toMcpToolInputSchema(
  tool: Pick<McpToolDefinition, 'inputSchema' | 'inputJsonSchema'>,
): McpToolInputSchema {
  const zodStandard = tool.inputSchema['~standard'];
  return {
    '~standard': {
      version: 1,
      vendor: 'campuspilot',
      jsonSchema: {
        input: () => tool.inputJsonSchema,
        output: () => tool.inputJsonSchema,
      },
      validate: async (value) => {
        const result = await zodStandard.validate(value);
        return result.issues ? { issues: result.issues } : { value };
      },
    },
  };
}

/** Rejects missing or malformed `.meta({ mcp })` with the procedure name. */
function readMcpMetadata(name: string, meta: unknown): McpProcedureMeta {
  const mcp = (meta as { mcp?: Partial<McpProcedureMeta> } | undefined)?.mcp;
  if (!mcp) {
    throw new TypeError(
      `oRPC procedure ${name} must declare .meta({ mcp: { exposure, access, destructive, module } }).`,
    );
  }
  if (
    !MCP_EXPOSURES.includes(mcp.exposure as never) ||
    !MCP_ACCESS_LEVELS.includes(mcp.access as never) ||
    typeof mcp.destructive !== 'boolean' ||
    !MCP_MODULES.includes(mcp.module as never)
  ) {
    throw new TypeError(
      `oRPC procedure ${name} declares invalid MCP metadata: ${JSON.stringify(mcp)}.`,
    );
  }
  if (mcp.access === 'read' && mcp.destructive) {
    throw new TypeError(
      `oRPC procedure ${name} cannot be both read-only and destructive.`,
    );
  }
  return mcp as McpProcedureMeta;
}

/**
 * Resolves the router once into immutable MCP registration data. oRPC's
 * resolver follows lazy routers, so every appRouter leaf is visited; each
 * must declare its MCP metadata, and hidden leaves are left out.
 */
export async function buildMcpCatalog(router: AnyRouter): Promise<McpCatalog> {
  const tools: McpToolDefinition[] = [];
  const names = new Set<string>();

  await resolveContractProcedures(
    { router, path: [] },
    ({ contract, path }) => {
      if (!isProcedure(contract)) {
        throw new TypeError(
          `MCP can only expose implemented oRPC procedures at ${path.join('.')}.`,
        );
      }

      const name = path.join('.');
      const definition = contract['~orpc'];
      const { description, summary } = definition.route;

      if (!name) throw new TypeError('MCP tool paths cannot be empty.');
      if (names.has(name)) throw new TypeError(`Duplicate MCP tool name: ${name}.`);
      names.add(name);
      const mcp = readMcpMetadata(name, definition.meta);
      if (mcp.exposure === 'hidden') return;

      if (!summary?.trim() || !description?.trim()) {
        throw new TypeError(
          `oRPC procedure ${name} must define a non-empty route summary and description for MCP.`,
        );
      }
      if (
        definition.inputSchema !== undefined &&
        !(definition.inputSchema instanceof z.ZodObject)
      ) {
        throw new TypeError(
          `oRPC procedure ${name} must use a top-level Zod object input schema for MCP.`,
        );
      }

      const inputSchema = definition.inputSchema ?? EMPTY_INPUT_SCHEMA;
      tools.push({
        name,
        title: summary,
        description,
        inputSchema,
        inputJsonSchema: convertMcpInputSchema(name, inputSchema),
        acceptsInput: definition.inputSchema !== undefined,
        mcp: { ...mcp, exposure: mcp.exposure },
        procedure: contract,
      });
    },
  );

  const view = (included: (tool: McpToolDefinition) => boolean): McpCatalogView => {
    const advanced = Object.freeze(
      tools.filter((tool) => tool.mcp.exposure === 'advanced' && included(tool)),
    );
    return Object.freeze({
      core: Object.freeze(
        tools.filter((tool) => tool.mcp.exposure === 'core' && included(tool)),
      ),
      advanced,
      advancedByName: new Map(advanced.map((tool) => [tool.name, tool])),
    });
  };
  return Object.freeze({
    ...view(() => true),
    readOnly: view((tool) => tool.mcp.access === 'read'),
  });
}

/**
 * Whether a request's credential may use write tools. OAuth grants need the
 * `mcp:write` scope; sessions and API keys carry the user's full rights
 * (scoped keys may come later).
 */
export function credentialWriteAccess(context: McpContext): boolean {
  return context.principal.authMethod === 'oauth'
    ? context.principal.oauthGrant.scopes.includes(MCP_WRITE_SCOPE)
    : true;
}

/** OAuth scopes a tool call needs: read for everything, write for writes. */
export function requiredScopes(access: 'read' | 'write'): string[] {
  return access === 'write'
    ? [MCP_READ_SCOPE, MCP_WRITE_SCOPE]
    : [MCP_READ_SCOPE];
}

/**
 * Per-tool auth requirements in the form ChatGPT's Apps SDK reads from
 * `_meta.securitySchemes`, derived from the tool's explicit access.
 */
export function securitySchemesMeta(access: 'read' | 'write') {
  return {
    securitySchemes: [{ type: 'oauth2', scopes: requiredScopes(access) }],
  };
}

/** MCP tool annotations derived from the procedure's explicit metadata. */
export function toolAnnotations(tool: McpToolDefinition): ToolAnnotations {
  return {
    readOnlyHint: tool.mcp.access === 'read',
    destructiveHint: tool.mcp.destructive,
    openWorldHint: false,
  };
}

export function serializeJson(value: unknown): string {
  return (
    JSON.stringify(value ?? null, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ) ?? 'null'
  );
}

function validationIssues(error: ORPCError<string, unknown>) {
  const issues = (error.data as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.map((issue: { path?: unknown[]; message?: string }) => ({
    path: (issue.path ?? [])
      .map((segment) =>
        typeof segment === 'object' && segment !== null && 'key' in segment
          ? String((segment as { key: unknown }).key)
          : String(segment),
      )
      .join('.'),
    message: issue.message ?? 'Invalid value',
  }));
}

function expectedMcpError(error: unknown): McpErrorPayload | null {
  if (error instanceof ORPCError) {
    if (error.status >= 500) return null;
    const issues = validationIssues(error);
    return issues
      ? { code: error.code, message: error.message, issues }
      : { code: error.code, message: error.message };
  }

  if (error instanceof APIError) {
    if (error.statusCode >= 500) return null;
    return { code: String(error.status), message: error.message };
  }

  return null;
}

/** A tool error result with a JSON payload the model can act on. */
export function toolErrorResult(payload: McpErrorPayload): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: serializeJson(payload) }],
  };
}

/**
 * Runs one procedure as an MCP tool call with the gate-verified context, so
 * protected procedures keep their oRPC authentication, scope and OPA
 * middleware; direct core tools and advanced tools run through the meta
 * tools share it.
 */
export async function callMcpTool(
  tool: McpToolDefinition,
  input: unknown,
  signal: AbortSignal,
  options: McpToolCallOptions,
  via?: string,
): Promise<CallToolResult> {
  options.reportToolCall?.({
    toolName: tool.name,
    exposure: tool.mcp.exposure,
    ...(via ? { via } : {}),
  });
  try {
    const context = await options.createContext();
    const result = await call(
      tool.procedure,
      tool.acceptsInput ? input : undefined,
      { context, signal },
    );

    return {
      content: [{ type: 'text', text: serializeJson(result) }],
    };
  } catch (error) {
    options.reportError(error, tool.name);
    return toolErrorResult(
      expectedMcpError(error) ?? {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred.',
      },
    );
  }
}

/**
 * Creates one stateless MCP server instance for a protocol request: the core
 * tools directly, plus the advanced-tool meta tools when advanced tools exist.
 */
export function createCampusPilotMcpServer({
  catalog,
  writeAccess = true,
  serverName = 'campuspilot',
  ...options
}: CreateCampusPilotMcpServerOptions): McpServer {
  const server = new McpServer({ name: serverName, version: '0.1.0' });
  const view = writeAccess ? catalog : catalog.readOnly;

  for (const tool of view.core) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: toMcpToolInputSchema(tool),
        annotations: toolAnnotations(tool),
        _meta: securitySchemesMeta(tool.mcp.access),
      },
      async (input, requestContext) =>
        callMcpTool(tool, input, requestContext.mcpReq.signal, options),
    );
  }
  if (view.advanced.length > 0) {
    registerAdvancedToolMetaTools(server, view, options);
  }

  return server;
}

/**
 * Builds the HTTP bridge around one cached router catalog. The SDK creates a
 * fresh server per request and serves both modern MCP and stateless legacy MCP
 * clients from this single tool definition source.
 */
export function createCampusPilotMcpHandler<TContext extends McpContext>({
  catalog,
  currentContext,
  reportError,
  reportToolCall,
  serverName,
}: CreateCampusPilotMcpHandlerOptions<TContext>): McpHttpHandler {
  return createMcpHandler(
    async ({ requestInfo }) => {
      if (!requestInfo) {
        throw new TypeError('CampusPilot MCP is available only over HTTP.');
      }
      const context = currentContext();
      if (!context) {
        throw new TypeError('MCP request reached the handler without the auth gate.');
      }

      return createCampusPilotMcpServer({
        catalog: await catalog,
        writeAccess: credentialWriteAccess(context),
        serverName,
        createContext: async () => context,
        reportError,
        reportToolCall,
      });
    },
    {
      onerror: (error) => reportError(error),
    },
  );
}
