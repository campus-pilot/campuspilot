import type { Context } from '@campuspilot/api/context';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { OpenAPIGenerator } from '@orpc/openapi';
import { type AnyRouter, resolveContractProcedures } from '@orpc/server';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildMcpCatalog,
  createCampusPilotMcpHandler,
  type McpCatalog,
  type McpToolDefinition,
} from './mcp';
import { MAX_DESCRIBED_TOOLS, META_TOOL_NAMES } from './mcp-meta-tools';

vi.mock('@campuspilot/auth/server', () => ({
  createAuth: vi.fn(),
}));

type JsonSchema = Record<string, unknown>;

/** The approved everyday set (plan Appendix B); changes are deliberate. */
const CORE_TOOLS = [
  'school.createAdmission',
  'school.createManualBill',
  'school.generateDocument',
  'school.getAdmission',
  'school.getAdmissionBill',
  'school.getAdmissionFinanceSummary',
  'school.getAdmissionLedger',
  'school.getClass',
  'school.getCollectionRegister',
  'school.getDashboard',
  'school.getDocumentDownload',
  'school.getExam',
  'school.getExamOverview',
  'school.getExamResult',
  'school.getMember',
  'school.getPayment',
  'school.getSchool',
  'school.getSession',
  'school.getStudent',
  'school.listAdmissionBills',
  'school.listAdmissions',
  'school.listClasses',
  'school.listDocumentArtifacts',
  'school.listExamResults',
  'school.listExams',
  'school.listMembers',
  'school.listMySchools',
  'school.listPayments',
  'school.listSections',
  'school.listSessions',
  'school.listStudents',
  'school.recordAdjustment',
  'school.recordPayment',
  'school.recordPaymentWithDiscount',
  'school.updateAdmission',
  'school.upsertExamResult',
];

const HIDDEN_TOOLS = [
  'auth.setPassword',
  'auth.getOAuthConsentClient',
  'authorization.checkPermissions',
  'healthCheck',
  'school.getLogo',
];

/**
 * Upper bound for what the model reads from tools/list (core + meta tools):
 * each tool's name, title, description and input schema as serialized JSON,
 * the same measure the plan's budget uses. Annotations and `_meta` (for
 * example ChatGPT's securitySchemes) are client metadata and not counted. It
 * is paid in model tokens on every conversation, so growing it must be a
 * deliberate decision.
 */
const CORE_LISTING_BUDGET_CHARS = 38_000;

let appRouter: AnyRouter;
let catalog: McpCatalog;
let leafNames: string[];

beforeAll(async () => {
  vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
  ({ appRouter } = await import('@campuspilot/api/routers/index'));
  catalog = await buildMcpCatalog(appRouter);
  leafNames = [];
  await resolveContractProcedures({ router: appRouter, path: [] }, ({ path }) => {
    leafNames.push(path.join('.'));
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const exposedTools = () => [...catalog.core, ...catalog.advanced];

type Connection = { client: Client; close: () => Promise<void> };
const connections: Connection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(({ close }) => close()));
});

/**
 * Connects to the real catalog over the Streamable HTTP transport, as an
 * anonymous caller or as an OAuth grant with the given scopes.
 */
async function connect(oauthScopes?: string[]): Promise<Client> {
  const context = (
    oauthScopes
      ? {
          session: null,
          principal: {
            authMethod: 'oauth',
            oauthGrant: { clientId: 'test', scopes: oauthScopes, grantId: 'g' },
          },
        }
      : { session: null, principal: { authMethod: 'anonymous' } }
  ) as Context;
  const handler = createCampusPilotMcpHandler({
    catalog: Promise.resolve(catalog),
    currentContext: () => context,
    reportError: vi.fn(),
  });
  const client = new Client({ name: 'catalog-test', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    }),
  );
  connections.push({
    client,
    close: async () => {
      await client.close();
      await handler.close();
    },
  });
  return client;
}

