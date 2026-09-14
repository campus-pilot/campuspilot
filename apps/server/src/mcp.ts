import type { Context } from '@campuspilot/api/context';
import { normalizeApiKeyRequest } from '@campuspilot/auth/api-key-headers';
import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
  type McpHttpHandler,
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

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
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

      names.add(name);
      tools.push({
        name,
        title: summary,
        description,
        inputSchema: definition.inputSchema ?? EMPTY_INPUT_SCHEMA,
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
        inputSchema: tool.inputSchema,
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
