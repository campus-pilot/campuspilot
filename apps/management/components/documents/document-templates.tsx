'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Maximize2,
  PanelLeftOpen,
  RefreshCw,
  Save,
  ScrollText,
  Store,
} from 'lucide-react';
import { z } from 'zod';
import { type activeTemplateSchema } from '@campuspilot/api/routers/school/document/document.dto';
import {
  DocumentButton,
  DocumentErrors,
  DocumentField,
  DocumentPanel,
  DocumentPreview,
} from '@campuspilot/components/documents/document-controls';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizablePanelRef,
} from '@campuspilot/ui/components/resizable';
import { client, orpc } from '@/lib/orpc';
import { confirmNavigation } from '@/lib/navigation-guard';
import { TemplatePromptEditor } from './template-prompt-editor';
import {
  DocumentDirtyGuard,
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  SCHOOL_ACTIONS,
  templateManageAction,
  useDocumentCache,
  type DocumentTemplateScope,
} from './document-common';

type ActiveTemplate = z.infer<typeof activeTemplateSchema>;

const TemplateCodeEditor = dynamic(
  () =>
    import('./template-code-editor').then(
      (module) => module.TemplateCodeEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-96 place-items-center bg-card text-sm text-muted-foreground">
        Loading code editor…
      </div>
    ),
  },
);

const TEMPLATE_TITLES: Record<DocumentTemplateScope['documentType'], string> = {
  report_card: 'Report Cards Template',
  id_card: 'Student ID Cards Template',
  admit_card: 'Admit Cards Template',
  timetable: 'Exam Timetable Template',
  bill: 'Bill Template',
  receipt: 'Receipt Template',
  statement: 'Account Statement Template',
};

const TEMPLATE_DIMENSIONS: Record<
  DocumentTemplateScope['documentType'],
  { width: number; height: number }
> = {
  report_card: { width: 210, height: 297 },
  id_card: { width: 85.6, height: 53.98 },
  admit_card: { width: 210, height: 148.5 },
  timetable: { width: 297, height: 210 },
  bill: { width: 210, height: 297 },
  receipt: { width: 210, height: 297 },
  statement: { width: 210, height: 297 },
};

const DESKTOP_WORKSPACE_QUERY = '(min-width: 1280px)';
const MM_TO_PX = 96 / 25.4;

function marketplaceHref(scope: DocumentTemplateScope) {
  return `/school/${encodeURIComponent(scope.schoolId)}/marketplace/templates?type=${scope.documentType}`;
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
  if (active.isPending) return <DocumentLoading />;
  if (active.isError)
    return <DocumentReadError error={active.error} retry={active.refetch} />;

  if (!active.data) {
    return (
      <div className="flex flex-col gap-5">
        <TemplatePageHeader scope={scope} />
        <DocumentPanel
          title="No template selected"
          description="Import a design from the template marketplace before editing this document type."
        >
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 text-center">
            <Store className="size-10 text-muted-foreground/50" aria-hidden />
            <div className="flex max-w-md flex-col gap-1">
              <p className="text-sm font-medium">Browse the marketplace</p>
              <p className="text-xs text-muted-foreground">
                Preview available designs, then import one into this school.
              </p>
            </div>
            <DocumentButton asChild variant="outline">
              <Link href={marketplaceHref(scope)}>Browse marketplace</Link>
            </DocumentButton>
          </div>
        </DocumentPanel>
      </div>
    );
  }

  return (
    <DocumentPermission
      schoolId={scope.schoolId}
      action={templateManageAction(scope.documentType)}
      fallback={<SavedTemplatePreview scope={scope} template={active.data} />}
    >
      <TemplateEditor
        key={active.data.artifact.id}
        scope={scope}
        template={active.data}
        onReload={async () => {
          await active.refetch();
        }}
      />
    </DocumentPermission>
  );
}

function SavedTemplatePreview({
  scope,
  template,
}: {
  scope: DocumentTemplateScope;
  template: ActiveTemplate;
}) {
  const preview = useQuery(
    orpc.school.previewDocumentTemplate.queryOptions({
      input: { ...scope, content: template.content },
    }),
  );
  return (
    <div className="flex flex-col gap-5">
      <TemplatePageHeader scope={scope} />
      {preview.isError ? (
        <DocumentReadError error={preview.error} retry={preview.refetch} />
      ) : (
        <DocumentPreview
          html={preview.data?.html}
          label={template.artifact.name}
          sample
        />
      )}
    </div>
  );
}

