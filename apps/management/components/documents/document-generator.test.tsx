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
process.env.NEXT_PUBLIC_WEBSITE_URL ??= 'http://localhost:5174';
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

test("an examination document's class picker lists the examination's classes, not the school's", () => {
  // A class excluded from the examination must not be offered for its admit
  // cards: the picker reads the examination's classes taking part
  // (`getExamContext`), never the school's whole class list (`listClasses`).
  const client = new QueryClient();
  const workspace = documentWorkspacePermissions(scope.schoolId, 'admit_card');
  client.setQueryData(orpc.authorization.checkPermissions.queryKey({ input: { permissions: workspace } }), {
    results: workspace.map(() => true),
  });
  client.setQueryData(
    orpc.school.getActiveDocumentTemplate.queryKey({ input: { schoolId: scope.schoolId, documentType: 'admit_card' } }),
    { artifact: { id: 'template', name: 'Admit card' } } as never,
  );
  client.setQueryData(orpc.school.getSession.queryKey({ input: scope }), {
    sessionConfig: { examConfig: { 'mid-term': { name: 'Mid-term', order: 1 } } },
  } as never);
  client.setQueryData(orpc.school.getExamContext.queryKey({ input: { ...scope, examSlug: 'mid-term' } }), {
    classes: [{ id: 'class-6', label: 'Class 6', subjects: {} }],
  } as never);
  const markup = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(DocumentGenerator, {
        scope,
        documentType: 'admit_card',
        initial: { examSlug: 'mid-term' },
        onHistory: () => {},
      }),
    ),
  );
  assert.match(markup, /Classes/);
  assert.doesNotMatch(markup, /Loading classes/);
  const read = client
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.queryKey));
  assert.ok(read.some((key) => key.includes('getExamContext')), 'reads the classes taking part');
  assert.ok(!read.some((key) => key.includes('listClasses')), 'never reads every school class');
});
