import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';

// `@/lib/orpc` reads the app's public settings when it is imported (any valid
// URL will do; this test never calls the server), so the gate is imported
// only after they are set.
process.env.NEXT_PUBLIC_SERVER_URL ??= 'http://localhost:3100';
process.env.NEXT_PUBLIC_MCP_URL ??= 'http://localhost:3100/mcp';
process.env.NEXT_PUBLIC_WEBSITE_URL ??= 'http://localhost:5174';
const { RequirePermissions } = await import('./require-permissions');
const { orpc } = await import('@/lib/orpc');

const permissions = [{ action: 'school:list_members', resource: { kind: 'school', schoolId: 'school' } }] as unknown as PermissionCheck[];
const refusal = createElement('p', null, 'Permission required');

/** Renders the gate once, with the check's answer in the cache (`undefined`: not answered yet). */
function render(results: boolean[] | undefined, props: { pending?: ReactNode } = {}) {
  const client = new QueryClient();
  if (results) client.setQueryData(orpc.authorization.checkPermissions.queryKey({ input: { permissions } }), { results });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RequirePermissions, { permissions, fallback: refusal, ...props, children: createElement('p', null, 'Staff') }),
    ),
  );
}

test('an unanswered check shows nothing, not the refusal', () => {
  // Every page asks its own permission list, so each navigation starts with an
  // unanswered check; showing `fallback` for it flashed "Permission required".
  assert.equal(render(undefined), '');
});

test('an unanswered check shows the pending view when one is given', () => {
  assert.equal(render(undefined, { pending: createElement('p', null, 'Loading') }), '<p>Loading</p>');
});

test('an answered check shows the page or the refusal', () => {
  assert.equal(render([true]), '<p>Staff</p>');
  assert.equal(render([false]), '<p>Permission required</p>');
});