/** Draft content remains local until an explicit save creates a new revision;
 * preview responses never replace the active template.
 */
function useDocumentTemplateForm(
  scope: DocumentTemplateScope,
  template: ActiveTemplate,
) {
  const cache = useDocumentCache();
  const previewVersion = useRef(0);
  const initialPreview = useQuery(
    orpc.school.previewDocumentTemplate.queryOptions({
      input: { ...scope, content: template.content },
    }),
  );
  const form = useForm({
    defaultValues: {
      name: template.artifact.name,
      content: template.content,
      preview: '',
      previewContent: '',
      error: '',
      previewing: false,
    },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, 'Give this template a name').max(120),
        content: z.string().trim().min(1, 'Add template HTML').max(200_000),
        preview: z.string(),
        previewContent: z.string(),
        error: z.string(),
        previewing: z.boolean(),
      }),
    },
    onSubmit: async ({ value }) => {
      form.setFieldValue('error', '');
      try {
        await client.school.saveDocumentTemplate({
          ...scope,
          name: value.name,
          content: value.content,
          expectedRevisionId: template.artifact.id,
        });
        await cache.templates(scope);
      } catch (error) {
        form.setFieldValue(
          'error',
          error instanceof Error
            ? error.message
            : 'Unable to update this template.',
        );
      }
    },
  });

  /** Only the newest preview request may update the iframe. This prevents a
   * slower response for an older draft from replacing a newer render.
   */
  const renderPreview = useCallback(
    async (content: string) => {
      const version = previewVersion.current + 1;
      previewVersion.current = version;
      form.setFieldValue('error', '');
      form.setFieldValue('previewing', true);
      try {
        const result = await client.school.previewDocumentTemplate({
          ...scope,
          content,
        });
        if (previewVersion.current !== version) return;
        form.setFieldValue('preview', result.html);
        form.setFieldValue('previewContent', content);
      } catch (error) {
        if (previewVersion.current !== version) return;
        form.setFieldValue(
          'error',
          error instanceof Error
            ? error.message
            : 'Unable to render this template.',
        );
      } finally {
        if (previewVersion.current === version) {
          form.setFieldValue('previewing', false);
        }
      }
    },
    [form, scope],
  );

  return { form, initialPreview, renderPreview };
}

function subscribeToDesktopWorkspace(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_WORKSPACE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getDesktopWorkspaceSnapshot() {
  return window.matchMedia(DESKTOP_WORKSPACE_QUERY).matches;
}

/** matchMedia is consumed as an external store so responsive panel direction
 * does not require an effect or duplicate the stateful Monaco editor.
 */
function useDesktopWorkspace() {
  return useSyncExternalStore(
    subscribeToDesktopWorkspace,
    getDesktopWorkspaceSnapshot,
    () => false,
  );
}

function TemplateEditor({
  scope,
  template,
  onReload,
}: {
  scope: DocumentTemplateScope;
  template: ActiveTemplate;
  onReload: () => Promise<void>;
}) {
  const { form, initialPreview, renderPreview } = useDocumentTemplateForm(
    scope,
    template,
  );
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourcePanelRef = useResizablePanelRef();
  const workspace = useForm({
    defaultValues: { sourceOpen: true },
    validators: {
      onChange: z.object({ sourceOpen: z.boolean() }),
    },
  });
  const desktop = useDesktopWorkspace();
  const schedulePreview = useCallback(
    (content: string) => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => {
        previewTimer.current = null;
        void renderPreview(content);
      }, 650);
    },
    [renderPreview],
  );
  const refreshPreview = useCallback(
    (content: string) => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = null;
      return renderPreview(content);
    },
    [renderPreview],
  );
  const workspaceRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <form.Subscribe selector={(state) => state.values.content}>
        {(content) => (
          <TemplatePageHeader
            scope={scope}
            actions={
              <TemplatePromptEditor
                documentType={scope.documentType}
                content={content}
                contextHelp={initialPreview.data?.contextHelp}
              />
            }
          />
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <DocumentDirtyGuard
            dirty={
              values.name !== template.artifact.name ||
              values.content !== template.content
            }
          />
        )}
      </form.Subscribe>
      <div
        ref={workspaceRef}
        className="h-[70rem] min-w-0 overflow-hidden rounded-xl border bg-card xl:h-[46rem]"
      >
        <ResizablePanelGroup
          key={desktop ? 'desktop' : 'mobile'}
          orientation={desktop ? 'horizontal' : 'vertical'}
        >
          <ResizablePanel
            defaultSize="50"
            minSize={desktop ? '28' : '34'}
            collapsible
            collapsedSize="0"
            panelRef={sourcePanelRef}
            onResize={(size) => {
              workspace.setFieldValue('sourceOpen', size.asPercentage > 0);
            }}
          >
            <TemplateSourceForm
              form={form}
              template={template}
              onReload={onReload}
              onContentChange={schedulePreview}
              contextHelp={initialPreview.data?.contextHelp}
              onCollapse={() => sourcePanelRef.current?.collapse()}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="50" minSize={desktop ? '28' : '34'}>
            <workspace.Subscribe
              selector={(state) => state.values.sourceOpen}
            >
              {(sourceOpen) => (
                <TemplateDraftPreview
                  form={form}
                  scope={scope}
                  template={template}
                  initialHtml={initialPreview.data?.html}
                  onRefresh={refreshPreview}
                  sourceOpen={sourceOpen}
                  onExpand={() => sourcePanelRef.current?.expand()}
                />
              )}
            </workspace.Subscribe>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

