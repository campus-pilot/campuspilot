import type { Context } from '@campuspilot/api/context';
import { protectedProcedure } from '@campuspilot/api';
import type {
  McpProcedureMeta,
  ProcedureMeta,
} from '@campuspilot/api/mcp-metadata';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { call, lazy, ORPCError, os as baseOs } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  buildMcpCatalog,
  createCampusPilotMcpHandler,
  createCampusPilotMcpServer,
  type McpCatalog,
} from './mcp';

vi.mock('@campuspilot/auth/server', () => ({
  createAuth: vi.fn(),
}));

/** Synthetic procedures carry the same metadata type as CampusPilot's. */
const os = baseOs.$meta<ProcedureMeta>({});

function mcpMeta(overrides: Partial<McpProcedureMeta> = {}): ProcedureMeta {
  return {
    mcp: {
      exposure: 'core',
      access: 'read',
      destructive: false,
      module: 'system',
      ...overrides,
    },
  };
}

type ConnectedMcp = {
  client: Client;
  close: () => Promise<void>;
};

const openConnections: ConnectedMcp[] = [];

function asContext(value: unknown): Context {
  return value as Context;
}

async function connectMcp(
  catalog: McpCatalog,
  context: Context,
  reportError = vi.fn(),
): Promise<ConnectedMcp> {
  const server = createCampusPilotMcpServer({
    catalog,
    createContext: async () => context,
    reportError,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'campuspilot-test', version: '0.1.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const connection = {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
  openConnections.push(connection);
  return connection;
}

function textContent(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content[0];
  if (content?.type !== 'text') throw new TypeError('Expected text content.');
  return content.text;
}

afterEach(async () => {
  await Promise.all(openConnections.splice(0).map(({ close }) => close()));
  vi.restoreAllMocks();
});

describe('buildMcpCatalog', () => {
  it('discovers nested and lazy procedures exactly once', async () => {
    const ping = os
      .meta(mcpMeta())
      .route({
        summary: 'Ping',
        description: 'Return a public ping response.',
        tags: ['Test'],
      })
      .handler(() => 'pong');
    const echo = os
      .meta(mcpMeta())
      .route({
        summary: 'Echo',
        description: 'Return the supplied message.',
        tags: ['Test'],
      })
      .input(z.object({ message: z.string() }))
      .handler(({ input }) => input);
    const router = {
      ping,
      nested: lazy(async () => ({ default: { echo } })),
    };

    const { core } = await buildMcpCatalog(router);

    expect(core.map(({ name }) => name)).toEqual(['ping', 'nested.echo']);
    expect(new Set(core.map(({ name }) => name)).size).toBe(core.length);
    expect(
      core.every(
        ({ description, inputSchema, title }) =>
          title.length > 0 &&
          description.length > 0 &&
          inputSchema instanceof z.ZodObject,
      ),
    ).toBe(true);
  });

  it('rejects procedures that cannot become self-describing MCP tools', async () => {
    const missingMetadata = os.handler(() => 'no metadata');
    const scalarInput = os
      .meta(mcpMeta())
      .route({
        summary: 'Scalar',
        description: 'Uses an unsupported scalar input.',
        tags: ['Test'],
      })
      .input(z.string())
      .handler(({ input }) => input);

    const missingSummary = os.meta(mcpMeta()).handler(() => 'no summary');

    await expect(buildMcpCatalog({ missingMetadata })).rejects.toThrow(
      'missingMetadata must declare .meta({ mcp',
    );
    await expect(buildMcpCatalog({ missingSummary })).rejects.toThrow(
      'summary and description',
    );
    await expect(buildMcpCatalog({ scalarInput })).rejects.toThrow(
      'top-level Zod object',
    );
  });

  it('fails while building the catalog, naming the procedure and field that has no JSON Schema', async () => {
    const listPayments = os
      .meta(mcpMeta())
      .route({
        summary: 'List payments',
        description: 'Uses a Date input that JSON clients cannot send.',
        tags: ['Test'],
      })
      .input(
        z.object({
          schoolId: z.string(),
          filters: z.object({ receivedFrom: z.date().optional() }).optional(),
        }),
      )
      .handler(() => []);

    await expect(
      buildMcpCatalog({ school: { listPayments } }),
    ).rejects.toThrow(
      /school\.listPayments .* at filters\.receivedFrom: Date cannot be represented/,
    );
  });

  it('splits core from advanced tools and leaves hidden procedures out', async () => {
    const handler = () => 'ok';
    const catalog = await buildMcpCatalog({
      listThings: os.meta(mcpMeta()).route({ summary: 'List', description: 'List things.' }).handler(handler),
      deleteThing: os
        .meta(mcpMeta({ exposure: 'advanced', access: 'write', destructive: true }))
        .route({ summary: 'Delete', description: 'Delete a thing.' })
        .handler(handler),
      probe: os.meta(mcpMeta({ exposure: 'hidden' })).handler(handler),
    });

    expect(catalog.core.map(({ name }) => name)).toEqual(['listThings']);
    expect(catalog.advanced.map(({ name }) => name)).toEqual(['deleteThing']);
    expect([...catalog.advancedByName.keys()]).toEqual(['deleteThing']);
  });

  it('rejects contradictory or unknown metadata', async () => {
    const readButDestructive = os
      .meta(mcpMeta({ destructive: true }))
      .route({ summary: 'Read', description: 'Reads.' })
      .handler(() => 'ok');
    const unknownModule = os
      .meta({ mcp: { ...mcpMeta().mcp!, module: 'weather' as never } })
      .route({ summary: 'Read', description: 'Reads.' })
      .handler(() => 'ok');

    await expect(buildMcpCatalog({ readButDestructive })).rejects.toThrow(
      'cannot be both read-only and destructive',
    );
    await expect(buildMcpCatalog({ unknownModule })).rejects.toThrow(
      'invalid MCP metadata',
    );
  });
});

describe('MCP tool execution', () => {
  it('initializes, lists, and calls tools through stateless Streamable HTTP', async () => {
    const procedure = os
      .meta(mcpMeta())
      .route({
        summary: 'HTTP echo',
        description: 'Echo a value through the HTTP MCP transport.',
        tags: ['Test'],
      })
      .input(z.object({ value: z.string() }))
      .handler(({ input }) => input);
    const catalog = buildMcpCatalog({ httpEcho: procedure });
    const servedRequests: boolean[] = [];
    const handler = createCampusPilotMcpHandler({
      catalog,
      currentContext: () => {
        servedRequests.push(true);
        return asContext({});
      },
      reportError: vi.fn(),
    });
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost/api/mcp'),
      {
        fetch: async (input, init) =>
          handler.fetch(new Request(input, init)),
      },
    );
    const client = new Client({ name: 'http-test', version: '0.1.0' });
    openConnections.push({
      client,
      close: async () => {
        await client.close();
        await handler.close();
      },
    });

    await client.connect(transport);
    const listed = await client.listTools();
    const result = await client.callTool({
      name: 'httpEcho',
      arguments: { value: 'works' },
    });

    expect(listed.tools.map(({ name }) => name)).toEqual(['httpEcho']);
    expect(JSON.parse(textContent(result))).toEqual({ value: 'works' });
    expect(servedRequests.length).toBeGreaterThan(0);
  });

  it('fails closed when a request reaches the handler without the auth gate', async () => {
    const reportError = vi.fn();
    const handler = createCampusPilotMcpHandler({
      catalog: buildMcpCatalog({}),
      currentContext: () => undefined,
      reportError,
    });
    const client = new Client({ name: 'ungated', version: '0.1.0' });
    openConnections.push({
      client,
      close: async () => {
        await client.close();
        await handler.close();
      },
    });

    await expect(
      client.connect(
        new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
          fetch: async (input, init) => handler.fetch(new Request(input, init)),
        }),
      ),
    ).rejects.toThrow();
    expect(reportError).toHaveBeenCalled();
  });

  it('passes the JSON arguments to the procedure, whose own schema converts ISO strings to Dates', async () => {
    const procedure = os
      .meta(mcpMeta())
      .route({
        summary: 'Record instant',
        description: 'Receive an ISO date-time and return what the handler saw.',
        tags: ['Test'],
      })
      .input(
        z.object({
          receivedAt: z.iso
            .datetime({ offset: true })
            .transform((value) => new Date(value)),
        }),
      )
      .handler(({ input }) => ({
        isDate: input.receivedAt instanceof Date,
        epochMs: input.receivedAt.getTime(),
      }));
    const catalog = await buildMcpCatalog({ recordInstant: procedure });
    const { client } = await connectMcp(catalog, asContext({}));

    const listed = await client.listTools();
    const result = await client.callTool({
      name: 'recordInstant',
      arguments: { receivedAt: '2026-04-01T09:30:00+05:30' },
    });
    const invalid = await client.callTool({
      name: 'recordInstant',
      arguments: { receivedAt: 'yesterday' },
    });

    expect(listed.tools[0]?.inputSchema.properties).toMatchObject({
      receivedAt: { type: 'string', format: 'date-time' },
    });
    expect(JSON.parse(textContent(result))).toEqual({
      isDate: true,
      epochMs: Date.parse('2026-04-01T04:00:00.000Z'),
    });
    expect(invalid.isError).toBe(true);
    expect(textContent(invalid)).toContain('Input validation error');
  });

  it('lists and calls a public procedure with its JSON result', async () => {
    const procedure = os
      .meta(mcpMeta())
      .route({
        summary: 'Public greeting',
        description: 'Return a public greeting.',
        tags: ['Test'],
      })
      .input(z.object({ name: z.string() }))
      .handler(({ input }) => ({ greeting: `Hello, ${input.name}` }));
    const catalog = await buildMcpCatalog({ publicGreeting: procedure });
    const { client } = await connectMcp(catalog, asContext({}));

    const listed = await client.listTools();
    const result = await client.callTool({
      name: 'publicGreeting',
      arguments: { name: 'Ada' },
    });

    expect(listed.tools).toMatchObject([
      {
        name: 'publicGreeting',
        title: 'Public greeting',
        description: 'Return a public greeting.',
      },
    ]);
    expect(JSON.parse(textContent(result))).toEqual({ greeting: 'Hello, Ada' });
  });

  it('retains protected-procedure behavior with and without a session', async () => {
    const procedure = protectedProcedure
      .meta(mcpMeta())
      .route({
        summary: 'Read identity',
        description: 'Return the authenticated user identifier.',
        tags: ['Test'],
      })
      .input(z.object({}))
      .handler(({ context }) => ({ userId: context.session.user.id }));
    const catalog = await buildMcpCatalog({ readIdentity: procedure });
    const anonymous = await connectMcp(
      catalog,
      asContext({ session: null, principal: { authMethod: 'anonymous' } }),
    );
    const authenticated = await connectMcp(
      catalog,
      asContext({
        session: { user: { id: 'user-1' } },
        principal: { authMethod: 'apiKey' },
      }),
    );

    const denied = await anonymous.client.callTool({
      name: 'readIdentity',
      arguments: {},
    });
    const allowed = await authenticated.client.callTool({
      name: 'readIdentity',
      arguments: {},
    });

    expect(denied.isError).toBe(true);
    expect(JSON.parse(textContent(denied))).toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(JSON.parse(textContent(allowed))).toEqual({ userId: 'user-1' });
  });

  it('enforces OAuth scopes in the procedure middleware by the procedure’s access', async () => {
    const write = protectedProcedure
      .meta(mcpMeta({ access: 'write', destructive: false }))
      .route({ summary: 'Write', description: 'Create something.' })
      .handler(() => ({ ok: true }));
    const read = protectedProcedure
      .meta(mcpMeta())
      .route({ summary: 'Read', description: 'Read something.' })
      .handler(() => ({ ok: true }));
    const oauthContext = (scopes: string[]) =>
      asContext({
        session: { user: { id: 'user-1' } },
        principal: {
          authMethod: 'oauth',
          oauthGrant: { clientId: 'client', scopes, grantId: 'grant' },
        },
      });

    await expect(
      call(write, undefined, { context: oauthContext(['mcp:read']) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      call(write, undefined, { context: oauthContext(['mcp:read', 'mcp:write']) }),
    ).resolves.toEqual({ ok: true });
    await expect(
      call(read, undefined, { context: oauthContext(['mcp:read']) }),
    ).resolves.toEqual({ ok: true });
    await expect(
      call(read, undefined, { context: oauthContext([]) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('preserves ordinary-user and system-admin role behavior', async () => {
    type RoleContext = { session: { user: { role: string } } };
    const adminOnly = os
      .$context<RoleContext>()
      .meta(mcpMeta())
      .route({
        summary: 'Admin operation',
        description: 'Perform an operation reserved for system administrators.',
        tags: ['Test'],
      })
      .input(z.object({}))
      .handler(({ context }) => {
        if (context.session.user.role !== 'admin') {
          throw new ORPCError('FORBIDDEN');
        }
        return { allowed: true };
      });
    const catalog = await buildMcpCatalog({ adminOnly });
    const ordinaryContext = { session: { user: { role: 'user' } } };
    const adminContext = { session: { user: { role: 'admin' } } };
    const directOrdinary = call(adminOnly, {}, { context: ordinaryContext });
    const directAdmin = await call(adminOnly, {}, { context: adminContext });
    const ordinary = await connectMcp(catalog, asContext(ordinaryContext));
    const admin = await connectMcp(catalog, asContext(adminContext));

    await expect(directOrdinary).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(directAdmin).toEqual({ allowed: true });

    const ordinaryResult = await ordinary.client.callTool({
      name: 'adminOnly',
      arguments: {},
    });
    const adminResult = await admin.client.callTool({
      name: 'adminOnly',
      arguments: {},
    });
    expect(JSON.parse(textContent(ordinaryResult))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(JSON.parse(textContent(adminResult))).toEqual({ allowed: true });
  });

  it('reports validation failures and hides unexpected error details', async () => {
    const reportError = vi.fn();
    const procedure = os
      .meta(mcpMeta())
      .route({
        summary: 'Fail safely',
        description: 'Validate input and exercise safe error reporting.',
        tags: ['Test'],
      })
      .input(z.object({ fail: z.boolean() }))
      .handler(({ input }) => {
        if (input.fail) {
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'database password leaked',
          });
        }
        return { ok: true };
      });
    const catalog = await buildMcpCatalog({ failSafely: procedure });
    const { client } = await connectMcp(catalog, asContext({}), reportError);

    const validationFailure = await client.callTool({
      name: 'failSafely',
      arguments: { fail: 'not-a-boolean' },
    });
    expect(validationFailure.isError).toBe(true);
    expect(textContent(validationFailure)).toContain('Input validation error');

    const result = await client.callTool({
      name: 'failSafely',
      arguments: { fail: true },
    });
    const error = JSON.parse(textContent(result));

    expect(result.isError).toBe(true);
    expect(error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred.',
    });
    expect(textContent(result)).not.toContain('database password');
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'failSafely');
  });
});
