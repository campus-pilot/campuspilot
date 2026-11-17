import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';

// `@/lib/orpc` reads the app's public settings when it is imported (any valid
// URL will do; these tests never call the server), so the dialog is imported
// only after they are set.
process.env.NEXT_PUBLIC_SERVER_URL ??= 'http://localhost:3100';
process.env.NEXT_PUBLIC_MCP_URL ??= 'http://localhost:3100/mcp';
const { CreatePdfButton, DocumentGenerator } = await import('./document-generator');
const { documentWorkspacePermissions } = await import('./document-export-link');
const { documentPermission, SCHOOL_ACTIONS } = await import('./document-common');
const { orpc } = await import('@/lib/orpc');

const scope = { schoolId: 'school', sessionId: 'session' };

/** A query cache holding the answers the dialog would otherwise fetch. */
function cacheWith(canDownload: boolean) {
  const client = new QueryClient();
  const allow = (permissions: PermissionCheck[], results: boolean[]) =>
    client.setQueryData(orpc.authorization.checkPermissions.queryKey({ input: { permissions } }), { results });
  const workspace = documentWorkspacePermissions(scope.schoolId, 'timetable');
  allow(workspace, workspace.map(() => true));
  allow([documentPermission(scope.schoolId, SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS)], [canDownload]);
  client.setQueryData(
    orpc.school.getActiveDocumentTemplate.queryKey({ input: { schoolId: scope.schoolId, documentType: 'timetable' } }),
    { artifact: { id: 'template', name: 'Timetable' } } as never,
  );
  client.setQueryData(orpc.school.listClasses.queryKey({ input: { schoolId: scope.schoolId } }), [] as never);
  client.setQueryData(orpc.school.getSession.queryKey({ input: scope }), {
    sessionConfig: { examConfig: { 'mid-term': { name: 'Mid-term', order: 1 } } },
  } as never);
  return client;
}

/** The `<button>` tags whose text includes `label`. */
function buttons(markup: string, label: string) {
  return [...markup.matchAll(/<button[^>]*>.*?<\/button>/g)].map(([tag]) => tag).filter((tag) => tag.includes(label));
}

test('the documents dialog offers "Download PDF" before any preview', () => {
  // The button used to stay disabled until "Preview document" had been clicked.
  const markup = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: cacheWith(true) },
      createElement(DocumentGenerator, {
        scope,
        documentType: 'timetable',
        initial: { examSlug: 'mid-term' },
        onHistory: () => {},
      }),
    ),
  );
  const [download] = buttons(markup, 'Download PDF');
  assert.ok(download, 'the dialog shows "Download PDF"');
  assert.doesNotMatch(download, /\sdisabled=""/);
  assert.ok(buttons(markup, 'Preview document').length, 'preview stays available');
});

test('without the permission to download, the button only creates the PDF', () => {
  const render = (canDownload: boolean) =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: cacheWith(canDownload) },
        createElement(CreatePdfButton, {
          permission: { schoolId: scope.schoolId, action: SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS },
          disabled: false,
          running: null,
          onCreate: () => {},
        }),
      ),
    );
  assert.match(render(true), /Download PDF/);
  assert.doesNotMatch(render(false), /Download PDF/);
  assert.match(render(false), /Create PDF/);
});
