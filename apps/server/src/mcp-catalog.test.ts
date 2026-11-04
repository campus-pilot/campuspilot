import type { Context } from '@campuspilot/api/context';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { OpenAPIGenerator } from '@orpc/openapi';
import type { AnyRouter } from '@orpc/server';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildMcpToolDefinitions,
  createCampusPilotMcpHandler,
  type McpToolDefinition,
} from './mcp';

vi.mock('@campuspilot/auth/server', () => ({
  createAuth: vi.fn(),
}));

type JsonSchema = Record<string, unknown>;

let appRouter: AnyRouter;
let tools: readonly McpToolDefinition[];

beforeAll(async () => {
  vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
  ({ appRouter } = await import('@campuspilot/api/routers/index'));
  tools = await buildMcpToolDefinitions(appRouter);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * Runs the real catalog through the Streamable HTTP transport a remote client
 * uses, so a single unconvertible schema fails here instead of in production.
 */
describe('real appRouter over Streamable HTTP', () => {
  it('lists every tool with an object input schema', async () => {
    const handler = createCampusPilotMcpHandler({
      tools: Promise.resolve(tools),
      createContext: async () => ({}) as Context,
      reportError: vi.fn(),
    });
    const client = new Client({ name: 'catalog-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
        fetch: async (input, init) => handler.fetch(new Request(input, init)),
      }),
    );

    try {
      const listed = await client.listTools();

      expect(listed.tools.map(({ name }) => name).sort()).toEqual(
        tools.map(({ name }) => name).sort(),
      );
      for (const tool of listed.tools) {
        expect(tool.title, tool.name).toBeTruthy();
        expect(tool.inputSchema.type, tool.name).toBe('object');
      }
    } finally {
      await client.close();
      await handler.close();
    }
  });
});

function requiredProperties(schema: JsonSchema | undefined): string[] {
  return [...((schema?.required as string[] | undefined) ?? [])].sort();
}

/**
 * OpenAPI uses oRPC's converter and MCP uses Zod's; both must advertise an
 * object input with the same required properties for every procedure.
 */
describe('OpenAPI contract', () => {
  it('generates a document whose inputs match the MCP input shapes', async () => {
    const generator = new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    });
    const document = await generator.generate(appRouter, {
      info: { title: 'CampusPilot API', version: '0.0.0' },
    });

    for (const tool of tools) {
      const path = `/${tool.name.split('.').join('/')}`;
      const operation = document.paths?.[path]?.post;
      expect(operation, `${tool.name} is missing from OpenAPI`).toBeDefined();

      const body = operation?.requestBody as
        | { content?: Record<string, { schema?: JsonSchema }> }
        | undefined;
      const openApiInput = body?.content?.['application/json']?.schema;
      if (!tool.acceptsInput) {
        expect(openApiInput, tool.name).toBeUndefined();
        continue;
      }
      expect(openApiInput?.type, tool.name).toBe('object');
      expect(requiredProperties(openApiInput), tool.name).toEqual(
        requiredProperties(tool.inputJsonSchema),
      );
    }
  });
});

const PATTERN_CANDIDATES = [
  '1',
  'INR',
  'a',
  '0',
  '10',
  '2026-04-01',
  '2026-04-01T09:30:00.000Z',
  '09:30',
  'user@example.com',
  '0'.repeat(64),
];

function sampleString(schema: JsonSchema): string {
  if (schema.format === 'date-time') return '2026-04-01T09:30:00.000Z';
  if (schema.format === 'date') return '2026-04-01';
  if (schema.format === 'email') return 'user@example.com';
  const minLength = (schema.minLength as number | undefined) ?? 1;
  const maxLength = (schema.maxLength as number | undefined) ?? Infinity;
  const fits = (value: string) =>
    value.length >= minLength && value.length <= maxLength;
  if (typeof schema.pattern === 'string') {
    const pattern = new RegExp(schema.pattern);
    const match = PATTERN_CANDIDATES.find(
      (value) => pattern.test(value) && fits(value),
    );
    if (!match) throw new Error(`No sample for pattern ${schema.pattern}`);
    return match;
  }
  return 'x'.repeat(Math.max(minLength, 1));
}

/**
 * Samples a number at its lower bound plus the property's position, so sibling
 * numbers such as a start and end year are distinct and ascending.
 */
function sampleNumber(schema: JsonSchema, ordinal: number): number {
  const minimum = schema.minimum as number | undefined;
  const exclusiveMinimum = schema.exclusiveMinimum as number | undefined;
  const maximum = (schema.maximum as number | undefined) ?? Infinity;
  const lowest =
    minimum ?? (exclusiveMinimum !== undefined ? exclusiveMinimum + 1 : 1);
  return Math.min(lowest + ordinal, maximum);
}

/**
 * Builds the smallest instance a client could produce from the advertised
 * JSON Schema: required properties only (plus the top-level optional ones when
 * `withOptional` is set), preferring declared examples, defaults, constants
 * and the first enum value or union member.
 */
function sampleFromJsonSchema(
  schema: JsonSchema,
  { withOptional = false, ordinal = 0 } = {},
): unknown {
  const examples = schema.examples as unknown[] | undefined;
  if (examples?.length) return examples[0];
  if ('const' in schema) return schema.const;
  if ('default' in schema) return schema.default;
  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues?.length) return enumValues[0];
  const union = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined;
  if (union?.length) {
    const member =
      union.find((option) => option.type !== 'null') ?? union[0]!;
    return sampleFromJsonSchema(member);
  }

  switch (schema.type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<
        string,
        JsonSchema
      >;
      // `{ not: {} }` is a field the contract forbids (z.never()).
      const keys = withOptional
        ? Object.keys(properties).filter((key) => !properties[key]?.not)
        : requiredProperties(schema);
      return Object.fromEntries(
        keys.map((key, index) => [
          key,
          sampleFromJsonSchema(properties[key] ?? {}, { ordinal: index }),
        ]),
      );
    }
    case 'array': {
      const count = (schema.minItems as number | undefined) ?? 0;
      return Array.from({ length: count }, (_, index) => {
        const item = sampleFromJsonSchema((schema.items ?? {}) as JsonSchema);
        // Distinct items keep uniqueness refinements satisfied.
        return typeof item === 'string' && count > 1 ? `${item}${index}` : item;
      });
    }
    case 'string':
      return sampleString(schema);
    case 'integer':
    case 'number':
      return sampleNumber(schema, ordinal);
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      throw new Error(`No sample for schema ${JSON.stringify(schema)}`);
  }
}

/**
 * A contract the JSON side can express but Zod rejects would make a tool
 * uncallable. Each advertised schema's minimal instance must parse. Inputs
 * with cross-field rules JSON Schema cannot state (for example "provide at
 * least one field to update") are retried with their optional fields filled.
 */
describe('schema-sample round trip', () => {
  it('parses a minimal JSON-Schema instance with every procedure input', async () => {
    const failures: string[] = [];
    for (const tool of tools) {
      const parse = (withOptional: boolean) =>
        tool.inputSchema.safeParseAsync(
          JSON.parse(
            JSON.stringify(
              sampleFromJsonSchema(tool.inputJsonSchema, { withOptional }),
            ),
          ),
        );
      let result = await parse(false);
      if (!result.success) result = await parse(true);
      if (!result.success) {
        failures.push(
          `${tool.name}: ${result.error.issues
            .map((issue) => `${issue.path.join('.')} ${issue.message}`)
            .join('; ')}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});
