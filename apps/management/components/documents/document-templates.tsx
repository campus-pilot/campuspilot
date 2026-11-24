'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { Store } from 'lucide-react';
import { DocumentButton, DocumentPanel } from '@campuspilot/components/documents/document-controls';
import { OptionSelect } from '@campuspilot/components/option-select';
import { orpc } from '@/lib/orpc';
import { marketplaceHref as marketplaceHrefOf } from './marketplace-model';
import { noticePreviewPrintSizeSchema, noticePrintSizeOptions, type NoticePreviewPrintSize } from './notice-print-size-preview';
import {
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  templateManageAction,
  type ActiveTemplate,
  type DocumentTemplateScope,
} from './document-common';
import { TemplateRevisionPdfPreview } from './template-pdf-preview';
import { TemplateEditor, useTemplateWorkspaceView } from './template-workspace';

const TEMPLATE_TITLES: Record<DocumentTemplateScope['documentType'], string> = {
  report_card: 'Report Cards Template',
  id_card: 'Student ID Cards Template',
  admit_card: 'Admit Cards Template',
  timetable: 'Exam Timetable Template',
  bill: 'Bill Template',
  receipt: 'Receipt Template',
  statement: 'Account Statement Template',
  notice: 'Notice Template',
  question_paper: 'Question Paper Template',
};

/** The marketplace on this type; it opens on the design the school uses when that came from the marketplace. */
function marketplaceHref(scope: DocumentTemplateScope) {
  return marketplaceHrefOf(scope.schoolId, { type: scope.documentType });
}

/** The centred column of the states that are pages (no template, read-only, loading); the editor fills the window instead. */
function TemplatePageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">{children}</div>;
}

function TemplatePageHeader({
  scope,
  actions,
}: {
  scope: DocumentTemplateScope;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">
        {TEMPLATE_TITLES[scope.documentType]}
      </h1>
      <div className="flex shrink-0 flex-wrap gap-2">
        {actions}
        <DocumentButton asChild variant="outline">
          <Link href={marketplaceHref(scope)}>
            <Store />
            Marketplace
          </Link>
        </DocumentButton>
      </div>
    </header>
  );
}

/** Settings owns the active school template. Marketplace browsing and import
 * live on dedicated routes so selecting a design never competes with editing.
 */
export function DocumentTemplates({ scope }: { scope: DocumentTemplateScope }) {
  const active = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({ input: scope }),
  );
  // The template already loaded (and the editor with unsaved code under it)
  // stays when a background refetch fails; see `resolveQueryBoundary`.
  const state = resolveQueryBoundary(active);
  if (state.kind === 'pending') {
    return (
      <TemplatePageFrame>
        <DocumentLoading />
      </TemplatePageFrame>
    );
  }
  if (state.kind === 'failed') {
    return (
      <TemplatePageFrame>
        <DocumentReadError error={state.error} retry={active.refetch} />
      </TemplatePageFrame>
    );
  }
  const template = state.data;

  if (!template) {
    return <NoTemplateSelected scope={scope} />;
  }

  return (
    <DocumentPermission
      schoolId={scope.schoolId}
      action={templateManageAction(scope.documentType)}
      fallback={<SavedTemplatePreview scope={scope} template={template} />}
      pending={<SavedTemplatePreview scope={scope} template={template} />}
    >
      <EditableTemplate scope={scope} template={template} onReload={async () => void (await active.refetch())} />
    </DocumentPermission>
  );
}

/**
 * The editor of the selected revision, keyed by it: a save (or a colleague's)
 * adopts the new revision only after the query cache refreshes, as a fresh
 * editor. What the builder shows (its tool and phone section) is kept here,
 * above the key. The variable reference comes from the server's template
 * contract.
 */
function EditableTemplate({
  scope,
  template,
  onReload,
}: {
  scope: DocumentTemplateScope;
  template: ActiveTemplate;
  onReload: () => Promise<void>;
}) {
  const help = useQuery(orpc.school.learn_document_template_editing.queryOptions({ input: scope, staleTime: Number.POSITIVE_INFINITY }));
  // Above the key, so the tool and section on screen survive the remount a save causes.
  const view = useTemplateWorkspaceView();
  return (
    <TemplateEditor
      key={template.artifact.id}
      scope={scope}
      template={template}
      title={TEMPLATE_TITLES[scope.documentType]}
      contextHelp={help.data?.contextHelp}
      marketplaceHref={marketplaceHref(scope)}
      view={view}
      onReload={onReload}
    />
  );
}

/**
 * What the empty state says for a type without a selected template. Most
 * types cannot be created until a design is imported. A notice never needs
 * one: until the school picks a design, notices use the built-in default,
 * and the copy says so instead of implying notices are blocked.
 */
function noTemplateCopy(documentType: DocumentTemplateScope['documentType']) {
  if (documentType === 'notice') {
    return {
      title: 'Using the built-in notice design',
      description:
        'Notices already work: until your school picks a design, every plain-text notice is printed on the built-in default letterhead.',
      heading: 'Pick your own design',
      detail:
        'Import a notice design from the marketplace to replace the built-in one, then edit it here. Notices published earlier keep the design they were published with.',
    };
  }
  return {
    title: 'No template selected',
    description:
      'Import a design from the template marketplace before editing this document type.',
    heading: 'Browse the marketplace',
    detail: 'Preview available designs, then import one into this school.',
  };
}

function NoTemplateSelected({ scope }: { scope: DocumentTemplateScope }) {
  const copy = noTemplateCopy(scope.documentType);
  return (
    <TemplatePageFrame>
      <TemplatePageHeader scope={scope} />
      <DocumentPanel title={copy.title} description={copy.description}>
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 text-center">
          <Store className="size-10 text-muted-foreground/50" aria-hidden />
          <div className="flex max-w-md flex-col gap-1">
            <p className="text-sm font-medium">{copy.heading}</p>
            <p className="text-xs text-muted-foreground">{copy.detail}</p>
          </div>
          <DocumentButton asChild variant="outline">
            <Link href={marketplaceHref(scope)}>Browse marketplace</Link>
          </DocumentButton>
        </div>
      </DocumentPanel>
    </TemplatePageFrame>
  );
}

/**
 * The selected template for someone who may read but not change it: the same
 * PDF preview as the editor's, with the school's data, asked for by the selected
 * revision's id (`previewDocumentTemplateRevisionPdf`: converting source of
 * one's own needs the manage permission). A Notice design is previewed at
 * either print size (a view choice, never saved).
 */
function SavedTemplatePreview({
  scope,
  template,
}: {
  scope: DocumentTemplateScope;
  template: ActiveTemplate;
}) {
  const view = useForm({
    defaultValues: { printSize: 'full' as NoticePreviewPrintSize },
    validators: { onChange: z.object({ printSize: noticePreviewPrintSizeSchema }) },
  });
  const printSize = useStore(view.store, (state) => state.values.printSize);
  return (
    <TemplatePageFrame>
      <TemplatePageHeader
        scope={scope}
        actions={
          scope.documentType === 'notice' ? (
            <OptionSelect
              value={printSize}
              options={noticePrintSizeOptions}
              onValueChange={(next) => view.setFieldValue('printSize', next)}
              triggerProps={{ 'aria-label': 'Preview as', className: 'w-56 max-sm:w-full' }}
            />
          ) : null
        }
      />
      <div className="h-[80dvh] min-h-96">
        <TemplateRevisionPdfPreview scope={scope} revisionId={template.revisionId} printSize={printSize} label={`${template.artifact.name} preview`} />
      </div>
    </TemplatePageFrame>
  );
}