type TemplateForm = ReturnType<typeof useDocumentTemplateForm>['form'];

function TemplateSourceForm({
  form,
  template,
  onReload,
  onContentChange,
  contextHelp,
  onCollapse,
}: {
  form: TemplateForm;
  template: ActiveTemplate;
  onReload: () => Promise<void>;
  onContentChange: (content: string) => void;
  contextHelp?: string;
  onCollapse: () => void;
}) {
  return (
    <form
      className="flex h-full min-h-0 min-w-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="shrink-0 border-b p-3">
        <form.Field name="name">
          {(field) => <DocumentField field={field} label="Template name" />}
        </form.Field>
      </div>
      <form.Field name="content">
        {(field) => (
          <TemplateCodeEditor
            value={field.state.value}
            onBlur={field.handleBlur}
            onCollapse={onCollapse}
            onChange={(content) => {
              field.handleChange(content);
              onContentChange(content);
            }}
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          values: state.values,
          submitting: state.isSubmitting,
          canSubmit: state.canSubmit,
          errors: state.errors,
        })}
      >
        {({ values, submitting, canSubmit, errors }) => (
          <div className="flex shrink-0 flex-col gap-3 border-t p-3">
            <DocumentErrors errors={errors} />
            {values.error ? (
              <p role="alert" className="text-sm text-destructive">
                {values.error} Your edits are still here. Reload the saved
                revision if someone else changed the template.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <DocumentButton
                type="submit"
                disabled={
                  submitting ||
                  !canSubmit ||
                  (values.name === template.artifact.name &&
                    values.content === template.content)
                }
              >
                <Save />
                {submitting ? 'Saving…' : 'Save template'}
              </DocumentButton>
              <DocumentButton
                variant="ghost"
                disabled={submitting}
                onClick={async () => {
                  if (await confirmNavigation()) void onReload();
                }}
              >
                Reload saved revision
              </DocumentButton>
            </div>
            <details className="border-t pt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Template variable reference
              </summary>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {contextHelp ?? 'Loading variable reference…'}
              </pre>
            </details>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function TemplateDraftPreview({
  form,
  scope,
  template,
  initialHtml,
  onRefresh,
  sourceOpen,
  onExpand,
}: {
  form: TemplateForm;
  scope: DocumentTemplateScope;
  template: ActiveTemplate;
  initialHtml?: string;
  onRefresh: (content: string) => Promise<void>;
  sourceOpen: boolean;
  onExpand: () => void;
}) {
  const view = useForm({
    defaultValues: {
      mode: 'scroll' as 'scroll' | 'page',
      width: 720,
    },
    validators: {
      onChange: z.object({
        mode: z.enum(['scroll', 'page']),
        width: z.number().positive(),
      }),
    },
  });
  const measurePreview = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const updateWidth = () => {
        view.setFieldValue('width', node.getBoundingClientRect().width);
      };
      updateWidth();
      const observer = new ResizeObserver(updateWidth);
      observer.observe(node);
      return () => observer.disconnect();
    },
    [view],
  );

  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => {
        const previewSource = values.preview
          ? values.previewContent
          : template.content;
        const stale = previewSource !== values.content;
        return (
          <section className="flex h-full min-w-0 flex-col bg-muted/30">
            <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium">Template preview</span>
                <span
                  className="text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {values.previewing
                    ? 'Refreshing…'
                    : stale
                      ? 'Waiting to refresh…'
                      : 'Sample data'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {!sourceOpen ? (
                  <DocumentButton
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Expand code editor"
                    title="Expand code editor"
                    onClick={onExpand}
                  >
                    <PanelLeftOpen />
                  </DocumentButton>
                ) : null}
                <view.Subscribe selector={(state) => state.values.mode}>
                  {(mode) => (
                    <>
                      <DocumentButton
                        size="sm"
                        variant={mode === 'scroll' ? 'secondary' : 'ghost'}
                        aria-pressed={mode === 'scroll'}
                        onClick={() => view.setFieldValue('mode', 'scroll')}
                      >
                        <ScrollText />
                        Scrollable
                      </DocumentButton>
                      <DocumentButton
                        size="sm"
                        variant={mode === 'page' ? 'secondary' : 'ghost'}
                        aria-pressed={mode === 'page'}
                        onClick={() => view.setFieldValue('mode', 'page')}
                      >
                        <Maximize2 />
                        A4 page
                      </DocumentButton>
                    </>
                  )}
                </view.Subscribe>
                <DocumentButton
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Refresh template preview"
                  disabled={values.previewing}
                  onClick={() => void onRefresh(values.content)}
                >
                  <RefreshCw
                    className={values.previewing ? 'animate-spin' : undefined}
                  />
                </DocumentButton>
              </div>
            </header>
            <div ref={measurePreview} className="min-h-0 flex-1 overflow-auto">
              <view.Subscribe selector={(state) => state.values}>
                {(viewValues) => (
                  <TemplatePreviewCanvas
                    documentType={scope.documentType}
                    html={values.preview || initialHtml}
                    mode={viewValues.mode}
                    width={viewValues.width}
                  />
                )}
              </view.Subscribe>
            </div>
          </section>
        );
      }}
    </form.Subscribe>
  );
}

function TemplatePreviewCanvas({
  documentType,
  html,
  mode,
  width,
}: {
  documentType: DocumentTemplateScope['documentType'];
  html?: string;
  mode: 'scroll' | 'page';
  width: number;
}) {
  if (!html) {
    return (
      <div className="grid h-full min-h-96 place-items-center text-sm text-muted-foreground">
        Your preview will appear here.
      </div>
    );
  }

  if (mode === 'scroll') {
    return (
      <iframe
        title="Scrollable template preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={html}
        className="block h-full min-h-[40rem] w-full border-0 bg-white"
      />
    );
  }

  const template = TEMPLATE_DIMENSIONS[documentType];
  const landscape = documentType === 'timetable';
  const pageWidth = (landscape ? 297 : 210) * MM_TO_PX;
  const pageHeight = (landscape ? 210 : 297) * MM_TO_PX;
  const templateWidth = template.width * MM_TO_PX;
  const templateHeight = template.height * MM_TO_PX;
  const scale = Math.min(Math.max((width - 32) / pageWidth, 0.25), 1);

  return (
    <div className="flex min-h-full justify-center p-4">
      <div
        className="relative shrink-0"
        style={{ width: pageWidth * scale, height: pageHeight * scale }}
      >
        <div
          className="absolute left-0 top-0 flex overflow-hidden border bg-white shadow-lg"
          style={{
            width: pageWidth,
            height: pageHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            alignItems: documentType === 'id_card' ? 'center' : 'flex-start',
            justifyContent: documentType === 'id_card' ? 'center' : 'flex-start',
          }}
        >
          <iframe
            title="A4 template preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={html}
            className="block shrink-0 border-0 bg-white"
            style={{ width: templateWidth, height: templateHeight }}
          />
        </div>
      </div>
    </div>
  );
}
