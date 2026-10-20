'use client';

import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
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
  allDocumentKinds,
} from '@campuspilot/components/documents/document-controls';
import { client, orpc } from '@/lib/orpc';
import {
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  templateManageAction,
  templateReadAction,
  useDocumentCache,
  type DocumentTemplateScope,
} from './document-common';

type MarketplaceItem = {
  slug: string;
  documentType: DocumentType;
  name: string;
  description: string;
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
};

function settingsHref(scope: DocumentTemplateScope) {
  return `/school/${encodeURIComponent(scope.schoolId)}/settings/templates/${settingsSlugs[scope.documentType]}`;
}

export function DocumentTemplateMarketplace({
  schoolId,
  initialType = 'report_card',
}: {
  schoolId: string;
  initialType?: DocumentType;
}) {
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
              onChange={field.handleChange}
              items={allDocumentKinds}
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
  if (market.isPending || active.isPending) return <DocumentLoading />;
  if (market.isError)
    return <DocumentReadError error={market.error} retry={market.refetch} />;
  if (active.isError)
    return <DocumentReadError error={active.error} retry={active.refetch} />;

  return (
    <DocumentPanel
      title={DOCUMENT_LABELS[scope.documentType]}
      description={`${market.data.pagination.totalItems} designs available for this document type.`}
      actions={
        active.data ? (
          <DocumentButton asChild variant="ghost">
            <Link href={settingsHref(scope)}>Open current template</Link>
          </DocumentButton>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {market.data.items.map((item) => (
          <MarketplaceCard
            key={item.slug}
            scope={scope}
            item={item}
            activeRevisionId={active.data?.artifact.id ?? null}
            selected={active.data?.artifact.marketplaceSlug === item.slug}
          />
        ))}
      </div>
    </DocumentPanel>
  );
}

function TemplateThumbnail({ item }: { item: MarketplaceItem }) {
  const kind = allDocumentKinds.find(({ value }) => value === item.documentType)!;
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

export function DocumentTemplateMarketplaceDetail({
  scope,
  slug,
}: {
  scope: DocumentTemplateScope;
  slug: string;
}) {
  const preview = useQuery(
    orpc.school.getMarketplaceTemplate.queryOptions({
      input: { ...scope, slug },
    }),
  );
  const active = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({ input: scope }),
  );
  if (preview.isPending || active.isPending) return <DocumentLoading />;
  if (preview.isError)
    return <DocumentReadError error={preview.error} retry={preview.refetch} />;
  if (active.isError)
    return <DocumentReadError error={active.error} retry={active.refetch} />;

  const selected = active.data?.artifact.marketplaceSlug === slug;
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
              {preview.data.name}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {preview.data.description}
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
              item={preview.data}
              activeRevisionId={active.data?.artifact.id ?? null}
              selected={selected}
            />
          </div>
        </header>
        <DocumentPreview html={preview.data.html} label={preview.data.name} sample />
      </div>
    </DocumentPermission>
  );
}
