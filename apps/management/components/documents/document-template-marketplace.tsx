'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect, useSearchParams } from 'next/navigation';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { Check, LayoutTemplate, Maximize2 } from 'lucide-react';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  DOCUMENT_LABELS,
  type TemplateDocumentType as DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import { DocumentButton, DocumentNotice } from '@campuspilot/components/documents/document-controls';
import { PreviewDialogContent } from '@campuspilot/components/documents/preview-dialog';
import { OptionSelect } from '@campuspilot/components/option-select';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { Dialog, DialogTrigger } from '@campuspilot/ui/components/dialog';
import { client, orpc } from '@/lib/orpc';
import { FeatureUnknown } from '../feature-unavailable';
import { resolveSchoolFeature } from '../require-feature-model';
import { schoolHref } from '../school-route';
import { settingsTemplateOf } from '../settings-templates';
import {
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  templateManageAction,
  templateReadAction,
  useDocumentCache,
  type ActiveTemplate,
  type DocumentTemplateScope,
} from './document-common';
import {
  defaultDesignOf,
  footprintLabel,
  landingTypeOf,
  marketplaceHref,
  marketplaceTypesOf,
} from './marketplace-model';
import {
  noticePreviewPrintSizeSchema,
  noticePrintSizeOptions,
  type NoticePreviewPrintSize,
} from './notice-print-size-preview';
import { MarketplaceTemplatePdfPreview } from './template-pdf-preview';

type MarketplaceItem = {
  slug: string;
  documentType: DocumentType;
  name: string;
  description: string;
  pageSize: 'full' | 'half';
};

/** The settings page of the school's template of a type (`SETTINGS_TEMPLATES` maps the human-facing slug). */
function settingsHref(scope: DocumentTemplateScope) {
  return schoolHref(scope.schoolId, settingsTemplateOf(scope.documentType).path);
}

/** The `history.state` key that marks the entry opening the full-screen preview pushed. */
const PREVIEW_HISTORY_MARK = 'campuspilotMarketplacePreview';

/** Whether the current history entry is one the preview's opening pushed (so Back leaves it). */
const onPushedPreviewEntry = () => (window.history.state as Record<string, unknown> | null)?.[PREVIEW_HISTORY_MARK] === true;

/**
 * Whether a design's full-screen preview is open, and opening or closing it.
 * It lives in the address (`?preview=1` on the design's own address, see
 * `marketplace-model.ts`), so a reload or a shared link opens it again. The
 * address is rewritten with the History API, never `router.*`: only the
 * query changes, and a router navigation would fetch the route's RSC payload
 * and keep the dialog waiting for it; Next syncs `useSearchParams` with
 * `pushState` and `replaceState` (see `lib/search-param.ts`).
 * - Opening pushes an entry, marked in `history.state`, so Back (a phone's
 *   back gesture above all) closes the full-screen preview instead of leaving
 *   the design.
 * - Closing goes back past that entry when this page pushed it, and otherwise
 *   (a shared link that opened the preview) replaces the entry with the
 *   design's address without `preview`.
 */
function usePreviewNavigation(scope: DocumentTemplateScope, slug: string) {
  const open = useSearchParams().get('preview') === '1';
  const design = { type: scope.documentType, template: slug };
  const setOpen = (next: boolean) => {
    if (next) window.history.pushState({ [PREVIEW_HISTORY_MARK]: true }, '', marketplaceHref(scope.schoolId, { ...design, preview: true }));
    else if (onPushedPreviewEntry()) window.history.back();
    else window.history.replaceState(null, '', marketplaceHref(scope.schoolId, design));
  };
  return { open, setOpen };
}

/**
 * The document types this school has templates for (`marketplaceTypesOf`),
 * from the school's one feature-flags query. The marketplace's pages and its
 * sidebar both use it, so they always offer the same types.
 */
export function useMarketplaceTypes(schoolId: string) {
  const flags = useQuery(orpc.school.getFeatureFlags.queryOptions({ input: { schoolId } }));
  const query = { isPending: flags.isPending, isError: flags.isError, features: flags.data?.features };
  const { types, status } = marketplaceTypesOf((feature) => resolveSchoolFeature(query, feature));
  return { types, status, retry: () => void flags.refetch() };
}

/**
 * Renders a redirect during render (`next/navigation`'s `redirect`, which
 * replaces the history entry, so Back does not return here and loop). It is
 * how the marketplace's root and a type's address open a design once the
 * client knows which: no effect is involved.
 */