function textJson(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

describe('catalog metadata', () => {
  it('classifies every appRouter leaf exactly once', () => {
    const classified = [
      ...catalog.core.map(({ name }) => name),
      ...catalog.advanced.map(({ name }) => name),
      ...HIDDEN_TOOLS,
    ].sort();

    expect(classified).toEqual([...leafNames].sort());
    expect(catalog.core.map(({ name }) => name).sort()).toEqual(CORE_TOOLS);
    expect(catalog.core).toHaveLength(36);
    expect(catalog.advanced).toHaveLength(83);
  });
});

/**
 * Runs the real catalog through the Streamable HTTP transport a remote client
 * uses, so a single unconvertible schema fails here instead of in production.
 */
describe('real appRouter over Streamable HTTP', () => {
  it('lists exactly the core tools and the four meta tools, with annotations', async () => {
    const client = await connect();
    const listed = await client.listTools();
    const byName = new Map(catalog.core.map((tool) => [tool.name, tool]));

    expect(listed.tools.map(({ name }) => name).sort()).toEqual(
      [...CORE_TOOLS, ...Object.values(META_TOOL_NAMES)].sort(),
    );
    for (const tool of listed.tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe('object');
      const definition = byName.get(tool.name);
      if (!definition) continue;
      expect(tool.annotations, tool.name).toEqual({
        readOnlyHint: definition.mcp.access === 'read',
        destructiveHint: definition.mcp.destructive,
        openWorldHint: false,
      });
    }
    expect(
      listed.tools.find(({ name }) => name === META_TOOL_NAMES.runWrite)
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const name of [
      META_TOOL_NAMES.list,
      META_TOOL_NAMES.describe,
      META_TOOL_NAMES.runRead,
    ]) {
      expect(
        listed.tools.find((tool) => tool.name === name)?.annotations,
        name,
      ).toMatchObject({ readOnlyHint: true });
    }
  });

  it('shows read-only credentials no write tools, and gives every tool its OAuth security scheme', async () => {
    const readOnly = await (await connect(['mcp:read'])).listTools();
    const readWrite = await (await connect(['mcp:read', 'mcp:write'])).listTools();
    const readOnlyAdvanced = textJson(
      await (await connect(['mcp:read'])).callTool({
        name: META_TOOL_NAMES.list,
        arguments: {},
      }),
    ) as Array<{ access: string }>;
    const coreReads = catalog.core.filter(({ mcp }) => mcp.access === 'read');

    expect(readOnly.tools.map(({ name }) => name).sort()).toEqual(
      [
        ...coreReads.map(({ name }) => name),
        META_TOOL_NAMES.list,
        META_TOOL_NAMES.describe,
        META_TOOL_NAMES.runRead,
      ].sort(),
    );
    expect(readOnly.tools.every(({ annotations }) => annotations?.readOnlyHint)).toBe(true);
    expect(readOnlyAdvanced.every(({ access }) => access === 'read')).toBe(true);
    expect(readWrite.tools).toHaveLength(CORE_TOOLS.length + 4);
    for (const tool of readWrite.tools) {
      const write = tool.annotations?.readOnlyHint === false;
      expect(tool._meta, tool.name).toEqual({
        securitySchemes: [
          {
            type: 'oauth2',
            scopes: write ? ['mcp:read', 'mcp:write'] : ['mcp:read'],
          },
        ],
      });
    }
  });

  it('keeps the listing within the token budget', async () => {
    const client = await connect();
    const listed = await client.listTools();

    const modelVisible = listed.tools.map(
      ({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema,
      }),
    );

    expect(JSON.stringify(modelVisible).length).toBeLessThanOrEqual(
      CORE_LISTING_BUDGET_CHARS,
    );
  });

  it('indexes exactly the advanced tools and filters by module and access', async () => {
    const client = await connect();

    const all = textJson(
      await client.callTool({ name: META_TOOL_NAMES.list, arguments: {} }),
    ) as Array<{ name: string; access: string; module: string }>;
    const billingWrites = textJson(
      await client.callTool({
        name: META_TOOL_NAMES.list,
        arguments: { module: 'billing', access: 'write' },
      }),
    ) as Array<{ name: string; access: string; module: string }>;

    expect(all.map(({ name }) => name).sort()).toEqual(
      catalog.advanced.map(({ name }) => name).sort(),
    );
    expect(Object.keys(all[0]!).sort()).toEqual([
      'access',
      'module',
      'name',
      'title',
    ]);
    expect(billingWrites.length).toBeGreaterThan(0);
    expect(
      billingWrites.every(
        ({ access, module }) => access === 'write' && module === 'billing',
      ),
    ).toBe(true);
  });

  it('describes every advanced tool', async () => {
    const client = await connect();
    const names = catalog.advanced.map(({ name }) => name);

    for (let index = 0; index < names.length; index += MAX_DESCRIBED_TOOLS) {
      const batch = names.slice(index, index + MAX_DESCRIBED_TOOLS);
      const result = await client.callTool({
        name: META_TOOL_NAMES.describe,
        arguments: { names: batch },
      });
      expect(result.isError, batch.join(', ')).toBeFalsy();
      const described = textJson(result) as Array<{
        name: string;
        inputSchema: JsonSchema;
      }>;
      expect(described.map(({ name }) => name)).toEqual(batch);
      for (const tool of described) {
        expect(tool.inputSchema.type, tool.name).toBe('object');
      }
    }
  });

  it('refuses hidden, core, unknown and wrong-access names in the runners', async () => {
    const client = await connect();
    const advancedRead = catalog.advanced.find(
      ({ mcp }) => mcp.access === 'read',
    )!;
    const advancedWrite = catalog.advanced.find(
      ({ mcp }) => mcp.access === 'write',
    )!;
    const cases: Array<[string, string, string]> = [
      [META_TOOL_NAMES.runRead, 'healthCheck', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runWrite, 'auth.setPassword', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runRead, 'school.listStudents', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runWrite, 'school.recordPayment', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runRead, 'school.noSuchTool', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runRead, advancedWrite.name, 'WRONG_ACCESS_CLASS'],
      [META_TOOL_NAMES.runWrite, advancedRead.name, 'WRONG_ACCESS_CLASS'],
    ];

    for (const [runner, name, code] of cases) {
      const result = await client.callTool({
        name: runner,
        arguments: { name, arguments: {} },
      });
      expect(result.isError, `${runner} ${name}`).toBe(true);
      expect(textJson(result), `${runner} ${name}`).toMatchObject({ code });
    }
    const unknownDescribe = await client.callTool({
      name: META_TOOL_NAMES.describe,
      arguments: { names: ['healthCheck'] },
    });
    expect(textJson(unknownDescribe)).toMatchObject({
      code: 'UNKNOWN_ADVANCED_TOOL',
    });
  });

  it('runs an advanced tool through its runner with the normal procedure checks', async () => {
    const client = await connect();
    const advancedRead = catalog.advanced.find(
      ({ mcp }) => mcp.access === 'read',
    )!;

    const result = await client.callTool({
      name: META_TOOL_NAMES.runRead,
      arguments: { name: advancedRead.name, arguments: {} },
    });

    // The anonymous context reaches the procedure, whose own validation or
    // authentication middleware answers (never an internal error).
    expect(result.isError).toBe(true);
    expect(['BAD_REQUEST', 'UNAUTHORIZED']).toContain(textJson(result).code);
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
  it('documents every procedure, with inputs matching the MCP input shapes', async () => {
    const generator = new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    });
    const document = await generator.generate(appRouter, {
      info: { title: 'CampusPilot API', version: '0.0.0' },
    });
    const operationFor = (name: string) =>
      document.paths?.[`/${name.split('.').join('/')}`]?.post;

    for (const name of leafNames) {
      expect(operationFor(name), `${name} is missing from OpenAPI`).toBeDefined();
    }
    for (const tool of exposedTools()) {
      const body = operationFor(tool.name)?.requestBody as
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

async function parsesSample(tool: McpToolDefinition, withOptional: boolean) {
  return tool.inputSchema.safeParseAsync(
    JSON.parse(
      JSON.stringify(sampleFromJsonSchema(tool.inputJsonSchema, { withOptional })),
    ),
  );
}

/**
 * A contract the JSON side can express but Zod rejects would make a tool
 * uncallable. Each advertised schema's minimal instance must parse. Inputs
 * with cross-field rules JSON Schema cannot state (for example "provide at
 * least one field to update") are retried with their optional fields filled.
 */
describe('schema-sample round trip', () => {
  it('parses a minimal JSON-Schema instance with every MCP tool input', async () => {
    const failures: string[] = [];
    for (const tool of exposedTools()) {
      let result = await parsesSample(tool, false);
      if (!result.success) result = await parsesSample(tool, true);
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
