'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { Braces, Eye, Save, Store } from 'lucide-react';
import { z } from 'zod';
import {
  DOCUMENT_LABELS,
  type activeTemplateSchema,
} from '@campuspilot/api/routers/school/document/document.dto';
import {
  DocumentButton,
  DocumentErrors,
  DocumentField,
  DocumentNotice,
  DocumentPanel,
  DocumentPreview,
} from '@campuspilot/components/documents/document-controls';
import { client, orpc } from '@/lib/orpc';
import { confirmNavigation } from '@/lib/navigation-guard';
import { TemplatePromptEditor } from './template-prompt-editor';
import {
  DocumentDirtyGuard,
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  SCHOOL_ACTIONS,
  useDocumentCache,
  type DocumentTemplateScope,
} from './document-common';

type ActiveTemplate = z.infer<typeof activeTemplateSchema>;

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
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          School template
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {DOCUMENT_LABELS[scope.documentType]}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Edit the school-owned template and preview it with safe sample data.
          The saved revision is used across academic sessions.
        </p>
      </div>
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
      action={SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES}
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
      mode: 'save' as 'save' | 'preview',
    },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, 'Give this template a name').max(120),
        content: z.string().trim().min(1, 'Add template HTML').max(200_000),
        preview: z.string(),
        previewContent: z.string(),
        error: z.string(),
        mode: z.enum(['save', 'preview']),
      }),
    },
    onSubmit: async ({ value }) => {
      form.setFieldValue('error', '');
      try {
        if (value.mode === 'preview') {
          const result = await client.school.previewDocumentTemplate({
            ...scope,
            content: value.content,
          });
          form.setFieldValue('preview', result.html);
          form.setFieldValue('previewContent', value.content);
        } else {
          await client.school.saveDocumentTemplate({
            ...scope,
            name: value.name,
            content: value.content,
            expectedRevisionId: template.artifact.id,
          });
          await cache.templates(scope);
        }
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
  return { form, initialPreview };
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
  const { form, initialPreview } = useDocumentTemplateForm(scope, template);
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
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.1fr)]">
        <details open className="group min-w-0 rounded-xl border bg-card">
          <summary className="flex cursor-pointer items-center gap-2 border-b px-5 py-4 text-sm font-semibold marker:hidden">
            <Braces className="size-4 text-muted-foreground" aria-hidden />
            Template HTML
            <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">
              Expand editor
            </span>
          </summary>
          <div className="flex min-w-0 flex-col gap-5 p-5">
            <TemplateSourceForm
              form={form}
              template={template}
              onReload={onReload}
            />
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Template variable reference
              </summary>
              <pre className="mt-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {initialPreview.data?.contextHelp ??
                  'Loading variable reference…'}
              </pre>
            </details>
          </div>
        </details>
        <TemplateDraftPreview
          form={form}
          template={template}
          initialHtml={initialPreview.data?.html}
        />
      </div>
    </div>
  );
}

type TemplateForm = ReturnType<typeof useDocumentTemplateForm>['form'];

function TemplateSourceForm({
  form,
  template,
  onReload,
}: {
  form: TemplateForm;
  template: ActiveTemplate;
  onReload: () => Promise<void>;
}) {
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.setFieldValue('mode', 'save');
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">
        {(field) => <DocumentField field={field} label="Template name" />}
      </form.Field>
      <form.Field name="content">
        {(field) => (
          <DocumentField
            field={field}
            label="Handlebars HTML"
            multiline
            code
            description="Keep styles self-contained. School branding and student photos are embedded automatically when available."
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
          <div className="flex flex-col gap-3">
            <DocumentErrors errors={errors} />
            {values.error ? (
              <DocumentNotice error>
                {values.error} Your edits are still here. Reload the saved
                revision if someone else changed the template.
              </DocumentNotice>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <DocumentButton
                type="button"
                variant="outline"
                disabled={submitting || !canSubmit}
                onClick={() => {
                  form.setFieldValue('mode', 'preview');
                  void form.handleSubmit();
                }}
              >
                <Eye />
                {submitting && values.mode === 'preview'
                  ? 'Rendering…'
                  : 'Preview changes'}
              </DocumentButton>
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
                {submitting && values.mode === 'save'
                  ? 'Saving…'
                  : 'Save template'}
              </DocumentButton>
              <DocumentButton
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={async () => {
                  if (await confirmNavigation()) void onReload();
                }}
              >
                Reload saved revision
              </DocumentButton>
            </div>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function TemplateDraftPreview({
  form,
  template,
  initialHtml,
}: {
  form: TemplateForm;
  template: ActiveTemplate;
  initialHtml?: string;
}) {
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <div className="flex min-w-0 flex-col gap-3">
          {(values.previewContent || template.content) !== values.content ? (
            <DocumentNotice>
              Preview reflects an earlier draft. Preview changes again before
              saving.
            </DocumentNotice>
          ) : null}
          <DocumentPreview
            html={values.preview || initialHtml}
            sample
            label="Template preview"
          />
        </div>
      )}
    </form.Subscribe>
  );
}