function RedirectTo({ href }: { href: string }): never {
  redirect(href);
}

/**
 * The marketplace page's column. It has no page header of its own: the
 * breadcrumbs and the sidebar name the type, and the design's name heads the
 * design page.
 */
function MarketplaceFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 pb-12">{children}</div>;
}

/**
 * The school's document types, once known: loading while the school's
 * features are read, a retry when they could not be read (never "no
 * templates"), a notice when the school has no document type with templates,
 * else `children` with the types.
 */
function MarketplaceTypes({ schoolId, children }: { schoolId: string; children: (types: DocumentType[]) => ReactNode }) {
  const { types, status, retry } = useMarketplaceTypes(schoolId);
  if (status === 'pending') return <DocumentLoading />;
  if (status === 'unknown') return <FeatureUnknown feature="studentManagement" onRetry={retry} />;
  if (types.length === 0) {
    return <DocumentNotice>This school has no document templates yet. They come with student management, notices or the AI assistant.</DocumentNotice>;
  }
  return children(types);
}

/**
 * Shows `children` only for a type the school has and the user may read the
 * templates of; otherwise says so, with the sidebar left to choose another.
 */
function MarketplaceTypeGate({ scope, children }: { scope: DocumentTemplateScope; children: ReactNode }) {
  return (
    <MarketplaceTypes schoolId={scope.schoolId}>
      {(types) =>
        types.includes(scope.documentType) ? (
          <DocumentPermission
            schoolId={scope.schoolId}
            action={templateReadAction(scope.documentType)}
            fallback={<DocumentNotice>Template marketplace access is unavailable for your account.</DocumentNotice>}
          >
            {children}
          </DocumentPermission>
        ) : (
          <DocumentNotice>
            This school has no templates for {DOCUMENT_LABELS[scope.documentType]}. Choose another document type from the
            marketplace navigation.
          </DocumentNotice>
        )
      }
    </MarketplaceTypes>
  );
}

/** What a type's catalog and the school's template of that type say, once both are read. */
type MarketplaceCatalogState = { items: readonly MarketplaceItem[]; active: ActiveTemplate | null };

/**
 * Reads a type's catalog and the school's template of that type, then
 * renders `children` with them. Designs already listed stay when a background
 * refetch fails (`resolveQueryBoundary`). The catalog query is the one the
 * sidebar reads for the type's designs, so the two share one request.
 */
function MarketplaceCatalog({ scope, children }: { scope: DocumentTemplateScope; children: (catalog: MarketplaceCatalogState) => ReactNode }) {
  const market = useQuery(orpc.school.listMarketplaceTemplates.queryOptions({ input: scope }));
  const active = useQuery(orpc.school.getActiveDocumentTemplate.queryOptions({ input: scope }));
  const marketState = resolveQueryBoundary(market);
  const activeState = resolveQueryBoundary(active);
  if (marketState.kind === 'failed') return <DocumentReadError error={marketState.error} retry={market.refetch} />;
  if (activeState.kind === 'failed') return <DocumentReadError error={activeState.error} retry={active.refetch} />;
  if (marketState.kind === 'pending' || activeState.kind === 'pending') return <DocumentLoading />;
  return children({ items: marketState.data.items, active: activeState.data });
}

/** The two template read permissions (academic, finance), asked in one check by the marketplace's root. */
const TEMPLATE_READ_ACTIONS = [SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES] as const;

/**
 * Opens the first of the school's types the user may read the templates of
 * (`landingTypeOf`), deciding each type's permission with `templateReadAction`
 * like the sidebar and the pages do. A user who may read none is told so
 * rather than sent to a type that would refuse.
 */
function MarketplaceLandingRedirect({ schoolId, types }: { schoolId: string; types: readonly DocumentType[] }) {
  const access = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: TEMPLATE_READ_ACTIONS.map((action) => ({ action, resource: { kind: 'school' as const, schoolId } })) },
    }),
  );
  const state = resolveQueryBoundary(access);
  if (state.kind === 'failed') return <DocumentReadError error={state.error} retry={access.refetch} />;
  if (state.kind === 'pending') return <DocumentLoading />;
  const mayRead = (type: DocumentType) => state.data.results[TEMPLATE_READ_ACTIONS.indexOf(templateReadAction(type))] === true;
  const type = landingTypeOf(types, mayRead);
  if (!type) return <DocumentNotice>Template marketplace access is unavailable for your account.</DocumentNotice>;
  return <RedirectTo href={marketplaceHref(schoolId, { type })} />;
}

