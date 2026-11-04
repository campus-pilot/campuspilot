import type { Context } from '@campuspilot/api/context';
import { normalizeApiKeyRequest } from '@campuspilot/auth/api-key-headers';
import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
  type McpHttpHandler,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import {
  type AnyProcedure,
  type AnyRouter,
  call,
  isProcedure,
  ORPCError,
  resolveContractProcedures,
} from '@orpc/server';
import { APIError } from 'better-auth';
import { z } from 'zod';

const EMPTY_INPUT_SCHEMA = z.object({});

/** JSON Schema dialect the MCP SDK uses for tool input schemas. */
const MCP_JSON_SCHEMA_TARGET = 'draft-2020-12';

type JsonSchemaObject = Record<string, unknown>;

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
  procedure: AnyProcedure;
};

type CreateMcpContext = (headers: Headers) => Promise<Context>;

type ReportMcpError = (error: unknown, toolName?: string) => void;

type CreateCampusPilotMcpHandlerOptions = {
  tools: Promise<readonly McpToolDefinition[]>;
  createContext: CreateMcpContext;
  reportError: ReportMcpError;
};

type CreateCampusPilotMcpServerOptions = {
  tools: readonly McpToolDefinition[];
  headers: Headers;
  createContext: CreateMcpContext;
  reportError: ReportMcpError;
};

type McpErrorPayload = {
  code: string;
  message: string;
};

/**
 * Adapts the standard MCP bearer credential to Better Auth's API-key header
 * without mutating the request supplied by Hono or changing other transports.
 * An explicit x-api-key wins so existing non-browser clients remain supported.
 */
export function normalizeMcpAuthRequest(request: Request): Request {
  return normalizeApiKeyRequest(request);
}

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
 */
export function convertMcpInputSchema(
  name: string,
  schema: z.ZodObject,
): JsonSchemaObject {
  try {
    return z.toJSONSchema(schema, {
      io: 'input',
      target: MCP_JSON_SCHEMA_TARGET,
    }) as JsonSchemaObject;
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

/**
 * Resolves the router once into immutable MCP registration data. oRPC's
 * resolver follows lazy routers, so future procedures become tools merely by
 * being added to appRouter; no MCP registration list can drift out of sync.
 */
export async function buildMcpToolDefinitions(
  router: AnyRouter,
): Promise<readonly McpToolDefinition[]> {
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
      names.add(name);
      tools.push({
        name,
        title: summary,
        description,
        inputSchema,
        inputJsonSchema: convertMcpInputSchema(name, inputSchema),
        acceptsInput: definition.inputSchema !== undefined,
        procedure: contract,
      });
    },
  );

  return Object.freeze(tools);
}

function serializeJson(value: unknown): string {
  return (
    JSON.stringify(value ?? null, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ) ?? 'null'
  );
}

function expectedMcpError(error: unknown): McpErrorPayload | null {
  if (error instanceof ORPCError) {
    if (error.status >= 500) return null;
    return { code: error.code, message: error.message };
  }

  if (error instanceof APIError) {
    if (error.statusCode >= 500) return null;
    return { code: String(error.status), message: error.message };
  }

  return null;
}

/**
 * Creates one stateless MCP server instance for a protocol request. Context is
 * resolved inside each tool callback so discovery stays public and protected
 * procedures retain their existing oRPC authentication and OPA middleware.
 */
export function createCampusPilotMcpServer({
  tools,
  headers,
  createContext,
  reportError,
}: CreateCampusPilotMcpServerOptions): McpServer {
  const server = new McpServer({ name: 'campuspilot', version: '0.1.0' });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: toMcpToolInputSchema(tool),
      },
      async (input, requestContext): Promise<CallToolResult> => {
        try {
          const context = await createContext(headers);
          const result = await call(
            tool.procedure,
            tool.acceptsInput ? input : undefined,
            { context, signal: requestContext.mcpReq.signal },
          );

          return {
            content: [{ type: 'text', text: serializeJson(result) }],
          };
        } catch (error) {
          reportError(error, tool.name);
          const expected = expectedMcpError(error);
          if (expected) {
            return {
              isError: true,
              content: [{ type: 'text', text: serializeJson(expected) }],
            };
          }

          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: serializeJson({
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'An unexpected server error occurred.',
                }),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}

/**
 * Builds the HTTP bridge around one cached router catalog. The SDK creates a
 * fresh server per request and serves both modern MCP and stateless legacy MCP
 * clients from this single tool definition source.
 */
export function createCampusPilotMcpHandler({
  tools,
  createContext,
  reportError,
}: CreateCampusPilotMcpHandlerOptions): McpHttpHandler {
  return createMcpHandler(
    async ({ requestInfo }) => {
      if (!requestInfo) {
        throw new TypeError('CampusPilot MCP is available only over HTTP.');
      }

      const request = normalizeMcpAuthRequest(requestInfo);
      return createCampusPilotMcpServer({
        tools: await tools,
        headers: request.headers,
        createContext,
        reportError,
      });
    },
    {
      onerror: (error) => reportError(error),
    },
  );
}
