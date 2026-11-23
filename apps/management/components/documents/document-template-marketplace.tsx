'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { Check, LayoutTemplate, Maximize2 } from 'lucide-react';
import { z } from 'zod';
import {
  DOCUMENT_LABELS,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import {
  DocumentButton,
  DocumentNotice,
  allDocumentKinds,
  noticeDocumentKind,
  questionPaperDocumentKind,
} from '@campuspilot/components/documents/document-controls';
import { PreviewDialogContent } from '@campuspilot/components/documents/preview-dialog';
import { OptionSelect } from '@campuspilot/components/option-select';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { ScrollableTabsList } from '@campuspilot/components/scrollable-tabs';
import { Dialog, DialogTrigger } from '@campuspilot/ui/components/dialog';
import { Tabs, TabsContent, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { client, orpc } from '@/lib/orpc';
import { FeatureUnknown } from '../feature-unavailable';
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
  footprintLabel,
  marketplaceHref,
  marketplaceRequestOf,
  selectedDesignOf,
  selectedTypeOf,
  type MarketplaceRequest,
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

/** Moves the marketplace to another type or design, in place; see `MarketplaceRequest`. */
type GoTo = (request: Partial<MarketplaceRequest>) => void;
/** Opens or closes a design's full-screen preview (see `useMarketplaceNavigation`). */
type PreviewNavigation = { open: (design: { type: DocumentType; template: string }) => void; close: (design: { type: DocumentType; template: string }) => void };

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

/** The `history.state` key that marks the entry opening the full-screen preview pushed. */
const PREVIEW_HISTORY_MARK = 'campuspilotMarketplacePreview';

/** Whether the current history entry is one the preview's opening pushed (so Back leaves it). */
const onPushedPreviewEntry = () => (window.history.state as Record<string, unknown> | null)?.[PREVIEW_HISTORY_MARK] === true;

/**
 * The type, design and preview the marketplace shows live in its address
 * (`?type=&template=&preview=1`, see `marketplace-model.ts`), so a reload, a
 * shared link or the template settings' Marketplace action opens the same
 * view. The address is rewritten with the History API, never `router.*`:
 * this route is an async server component, so a router navigation would
 * fetch its RSC payload on every tab and the tabs and dialog would wait for
 * it; Next syncs `useSearchParams` with `pushState` and `replaceState` (see
 * `lib/search-param.ts`).
 * - Picking a type or a design replaces the entry: tabs are not a trail to
 *   walk back through.
 * - Opening the preview pushes an entry, marked in `history.state`, so Back
 *   (a phone's back gesture above all) closes the full-screen preview instead
 *   of leaving the marketplace. Closing it goes back past that entry when
 *   this page pushed it, and otherwise (a shared link that opened the
 *   preview) replaces the entry without `preview`.
 */
function useMarketplaceNavigation(schoolId: string) {
  const request = marketplaceRequestOf(useSearchParams());
  const goTo: GoTo = (next) => window.history.replaceState(null, '', marketplaceHref(schoolId, next));
  const preview: PreviewNavigation = {
    open: (design) => window.history.pushState({ [PREVIEW_HISTORY_MARK]: true }, '', marketplaceHref(schoolId, { ...design, preview: true })),
    close: (design) => (onPushedPreviewEntry() ? window.history.back() : goTo(design)),
  };
  return { request, goTo, preview };
}

/**
 * The document types this school has templates for. The Notice template
 * exists only with the `notices` feature and the question paper template
 * only with `assistant` (the server refuses them otherwise); every other
 * type belongs to student management (`DOCUMENT_TYPE_FEATURE`). `pending`
 * while any of those is still unknown, so the tabs never open on a type
 * only to switch when the flags arrive.
 */
function useMarketplaceKinds(schoolId: string) {
  const notices = useSchoolFeature(schoolId, 'notices');
  const assistant = useSchoolFeature(schoolId, 'assistant');
  const studentManagement = useSchoolFeature(schoolId, 'studentManagement');
  const kinds = [
    ...(studentManagement.enabled ? allDocumentKinds : []),
    ...(notices.enabled ? [noticeDocumentKind] : []),
    ...(assistant.enabled ? [questionPaperDocumentKind] : []),
  ];
  const features = [notices, assistant, studentManagement];
  const pending = features.some((feature) => feature.status === 'pending');
  // The three come from one flags query: when it could not be read, every one is unknown and one retry reads them all.
  const unknown = features.find((feature) => feature.status === 'unknown') ? { retry: studentManagement.retry } : null;
  return { kinds, pending, unknown };
}

/**
 * The marketplace under its header: loading while the school's features are
 * read, a retry when they could not be read (never "no templates"), a notice
 * when the school has no document type with templates, else the tabs.
 */
function MarketplaceBody({ schoolId, navigation }: { schoolId: string; navigation: ReturnType<typeof useMarketplaceNavigation> }) {
  const { kinds, pending, unknown } = useMarketplaceKinds(schoolId);
  if (pending) return <DocumentLoading />;
  if (unknown) return <FeatureUnknown feature="studentManagement" onRetry={unknown.retry} />;
  if (kinds.length === 0) {
    return <DocumentNotice>This school has no document templates yet. They come with student management, notices or the AI assistant.</DocumentNotice>;
  }
  return <MarketplaceTypeTabs schoolId={schoolId} types={kinds} request={navigation.request} goTo={navigation.goTo} preview={navigation.preview} />;
}

/**
 * The template marketplace: a scrollable tab row of document types, under
 * it a scrollable tab row of the type's designs, and the selected design as
 * the PDF it prints as, with a full-screen preview and Use template.
 */
export function DocumentTemplateMarketplace({ schoolId }: { schoolId: string }) {
  const navigation = useMarketplaceNavigation(schoolId);
  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 pb-12">
      <header className="flex flex-col gap-1 border-b pb-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Marketplace</p>
        <h1 className="text-2xl font-semibold tracking-tight">Document templates</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Look a design over with sample data, then import it into your school. Your current template stays active
          until you choose another one.
        </p>
      </header>
      <MarketplaceBody schoolId={schoolId} navigation={navigation} />
    </div>
  );
}

/**
 * One tab per document type. Only the open tab's content is mounted (Radix
 * Tabs), so only that type's catalog is read and only its selected design is
 * converted to a PDF. A requested design and preview belong to the type
 * they were asked with, never to the type shown instead.
 */
function MarketplaceTypeTabs({
  schoolId,
  types,
  request,
  goTo,
  preview,
}: {
  schoolId: string;
  types: readonly { value: DocumentType; label: string }[];
  request: MarketplaceRequest;
  goTo: GoTo;
  preview: PreviewNavigation;
}) {
  const type = selectedTypeOf(request.type, types.map(({ value }) => value));
  // The body offers the tabs only when the school has a type.
  if (!type) return null;
  const asked = request.type === type;
  return (
    <Tabs
      value={type}
      onValueChange={(value) => {
        const next = types.find((item) => item.value === value);
        if (next) goTo({ type: next.value });
      }}
      className="min-w-0 gap-4"
    >
      <ScrollableTabsList aria-label="Document type">
        {types.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="h-9 flex-none px-3 text-sm">
            {item.label}
          </TabsTrigger>
        ))}
      </ScrollableTabsList>
      {types.map((item) => (
        <TabsContent key={item.value} value={item.value} className="min-w-0">
          <DocumentPermission
            schoolId={schoolId}
            action={templateReadAction(item.value)}
            fallback={<DocumentNotice>Template marketplace access is unavailable for your account.</DocumentNotice>}
          >
            <MarketplaceTypeSection
              scope={{ schoolId, documentType: item.value }}
              requestedSlug={asked ? request.template : null}
              previewRequested={asked && request.preview}
              goTo={goTo}
              preview={preview}
            />
          </DocumentPermission>
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** A type's catalog and the school's template of that type, then its designs. */
function MarketplaceTypeSection({
  scope,
  requestedSlug,
  previewRequested,
  goTo,
  preview,
}: {
  scope: DocumentTemplateScope;
  requestedSlug: string | null;
  previewRequested: boolean;
  goTo: GoTo;
  preview: PreviewNavigation;
}) {
  const market = useQuery(orpc.school.listMarketplaceTemplates.queryOptions({ input: scope }));
  const active = useQuery(orpc.school.getActiveDocumentTemplate.queryOptions({ input: scope }));
  // Designs already listed stay when a background refetch fails; see `resolveQueryBoundary`.
  const marketState = resolveQueryBoundary(market);
  const activeState = resolveQueryBoundary(active);
  if (marketState.kind === 'failed') return <DocumentReadError error={marketState.error} retry={market.refetch} />;
  if (activeState.kind === 'failed') return <DocumentReadError error={activeState.error} retry={active.refetch} />;
  if (marketState.kind === 'pending' || activeState.kind === 'pending') return <DocumentLoading />;

  const items = marketState.data.items;
  const inUseSlug = activeState.data?.artifact.marketplaceSlug ?? null;
  const selection = selectedDesignOf(requestedSlug, items.map(({ slug }) => slug), inUseSlug);
  const selected = items.find(({ slug }) => slug === selection.slug);
  if (!selected) return <DocumentNotice>No designs are available for this document type yet.</DocumentNotice>;
  return (
    <MarketplaceDesigns
      scope={scope}
      items={items}
      selected={selected}
      missingRequest={selection.missing}
      inUseSlug={inUseSlug}
      activeRevisionId={activeState.data?.revisionId ?? null}
      hasTemplate={activeState.data !== null}
      // The dialog opens only for the design that was asked for, never for one shown instead.
      previewOpen={previewRequested && requestedSlug !== null && !selection.missing}
      goTo={goTo}
      preview={preview}
    />
  );
}

/** What the page and the preview dialog both need to offer a design's actions: the type and the school's template of it. */
type DesignState = {
  scope: DocumentTemplateScope;
  activeRevisionId: string | null;
  hasTemplate: boolean;
};

/**
 * The designs of one type as a scrollable tab row, the selected design under
 * it, and its full-screen preview. A Notice design is previewed at a notice
 * print size ("Preview as", full or half A4, never saved), shared by the page
 * and the dialog; the choice is a form field.
 *
 * The design tabs activate on Enter or a click, not on focus
 * (`activationMode="manual"`): arrowing along the row would otherwise select,
 * and convert, every design it passes. The dialog's root wraps the tabs so
 * the page's Preview button is its `DialogTrigger`: Radix returns focus to it
 * when the dialog closes, also when Back closed it.
 */
function MarketplaceDesigns({
  items,
  selected,
  missingRequest,
  inUseSlug,
  previewOpen,
  goTo,
  preview,
  ...state
}: DesignState & {
  items: readonly MarketplaceItem[];
  selected: MarketplaceItem;
  missingRequest: boolean;
  inUseSlug: string | null;
  previewOpen: boolean;
  goTo: GoTo;
  preview: PreviewNavigation;
}) {
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
  const type = state.scope.documentType;
  const design = { type, template: selected.slug };
  return (
    <Dialog open={previewOpen} onOpenChange={(next) => (next ? preview.open(design) : preview.close(design))}>
      <Tabs value={selected.slug} onValueChange={(slug) => goTo({ type, template: slug })} activationMode="manual" className="min-w-0 gap-4">
        <ScrollableTabsList variant="default" aria-label={`${DOCUMENT_LABELS[type]} designs`}>
          {items.map((item) => (
            <DesignTab key={item.slug} item={item} inUse={item.slug === inUseSlug} />
          ))}
        </ScrollableTabsList>
        {missingRequest ? (
          <DocumentNotice>The design you followed is no longer in the marketplace. Showing {selected.name} instead.</DocumentNotice>
        ) : null}
        {items.map((item) => (
          <TabsContent key={item.slug} value={item.slug} className="min-w-0">
            <MarketplaceDesign {...state} item={item} inUse={item.slug === inUseSlug} printSize={printSize} printSizeControl={printSizeControl} />
          </TabsContent>
        ))}
      </Tabs>
      <MarketplacePreviewDialog {...state} item={selected} inUse={selected.slug === inUseSlug} printSize={printSize} printSizeControl={printSizeControl} />
    </Dialog>
  );
}

/** A design's tab: its name, with a check on the design the school uses now. */
function DesignTab({ item, inUse }: { item: MarketplaceItem; inUse: boolean }) {
  return (
    <TabsTrigger value={item.slug} className="h-7 flex-none px-2.5">
      {inUse ? <Check aria-hidden /> : null}
      {item.name}
      {inUse ? <span className="sr-only"> (in use)</span> : null}
    </TabsTrigger>
  );
}

/** A design's name, paper and description. */
function DesignSummary({ item }: { item: MarketplaceItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="text-base font-semibold">{item.name}</h2>
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
  // The tab panel is already named by its design's tab, so this is a plain container, not another labelled region.
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
          label={`${item.name} preview with sample data`}
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
 * content of the `Dialog` that `MarketplaceDesigns` controls from the
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
      description={`${DOCUMENT_LABELS[item.documentType]} · ${footprintLabel(item)} · Sample data. Nothing is imported until you choose Use template.`}
      actions={
        <>
          {printSizeControl}
          <DesignActions {...state} item={item} inUse={inUse} />
        </>
      }
    >
      <MarketplaceTemplatePdfPreview scope={state.scope} slug={item.slug} printSize={printSize} label={`${item.name} preview with sample data`} />
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