/** `/marketplace/templates`: opens the first type the school has that the user may read. */
export function MarketplaceLanding({ schoolId }: { schoolId: string }) {
  return (
    <MarketplaceFrame>
      <MarketplaceTypes schoolId={schoolId}>{(types) => <MarketplaceLandingRedirect schoolId={schoolId} types={types} />}</MarketplaceTypes>
    </MarketplaceFrame>
  );
}

/**
 * `/marketplace/templates/:type`: opens the design the school uses, when it
 * was imported from the catalog and is still listed, else the first listed
 * (`defaultDesignOf`). The template settings' Marketplace and Browse
 * marketplace actions open this address.
 */
export function MarketplaceTypeLanding({ schoolId, documentType }: { schoolId: string; documentType: DocumentType }) {
  const scope = { schoolId, documentType };
  return (
    <MarketplaceFrame>
      <MarketplaceTypeGate scope={scope}>
        <MarketplaceCatalog scope={scope}>
          {({ items, active }) => {
            const slug = defaultDesignOf(items.map((item) => item.slug), active?.artifact.marketplaceSlug ?? null);
            if (!slug) return <DocumentNotice>No designs are available for this document type yet.</DocumentNotice>;
            return <RedirectTo href={marketplaceHref(schoolId, { type: documentType, template: slug })} />;
          }}
        </MarketplaceCatalog>
      </MarketplaceTypeGate>
    </MarketplaceFrame>
  );
}

/**
 * `/marketplace/templates/:type/:slug`: one design. A slug the catalog no
 * longer lists (an old link) is said to be gone, with the sidebar left to
 * choose another: a different design is never shown in its place.
 */
export function MarketplaceDesignPage({ schoolId, documentType, slug }: { schoolId: string; documentType: DocumentType; slug: string }) {
  const scope = { schoolId, documentType };
  return (
    <MarketplaceFrame>
      <MarketplaceTypeGate scope={scope}>
        <MarketplaceCatalog scope={scope}>
          {({ items, active }) => {
            const item = items.find((candidate) => candidate.slug === slug);
            if (!item) {
              return <DocumentNotice>This design is no longer in the marketplace. Choose another design from the marketplace navigation.</DocumentNotice>;
            }
            return (
              <MarketplaceDesignView
                scope={scope}
                item={item}
                inUse={active?.artifact.marketplaceSlug === item.slug}
                activeRevisionId={active?.revisionId ?? null}
                hasTemplate={active !== null}
              />
            );
          }}
        </MarketplaceCatalog>
      </MarketplaceTypeGate>
    </MarketplaceFrame>
  );
}

/** What the page and the preview dialog both need to offer a design's actions: the type and the school's template of it. */
type DesignState = {
  scope: DocumentTemplateScope;
  activeRevisionId: string | null;
  hasTemplate: boolean;
};

/**
 * One design on its page and in its full-screen preview. A Notice design is
 * previewed at a notice print size ("Preview as", full or half A4, never
 * saved), shared by the page and the dialog; the choice is a form field.
 *
 * The dialog's root wraps the page so the page's Preview button is its
 * `DialogTrigger`: Radix returns focus to it when the dialog closes, also
 * when Back closed it.
 */
function MarketplaceDesignView({ item, inUse, ...state }: DesignState & { item: MarketplaceItem; inUse: boolean }) {
  const preview = usePreviewNavigation(state.scope, item.slug);
  const view = useForm({
    defaultValues: { printSize: 'full' as NoticePreviewPrintSize },
    validators: { onChange: z.object({ printSize: noticePreviewPrintSizeSchema }) },
  });
  const printSize = useStore(view.store, (store) => store.values.printSize);
  const printSizeControl =
    state.scope.documentType === 'notice' ? (
      <OptionSelect
        value={printSize}
        options={noticePrintSizeOptions}
        onValueChange={(next) => view.setFieldValue('printSize', next)}
        triggerProps={{ 'aria-label': 'Preview as', className: 'w-56 max-sm:w-full' }}
      />
    ) : null;
  return (
    <Dialog open={preview.open} onOpenChange={preview.setOpen}>
      <MarketplaceDesign {...state} item={item} inUse={inUse} printSize={printSize} printSizeControl={printSizeControl} />
      <MarketplacePreviewDialog {...state} item={item} inUse={inUse} printSize={printSize} printSizeControl={printSizeControl} />
    </Dialog>
  );
}

