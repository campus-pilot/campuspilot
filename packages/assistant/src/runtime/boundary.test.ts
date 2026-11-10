import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOW_VIEW_TOOL_NAME } from '@campuspilot/assistant-contract/views';
import { describe, expect, it, vi } from 'vitest';

/**
 * The assistant's safety boundary, checked rather than trusted:
 * - the model reaches school data only through the API's MCP endpoint. Every
 *   tool it is offered is a tool the API's MCP assistant view listed, or the
 *   assistant's own `show_view`, which changes nothing and reaches nothing;
 * - the turn loop (`src/runtime` and everything it imports in this package)
 *   imports no API code (routers, procedures, permissions) and no school
 *   table. Its only database access is the assistant's own rows
 *   (`@campuspilot/db/schema/assistant`) through the shared client, written
 *   by our code, never offered to the model as a tool.
 */

const listedTools = vi.hoisted(() => [
  {
    name: 'school.listStudents',
    title: 'List students',
    description: 'Lists students.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    _meta: { 'campuspilot/exposure': 'core', 'campuspilot/module': 'students' },
  },
  {
    name: 'school.updateStudent',
    title: 'Update a student',
    description: 'Updates a student.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true },
    _meta: { 'campuspilot/exposure': 'advanced', 'campuspilot/module': 'students' },
  },
]);

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    async connect() {}
    async close() {}
    async listTools() {
      return { tools: listedTools };
    }
  },
  StreamableHTTPClientTransport: class {},
}));

const { loadToolCatalog } = await import('./tools');

describe('the tools offered to the model', () => {
  it('are exactly the MCP tools the API listed, plus show_view', async () => {
    const catalog = await loadToolCatalog('delegated-token');
    const offered = catalog.ordered.map((tool) => ({ source: tool.source, name: tool.mcpName }));
    expect(offered).toEqual([
      { source: 'local', name: SHOW_VIEW_TOOL_NAME },
      ...listedTools.map((tool) => ({ source: 'mcp', name: tool.name })),
    ]);
    for (const tool of catalog.ordered) {
      expect(tool.source === 'mcp' || tool.modelName === SHOW_VIEW_TOOL_NAME).toBe(true);
    }
    // The only local tool shows a view; it never writes.
    const local = catalog.ordered.filter((tool) => tool.source === 'local');
    expect(local.map((tool) => [tool.modelName, tool.readOnly])).toEqual([[SHOW_VIEW_TOOL_NAME, true]]);
  });
});

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(SRC, 'runtime');

/** Import and export-from specifiers of a source file (static and dynamic). */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found = new Set<string>();
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
    found.add(match[1]!);
  }
  return [...found];
}

function resolveRelative(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  return base.endsWith('.ts') ? base : `${base}.ts`;
}

/** Every non-test source file the runtime reaches through relative imports, runtime files first. */
function runtimeClosure(): string[] {
  const roots = readdirSync(RUNTIME, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => join(RUNTIME, file));
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) queue.push(resolveRelative(file, specifier));
    }
  }
  return [...seen];
}

/** Packages the turn loop must never import: API code and school tables. */
function forbidden(specifier: string): boolean {
  if (specifier === '@campuspilot/api' || specifier.startsWith('@campuspilot/api/')) return true;
  if (specifier === '@campuspilot/db/schema' || specifier === '@campuspilot/db/schema/index') return true;
  if (specifier.startsWith('@campuspilot/db/schema/')) return specifier !== '@campuspilot/db/schema/assistant';
  return false;
}

describe('the turn loop', () => {
  it('imports no API code and no school table, directly or through this package', () => {
    const files = runtimeClosure();
    // The closure must include the loop itself, or this test proves nothing.
    expect(files).toContain(join(RUNTIME, 'conversation.ts'));
    const violations = files.flatMap((file) =>
      specifiersOf(file)
        .filter(forbidden)
        .map((specifier) => `${relative(SRC, file)} imports ${specifier}`),
    );
    expect(violations).toEqual([]);
  });
});
