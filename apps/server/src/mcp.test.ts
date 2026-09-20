import type { Context } from '@campuspilot/api/context';
import { protectedProcedure } from '@campuspilot/api';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { call, lazy, ORPCError, os } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  buildMcpToolDefinitions,
  createCampusPilotMcpHandler,
  createCampusPilotMcpServer,
  normalizeMcpAuthRequest,
  type McpToolDefinition,
} from './mcp';

vi.mock('@campuspilot/auth/server', () => ({
  createAuth: vi.fn(),
}));

type ConnectedMcp = {
  client: Client;
  close: () => Promise<void>;
};

const openConnections: ConnectedMcp[] = [];

function asContext(value: unknown): Context {
  return value as Context;
}

async function connectMcp(
  tools: readonly McpToolDefinition[],
  context: Context,
  headers = new Headers(),
  reportError = vi.fn(),
): Promise<ConnectedMcp> {
  const server = createCampusPilotMcpServer({
    tools,
    headers,
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

describe('normalizeMcpAuthRequest', () => {
  it('maps a bearer API key without mutating the original request', async () => {
    const original = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer cp_user_key' },
      body: '{"jsonrpc":"2.0"}',
    });

    const normalized = normalizeMcpAuthRequest(original);

    expect(normalized).not.toBe(original);
    expect(normalized.headers.get('x-api-key')).toBe('cp_user_key');
    expect(normalized.headers.get('authorization')).toBe(
      'Bearer cp_user_key',
    );
    expect(original.headers.has('x-api-key')).toBe(false);
    expect(await normalized.text()).toBe('{"jsonrpc":"2.0"}');
    expect(await original.text()).toBe('{"jsonrpc":"2.0"}');
  });

  it('preserves an explicit API-key header over bearer authorization', () => {
    const normalized = normalizeMcpAuthRequest(
      new Request('http://localhost/api/mcp', {
        headers: {
          authorization: 'Bearer cp_bearer_key',
          'x-api-key': 'cp_explicit_key',
        },
      }),
    );

    expect(normalized.headers.get('x-api-key')).toBe('cp_explicit_key');
  });

  it.each([undefined, '', 'Basic abc', 'Bearer   '])(
    'does not invent an API-key header for malformed authorization %s',
    (authorization) => {
      const headers = new Headers();
      if (authorization !== undefined) {
        headers.set('authorization', authorization);
      }

      const normalized = normalizeMcpAuthRequest(
        new Request('http://localhost/api/mcp', { headers }),
      );

      expect(normalized.headers.has('x-api-key')).toBe(false);
    },
  );
});

describe('buildMcpToolDefinitions', () => {
  it('discovers nested and lazy procedures exactly once', async () => {
    const ping = os
      .route({
        summary: 'Ping',
        description: 'Return a public ping response.',
        tags: ['Test'],
      })
      .handler(() => 'pong');
    const echo = os
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

    const tools = await buildMcpToolDefinitions(router);

    expect(tools.map(({ name }) => name)).toEqual(['ping', 'nested.echo']);
    expect(new Set(tools.map(({ name }) => name)).size).toBe(tools.length);
    expect(
      tools.every(
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
      .route({
        summary: 'Scalar',
        description: 'Uses an unsupported scalar input.',
        tags: ['Test'],
      })
      .input(z.string())
      .handler(({ input }) => input);

    await expect(
      buildMcpToolDefinitions({ missingMetadata }),
    ).rejects.toThrow('summary and description');
    await expect(buildMcpToolDefinitions({ scalarInput })).rejects.toThrow(
      'top-level Zod object',
    );
  });

  it('covers every appRouter leaf while excluding direct binary upload handlers', async () => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    const { appRouter } = await import('@campuspilot/api/routers/index');

    const tools = await buildMcpToolDefinitions(appRouter);
    const names = tools.map(({ name }) => name);

    expect(names).toContain('healthCheck');
    expect(names).toContain('auth.setPassword');
    expect(names).toContain('school.getLogo');
    expect(names).toContain('school.listMembers');
    expect(names).toContain('school.activateSession');
    expect(names).toContain('systemAdmin.listSchools');
    expect(names).not.toContain('school.uploadLogo');
    expect(names).not.toContain('auth.uploadProfileImage');
    expect(names).not.toContain('auth.getProfileImage');
  });
});

describe('MCP tool execution', () => {
  it('initializes, lists, and calls tools through stateless Streamable HTTP', async () => {
    const procedure = os
      .route({
        summary: 'HTTP echo',
        description: 'Echo a value through the HTTP MCP transport.',
        tags: ['Test'],
      })
      .input(z.object({ value: z.string() }))
      .handler(({ input }) => input);
    const tools = buildMcpToolDefinitions({ httpEcho: procedure });
    const observedHeaders: Headers[] = [];
    const handler = createCampusPilotMcpHandler({
      tools,
      createContext: async (headers) => {
        observedHeaders.push(headers);
        return asContext({});
      },
      reportError: vi.fn(),
    });
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost/api/mcp'),
      {
        authProvider: { token: async () => 'cp_transport_key' },
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
    expect(observedHeaders).toHaveLength(1);
    expect(observedHeaders[0]?.get('authorization')).toBe(
      'Bearer cp_transport_key',
    );
    expect(observedHeaders[0]?.get('x-api-key')).toBe('cp_transport_key');
  });

  it('lists and calls a public procedure with its JSON result', async () => {
    const procedure = os
      .route({
        summary: 'Public greeting',
        description: 'Return a public greeting.',
        tags: ['Test'],
      })
      .input(z.object({ name: z.string() }))
      .handler(({ input }) => ({ greeting: `Hello, ${input.name}` }));
    const tools = await buildMcpToolDefinitions({ publicGreeting: procedure });
    const { client } = await connectMcp(tools, asContext({}));

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
      .route({
        summary: 'Read identity',
        description: 'Return the authenticated user identifier.',
        tags: ['Test'],
      })
      .input(z.object({}))
      .handler(({ context }) => ({ userId: context.session.user.id }));
    const tools = await buildMcpToolDefinitions({ readIdentity: procedure });
    const anonymous = await connectMcp(tools, asContext({ session: null }));
    const authenticated = await connectMcp(
      tools,
      asContext({ session: { user: { id: 'user-1' } } }),
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

  it('preserves ordinary-user and system-admin role behavior', async () => {
    type RoleContext = { session: { user: { role: string } } };
    const adminOnly = os
      .$context<RoleContext>()
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
    const tools = await buildMcpToolDefinitions({ adminOnly });
    const ordinaryContext = { session: { user: { role: 'user' } } };
    const adminContext = { session: { user: { role: 'admin' } } };
    const directOrdinary = call(adminOnly, {}, { context: ordinaryContext });
    const directAdmin = await call(adminOnly, {}, { context: adminContext });
    const ordinary = await connectMcp(tools, asContext(ordinaryContext));
    const admin = await connectMcp(tools, asContext(adminContext));

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
    const tools = await buildMcpToolDefinitions({ failSafely: procedure });
    const { client } = await connectMcp(
      tools,
      asContext({}),
      new Headers(),
      reportError,
    );

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