/** A design's name, paper and description. */
function DesignSummary({ item }: { item: MarketplaceItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">{item.name}</h1>
      <p className="text-xs font-medium text-foreground/80">{footprintLabel(item)}</p>
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{item.description}</p>
    </div>
  );
}

/** What can be done with a design anywhere it is shown: import it, or open the school's template in settings. */
function DesignActions({
  scope,
  item,
  inUse,
  activeRevisionId,
  hasTemplate,
}: DesignState & { item: MarketplaceItem; inUse: boolean }) {
  return (
    <>
      {hasTemplate ? (
        <DocumentButton asChild variant="ghost">
          <Link href={settingsHref(scope)}>Open current template</Link>
        </DocumentButton>
      ) : null}
      <UseMarketplaceTemplate scope={scope} item={item} activeRevisionId={activeRevisionId} selected={inUse} />
    </>
  );
}

/**
 * The selected design on the page: its summary and actions, then its PDF in
 * a frame most of the screen tall (the pages scroll inside it). Preview
 * opens the same PDF full screen.
 */
function MarketplaceDesign({
  item,
  inUse,
  printSize,
  printSizeControl,
  ...state
}: DesignState & {
  item: MarketplaceItem;
  inUse: boolean;
  printSize: NoticePreviewPrintSize;
  printSizeControl: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <DesignSummary item={item} />
        <div className="flex shrink-0 flex-wrap items-start gap-2">
          {printSizeControl}
          <DialogTrigger asChild>
            <DocumentButton variant="outline">
              <Maximize2 data-icon="inline-start" aria-hidden />
              Preview
            </DocumentButton>
          </DialogTrigger>
          <DesignActions {...state} item={item} inUse={inUse} />
        </div>
      </div>
      <div className="h-[75dvh] min-h-96">
        <MarketplaceTemplatePdfPreview
          scope={state.scope}
          slug={item.slug}
          printSize={printSize}
          label={`${item.name} preview with your school’s data`}
        />
      </div>
    </div>
  );
}

/**
 * A design full screen, on a phone and a larger screen alike, as the
 * question paper chat previews a draft (`PreviewDialogContent`): the pages
 * scroll inside the dialog, with Use template beside the title. It shows the
 * page's cached conversion, so opening it converts nothing again. It is the
 * content of the `Dialog` that `MarketplaceDesignView` controls from the
 * address; closing it drops `preview` from the address.
 */
function MarketplacePreviewDialog({
  item,
  inUse,
  printSize,
  printSizeControl,
  ...state
}: DesignState & {
  item: MarketplaceItem;
  inUse: boolean;
  printSize: NoticePreviewPrintSize;
  printSizeControl: ReactNode;
}) {
  return (
    <PreviewDialogContent
      size="full"
      title={item.name}
      description={`${DOCUMENT_LABELS[item.documentType]} · ${footprintLabel(item)} · Your school’s data, samples where missing. Nothing is imported until you choose Use template.`}
      actions={
        <>
          {printSizeControl}
          <DesignActions {...state} item={item} inUse={inUse} />
        </>
      }
    >
      <MarketplaceTemplatePdfPreview scope={state.scope} slug={item.slug} printSize={printSize} label={`${item.name} preview with your school’s data`} />
    </PreviewDialogContent>
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
        form.setFieldValue('error', error instanceof Error ? error.message : 'Unable to import this template.');
      }
    },
  });
  return (
    <DocumentPermission schoolId={scope.schoolId} action={templateManageAction(scope.documentType)}>
      <form.Subscribe selector={(state) => ({ submitting: state.isSubmitting, error: state.values.error })}>
        {({ submitting, error }) => (
          <div className="flex min-w-0 flex-col gap-2">
            <DocumentButton disabled={selected || submitting} onClick={() => void form.handleSubmit()}>
              {selected ? <Check /> : <LayoutTemplate />}
              {selected ? 'In use' : submitting ? 'Importing…' : 'Use template'}
            </DocumentButton>
            {error ? <DocumentNotice error>{error}</DocumentNotice> : null}
          </div>
        )}
      </form.Subscribe>
    </DocumentPermission>
  );
}
