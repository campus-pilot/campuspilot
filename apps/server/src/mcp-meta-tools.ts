import {
  MCP_ACCESS_LEVELS,
  MCP_MODULES,
  type McpAccess,
} from '@campuspilot/api/mcp-metadata';
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
  callMcpTool,
  convertMcpInputSchema,
  type McpCatalogView,
  securitySchemesMeta,
  type McpToolCallOptions,
  type McpToolDefinition,
  serializeJson,
  toolErrorResult,
} from './mcp';

/** Most advanced tools one describeAdvancedTools call returns. */
export const MAX_DESCRIBED_TOOLS = 5;

export const META_TOOL_NAMES = {
  list: 'listAdvancedTools',
  describe: 'describeAdvancedTools',
  runRead: 'runAdvancedReadTool',
  runWrite: 'runAdvancedWriteTool',
} as const;

const listInput = z.object({
  module: z
    .enum(MCP_MODULES)
    .optional()
    .describe('Only tools of this area, e.g. billing or exams.'),
  access: z
    .enum(MCP_ACCESS_LEVELS)
    .optional()
    .describe('read: never changes data; write: creates or changes data.'),
});

const describeInput = z.object({
  names: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_DESCRIBED_TOOLS)
    .describe('Tool names from listAdvancedTools.'),
});

const runInput = z.object({
  name: z.string().min(1).describe('Tool name from listAdvancedTools.'),
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Arguments matching the inputSchema from describeAdvancedTools.'),
});

/** Converts once and validates with Zod, like the procedure tools. */
function metaInputSchema(
  name: string,
  schema: z.ZodObject,
): StandardSchemaWithJSON<unknown, unknown> {
  const jsonSchema = convertMcpInputSchema(name, schema);
  return {
    '~standard': {
      version: 1,
      vendor: 'campuspilot',
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
      validate: async (value) => {
        const result = await schema['~standard'].validate(value);
        return result.issues ? { issues: result.issues } : { value: result.value };
      },
    },
  };
}

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: serializeJson(value) }] };
}

/**
 * Resolves the advanced tool a runner may execute. Unknown, hidden and core
 * names, and tools of the other access class, are refused so a client's
 * "always allow" on the read runner can never trigger a write.
 */
function resolveRunnableTool(
  catalog: McpCatalogView,
  name: string,
  access: McpAccess,
): { tool: McpToolDefinition } | { error: CallToolResult } {
  const tool = catalog.advancedByName.get(name);
  if (!tool) {
    const isCore = catalog.core.some((core) => core.name === name);
    return {
      error: toolErrorResult({
        code: 'UNKNOWN_ADVANCED_TOOL',
        message: isCore
          ? `${name} is a core tool; call it directly instead of through a runner.`
          : `${name} is not an advanced CampusPilot tool. Call ${META_TOOL_NAMES.list} for the available names.`,
      }),
    };
  }
  if (tool.mcp.access !== access) {
    const runner =
      tool.mcp.access === 'write'
        ? META_TOOL_NAMES.runWrite
        : META_TOOL_NAMES.runRead;
    return {
      error: toolErrorResult({
        code: 'WRONG_ACCESS_CLASS',
        message: `${name} is a ${tool.mcp.access} tool; run it with ${runner}. ${META_TOOL_NAMES.list} shows each tool's access.`,
      }),
    };
  }
  return { tool };
}

function registerRunner(
  server: McpServer,
  catalog: McpCatalogView,
  options: McpToolCallOptions,
  access: McpAccess,
) {
  const name =
    access === 'read' ? META_TOOL_NAMES.runRead : META_TOOL_NAMES.runWrite;
  server.registerTool(
    name,
    {
      title:
        access === 'read' ? 'Run an advanced read tool' : 'Run an advanced write tool',
      description:
        access === 'read'
          ? 'Run an advanced tool that only reads data. Get names from listAdvancedTools and argument schemas from describeAdvancedTools.'
          : 'Run an advanced tool that creates, changes or deletes data. Get names from listAdvancedTools and argument schemas from describeAdvancedTools.',
      inputSchema: metaInputSchema(name, runInput),
      annotations:
        access === 'read'
          ? READ_ONLY
          : { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: securitySchemesMeta(access),
    },
    async (input, requestContext) => {
      const { name: toolName, arguments: args } = input as z.infer<
        typeof runInput
      >;
      const resolved = resolveRunnableTool(catalog, toolName, access);
      if ('error' in resolved) return resolved.error;
      return callMcpTool(
        resolved.tool,
        args ?? {},
        requestContext.mcpReq.signal,
        options,
        name,
      );
    },
  );
}

/**
 * Registers the MCP-only tools that make advanced procedures reachable
 * without listing their schemas upfront: a compact index, on-demand schemas,
 * and separate runners for read and write tools. They call the same oRPC
 * procedures with the same context, so validation and OPA are unchanged.
 */
export function registerAdvancedToolMetaTools(
  server: McpServer,
  catalog: McpCatalogView,
  options: McpToolCallOptions,
) {
  server.registerTool(
    META_TOOL_NAMES.list,
    {
      title: 'List advanced tools',
      description:
        'List CampusPilot tools beyond the directly available ones (setup, configuration, lifecycle, deletion, billing runs, reports). Returns names only; use describeAdvancedTools for arguments.',
      inputSchema: metaInputSchema(META_TOOL_NAMES.list, listInput),
      annotations: READ_ONLY,
      _meta: securitySchemesMeta('read'),
    },
    async (input) => {
      const { module, access } = input as z.infer<typeof listInput>;
      return jsonResult(
        catalog.advanced
          .filter(
            (tool) =>
              (!module || tool.mcp.module === module) &&
              (!access || tool.mcp.access === access),
          )
          .map((tool) => ({
            name: tool.name,
            title: tool.title,
            access: tool.mcp.access,
            module: tool.mcp.module,
          })),
      );
    },
  );

  server.registerTool(
    META_TOOL_NAMES.describe,
    {
      title: 'Describe advanced tools',
      description: `Get the description and input JSON Schema of up to ${MAX_DESCRIBED_TOOLS} advanced tools before running them.`,
      inputSchema: metaInputSchema(META_TOOL_NAMES.describe, describeInput),
      annotations: READ_ONLY,
      _meta: securitySchemesMeta('read'),
    },
    async (input) => {
      const { names } = input as z.infer<typeof describeInput>;
      const unknown = names.filter((name) => !catalog.advancedByName.has(name));
      if (unknown.length > 0) {
        return toolErrorResult({
          code: 'UNKNOWN_ADVANCED_TOOL',
          message: `Not advanced CampusPilot tools: ${unknown.join(', ')}. Call ${META_TOOL_NAMES.list} for the available names.`,
        });
      }
      return jsonResult(
        names.map((name) => {
          const tool = catalog.advancedByName.get(name)!;
          return {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            access: tool.mcp.access,
            destructive: tool.mcp.destructive,
            module: tool.mcp.module,
            inputSchema: { type: 'object', ...tool.inputJsonSchema },
          };
        }),
      );
    },
  );

  registerRunner(server, catalog, options, 'read');
  // A read-only view has no advanced write tools, so it gets no write runner.
  if (catalog.advanced.some((tool) => tool.mcp.access === 'write')) {
    registerRunner(server, catalog, options, 'write');
  }
}
