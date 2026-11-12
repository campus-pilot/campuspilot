'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { Check, Eye, LayoutTemplate, Store } from 'lucide-react';
import { z } from 'zod';
import {
  DOCUMENT_LABELS,
  documentTypeSchema,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import {
  DocumentButton,
  DocumentKindCards,
  DocumentNotice,
  DocumentPanel,
  DocumentPreview,
  DocumentSelect,
  allDocumentKinds,
  noticeDocumentKind,
  questionPaperDocumentKind,
} from '@campuspilot/components/documents/document-controls';
import { client, orpc } from '@/lib/orpc';
import { useSchoolFeature } from '../require-feature';
import {
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  templateManageAction,
  templateReadAction,
  useDocumentCache,
  type DocumentTemplateScope,
} from './document-common';
import {
  marketplaceTemplatePreviewInput,
  noticePreviewPrintSizeSchema,
  noticePrintSizeOptions,
  type NoticePreviewPrintSize,
} from './notice-print-size-preview';

type MarketplaceItem = {
  slug: string;
  documentType: DocumentType;
  name: string;
  description: string;
  pageSize: 'full' | 'half';
};

/** Human-facing settings routes predate the API enum and stay explicitly mapped. */
const settingsSlugs: Record<DocumentType, string> = {
  report_card: 'examination',
  id_card: 'id-card',
  admit_card: 'admit-card',
  timetable: 'timetable',
  bill: 'bill',
  receipt: 'receipt',
  statement: 'statement',
  notice: 'notice',
  question_paper: 'question-paper',
};

function settingsHref(scope: DocumentTemplateScope) {
  return `/school/${encodeURIComponent(scope.schoolId)}/settings/templates/${settingsSlugs[scope.documentType]}`;
}

/** The selected marketplace type belongs in the URL so preview/back navigation
 * restores the same catalog instead of the server default.
 */
function marketplaceHref(schoolId: string, documentType: DocumentType) {
  return `/school/${encodeURIComponent(schoolId)}/marketplace/templates?type=${encodeURIComponent(documentType)}`;
}

export function DocumentTemplateMarketplace({
  schoolId,
  initialType = 'report_card',
}: {
  schoolId: string;
  initialType?: DocumentType;
}) {
  const router = useRouter();
  // The Notice template exists only for schools with the notices feature
  // (the server refuses it otherwise), so its card is offered only then.
  const notices = useSchoolFeature(schoolId, 'notices');
  // The question paper template belongs to the `assistant` feature in the same way.
  const assistant = useSchoolFeature(schoolId, 'assistant');
  const kinds = [
    ...allDocumentKinds,
    ...(notices.enabled ? [noticeDocumentKind] : []),
    ...(assistant.enabled ? [questionPaperDocumentKind] : []),
  ];
  const form = useForm({
    defaultValues: { documentType: initialType },
    validators: {
      onChange: z.object({ documentType: documentTypeSchema }),
    },
  });
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12">
        <header className="flex flex-col gap-1 border-b pb-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Marketplace
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Document templates
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Preview a design in context, then import it into your school. Your
            current template stays active until you choose another one.
          </p>
        </header>
        <form.Field name="documentType">
          {(field) => (
            <DocumentKindCards
              value={field.state.value}
              onChange={(documentType) => {
                field.handleChange(documentType);
                // Keep the route authoritative so a marketplace preview's Back
                // navigation restores the document type the user selected.
                router.replace(marketplaceHref(schoolId, documentType), {
                  scroll: false,
                });
              }}
              items={kinds}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.documentType}>
          {(documentType) => <DocumentPermission schoolId={schoolId} action={templateReadAction(documentType)} fallback={<DocumentNotice>Template marketplace access is unavailable for your account.</DocumentNotice>}><MarketplaceTypeSection key={documentType} scope={{ schoolId, documentType }} /></DocumentPermission>}
        </form.Subscribe>
    </div>
  );
}

function MarketplaceTypeSection({ scope }: { scope: DocumentTemplateScope }) {
  const market = useQuery(
    orpc.school.listMarketplaceTemplates.queryOptions({ input: scope }),
  );
  const active = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({ input: scope }),
  );
  // Designs already listed stay when a background refetch fails; see `resolveQueryBoundary`.
  const marketState = resolveQueryBoundary(market);
  const activeState = resolveQueryBoundary(active);
  if (marketState.kind === 'failed')
    return <DocumentReadError error={marketState.error} retry={market.refetch} />;
  if (activeState.kind === 'failed')
    return <DocumentReadError error={activeState.error} retry={active.refetch} />;
  if (marketState.kind === 'pending' || activeState.kind === 'pending') return <DocumentLoading />;

  return (
    <DocumentPanel
      title={DOCUMENT_LABELS[scope.documentType]}
      description={`${marketState.data.pagination.totalItems} designs available for this document type.`}
      actions={
        activeState.data ? (
          <DocumentButton asChild variant="ghost">
            <Link href={settingsHref(scope)}>Open current template</Link>
          </DocumentButton>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {marketState.data.items.map((item) => (
          <MarketplaceCard
            key={item.slug}
            scope={scope}
            item={item}
            activeRevisionId={activeState.data?.artifact.id ?? null}
            selected={activeState.data?.artifact.marketplaceSlug === item.slug}
          />
        ))}
      </div>
    </DocumentPanel>
  );
}

function TemplateThumbnail({ item }: { item: MarketplaceItem }) {
  const kind = [...allDocumentKinds, noticeDocumentKind, questionPaperDocumentKind].find(({ value }) => value === item.documentType)!;
  const palette = item.slug.endsWith('classic')
    ? 'border-blue-900/50 text-blue-900'
    : item.slug.endsWith('minimal')
      ? 'border-slate-400 text-slate-700'
      : item.slug.endsWith('crest')
        ? 'border-amber-800/50 text-amber-900'
        : 'border-emerald-800/50 text-emerald-800';
  return (
    <div
      aria-hidden="true"
      className={`relative flex h-40 items-center justify-center overflow-hidden rounded-lg border bg-muted/30 ${palette}`}
    >
      <div
        className={`flex flex-col gap-2 border border-current/20 border-t-4 bg-white p-4 shadow-sm ${item.documentType === 'id_card' ? 'h-24 w-48 rounded-md' : 'mt-12 h-44 w-40'}`}
      >
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-current/10">
            <Store className="size-3" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="h-1.5 w-20 rounded bg-current opacity-80" />
            <span className="h-1 w-12 rounded bg-slate-200" />
          </div>
        </div>
        <span className="mt-2 h-1 w-24 rounded bg-current opacity-30" />
        <span className="h-1 w-full rounded bg-slate-200" />
        <span className="h-1 w-full rounded bg-slate-200" />
        <span className="h-1 w-20 rounded bg-slate-200" />
      </div>
      <span className="absolute left-3 top-3 grid size-8 place-items-center rounded-lg border bg-background/90">
        <kind.icon className="size-4" />
      </span>
    </div>
  );
}

function MarketplaceCard({
  scope,
  item,
  activeRevisionId,
  selected,
}: {
  scope: DocumentTemplateScope;
  item: MarketplaceItem;
  activeRevisionId: string | null;
  selected: boolean;
}) {
  return (
    <article
      className={`flex min-w-0 flex-col gap-4 rounded-xl border p-4 ${selected ? 'border-primary/50 bg-primary/[0.03]' : ''}`}
    >
      <TemplateThumbnail item={item} />
      <div className="flex min-h-16 flex-col gap-1">
        <h3 className="text-sm font-semibold">{item.name}</h3>
        <p className="text-xs font-medium text-foreground/80">
          {/* Notice designs adapt to each notice's print size; they have no footprint. */}
          {item.documentType === 'notice'
            ? 'Full or half A4 · each notice chooses'
            : item.pageSize === 'half'
              ? 'Half A4 · two per sheet'
              : 'Full A4 · one per sheet'}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <DocumentButton asChild variant="outline">
          <Link
            href={`/school/${encodeURIComponent(scope.schoolId)}/marketplace/templates/${scope.documentType}/${encodeURIComponent(item.slug)}`}
          >
            <Eye />
            Preview
          </Link>
        </DocumentButton>
        <UseMarketplaceTemplate
          scope={scope}
          item={item}
          activeRevisionId={activeRevisionId}
          selected={selected}
        />
      </div>
    </article>
  );
}

/** Importing copies server-owned source into a new immutable school revision.
 * expectedRevisionId prevents a stale marketplace tab from replacing another
 * administrator's newer selection.
 */
function UseMarketplaceTemplate({
  scope,
  item,
  activeRevisionId,
  selected,
}: {
  scope: DocumentTemplateScope;
  item: MarketplaceItem;
  activeRevisionId: string | null;
  selected: boolean;
}) {
  const cache = useDocumentCache();
  const form = useForm({
    defaultValues: { error: '' },
    validators: { onChange: z.object({ error: z.string() }) },
    onSubmit: async () => {
      form.setFieldValue('error', '');
      try {
        await client.school.selectMarketplaceTemplate({
          ...scope,
          slug: item.slug,
          expectedRevisionId: activeRevisionId,
        });
        await cache.templates(scope);
      } catch (error) {
        form.setFieldValue(
          'error',
          error instanceof Error
            ? error.message
            : 'Unable to import this template.',
        );
      }
    },
  });
  return (
    <DocumentPermission
      schoolId={scope.schoolId}
      action={templateManageAction(scope.documentType)}
    >
      <form.Subscribe
        selector={(state) => ({
          submitting: state.isSubmitting,
          error: state.values.error,
        })}
      >
        {({ submitting, error }) => (
          <div className="flex min-w-0 flex-col gap-2">
            <DocumentButton
              disabled={selected || submitting}
              onClick={() => void form.handleSubmit()}
            >
              {selected ? <Check /> : <LayoutTemplate />}
              {selected
                ? 'In use'
                : submitting
                  ? 'Importing…'
                  : 'Use template'}
            </DocumentButton>
            {error ? <DocumentNotice error>{error}</DocumentNotice> : null}
          </div>
        )}
      </form.Subscribe>
    </DocumentPermission>
  );
}

/**
 * A marketplace design in context. A Notice design adapts to each notice's
 * print size (`print.size`), so its preview offers "Preview as" full or half
 * A4, the same choice as Settings › Templates › Notice. The choice is a form
 * field; the preview query is keyed by it.
 */
export function DocumentTemplateMarketplaceDetail({
  scope,
  slug,
}: {
  scope: DocumentTemplateScope;
  slug: string;
}) {
  const form = useForm({
    defaultValues: { printSize: 'full' as NoticePreviewPrintSize },
    validators: {
      onChange: z.object({ printSize: noticePreviewPrintSizeSchema }),
    },
  });
  const printSizeControl =
    scope.documentType === 'notice' ? (
      <form.Field name="printSize">
        {(field) => (
          <DocumentSelect
            field={field}
            label="Preview as"
            options={noticePrintSizeOptions}
          />
        )}
      </form.Field>
    ) : null;
  return (
    <form.Subscribe selector={(state) => state.values.printSize}>
      {(printSize) => (
        <MarketplaceDetail
          scope={scope}
          slug={slug}
          printSize={printSize}
          printSizeControl={printSizeControl}
        />
      )}
    </form.Subscribe>
  );
}

/**
 * The preview of one design at one print size. While another size renders,
 * the page keeps the design's name, actions and the "Preview as" control
 * (`keepPreviousData`), but never shows the previous size's render as the
 * new one: the preview is empty until the requested size arrives.
 */
function MarketplaceDetail({
  scope,
  slug,
  printSize,
  printSizeControl,
}: {
  scope: DocumentTemplateScope;
  slug: string;
  printSize: NoticePreviewPrintSize;
  printSizeControl: ReactNode;
}) {
  const preview = useQuery({
    ...orpc.school.getMarketplaceTemplate.queryOptions({
      input: marketplaceTemplatePreviewInput(scope, slug, printSize),
    }),
    placeholderData: keepPreviousData,
  });
  const active = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({ input: scope }),
  );
  // A design already shown stays when a background refetch fails; see `resolveQueryBoundary`.
  const previewState = resolveQueryBoundary(preview);
  const activeState = resolveQueryBoundary(active);
  if (previewState.kind === 'failed')
    return <DocumentReadError error={previewState.error} retry={preview.refetch} />;
  if (activeState.kind === 'failed')
    return <DocumentReadError error={activeState.error} retry={active.refetch} />;
  if (previewState.kind === 'pending' || activeState.kind === 'pending') return <DocumentLoading />;

  const selected = activeState.data?.artifact.marketplaceSlug === slug;
  const sizeLabel =
    scope.documentType === 'notice'
      ? noticePrintSizeOptions.find((option) => option.value === printSize)?.label
      : undefined;
  return (
    <DocumentPermission
      schoolId={scope.schoolId}
      action={templateReadAction(scope.documentType)}
      fallback={
        <DocumentNotice>
          Template marketplace access is unavailable for your account.
        </DocumentNotice>
      }
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12">
        <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {DOCUMENT_LABELS[scope.documentType]} · Marketplace preview
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {previewState.data.name}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {previewState.data.description}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {selected ? (
              <DocumentButton asChild variant="outline">
                <Link href={settingsHref(scope)}>Open in settings</Link>
              </DocumentButton>
            ) : null}
            <UseMarketplaceTemplate
              scope={scope}
              item={previewState.data}
              activeRevisionId={activeState.data?.artifact.id ?? null}
              selected={selected}
            />
          </div>
        </header>
        {printSizeControl ? <div className="w-full max-w-xs">{printSizeControl}</div> : null}
        <DocumentPreview
          html={preview.isPlaceholderData ? undefined : previewState.data.html}
          label={sizeLabel ? `${previewState.data.name} · ${sizeLabel}` : previewState.data.name}
          placeholder="Rendering the preview…"
          sample
        />
      </div>
    </DocumentPermission>
  );
}
