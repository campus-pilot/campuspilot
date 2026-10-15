'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Check,
  Code2,
  Eye,
  LayoutTemplate,
  Save,
  Sparkles,
} from 'lucide-react';
import type { activeTemplateSchema } from '@campuspilot/api/routers/school/document/document.dto';
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
export function DocumentTemplates({ scope }: { scope: DocumentTemplateScope }) {
  const active = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({ input: scope }),
  );
  const market = useQuery(
    orpc.school.listMarketplaceTemplates.queryOptions({ input: scope }),
  );
  const selection = useForm({
    defaultValues: { slug: '', editorEpoch: 0 },
    validators: {
      onChange: z.object({ slug: z.string(), editorEpoch: z.number() }),
    },
  });
  if (active.isPending || market.isPending) return <DocumentLoading />;
  if (active.isError)
    return <DocumentReadError error={active.error} retry={active.refetch} />;
  if (market.isError)
    return <DocumentReadError error={market.error} retry={market.refetch} />;
  return (
    <div className="flex flex-col gap-6">
      <DocumentPanel
        title="Find your school’s style"
        description="Choose a starting point, then make it your own. Your selection applies across academic sessions."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {market.data.items.map((item) => (
            <MarketplaceCard
              key={item.slug}
              scope={scope}
              item={item}
              active={active.data}
              onPreview={() => selection.setFieldValue('slug', item.slug)}
            />
          ))}
        </div>
      </DocumentPanel>
      <selection.Subscribe selector={(state) => state.values.slug}>
        {(slug) => slug && <MarketplacePreview scope={scope} slug={slug} />}
      </selection.Subscribe>
      {active.data ? (
        <DocumentPermission
          schoolId={scope.schoolId}
          action={SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES}
          fallback={
            <SavedTemplatePreview scope={scope} template={active.data} />
          }
        >
          <selection.Subscribe selector={(state) => state.values.editorEpoch}>
            {(epoch) => (
              <TemplateEditor
                key={`${active.data!.artifact.id}-${epoch}`}
                scope={scope}
                template={active.data!}
                onReload={async () => {
                  await active.refetch();
                  selection.setFieldValue('editorEpoch', epoch + 1);
                }}
              />
            )}
          </selection.Subscribe>
        </DocumentPermission>
      ) : (
        <DocumentNotice>
          No template selected yet. Preview a design above and choose “Use
          template” to get started.
        </DocumentNotice>
      )}
    </div>
  );
}
function TemplateThumbnail({
  classic,
  card,
}: {
  classic: boolean;
  card: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex h-32 items-center justify-center overflow-hidden rounded-lg border bg-muted/30 ${classic ? 'text-blue-900' : 'text-emerald-800'}`}
    >
      <div
        className={`flex flex-col gap-2 border-t-4 border-current bg-white p-3 shadow-sm ${card ? 'w-48 rounded-md' : 'mt-10 h-36 w-40'}`}
      >
        <div className="h-1.5 w-20 rounded bg-current opacity-80" />
        <div className="h-1 w-28 rounded bg-slate-200" />
        <div className="mt-2 h-1 w-24 rounded bg-current opacity-30" />
        <div className="h-1 w-full rounded bg-slate-200" />
        <div className="h-1 w-full rounded bg-slate-200" />
        <div className="h-1 w-20 rounded bg-slate-200" />
      </div>
    </div>
  );
}
function MarketplaceCard({
  scope,
  item,
  active,
  onPreview,
}: {
  scope: DocumentTemplateScope;
  item: { slug: string; name: string; description: string };
  active: ActiveTemplate | null;
  onPreview: () => void;
}) {
  const cache = useDocumentCache();
  const form = useForm({
    defaultValues: { error: '' },
    validators: { onChange: z.object({ error: z.string() }) },
    onSubmit: async () => {
      if (!confirmNavigation()) return;
      form.setFieldValue('error', '');
      try {
        await client.school.selectMarketplaceTemplate({
          ...scope,
          slug: item.slug,
          expectedRevisionId: active?.artifact.id ?? null,
        });
        await cache.templates(scope);
      } catch (error) {
        form.setFieldValue(
          'error',
          error instanceof Error
            ? error.message
            : 'Unable to select this template.',
        );
      }
    },
  });
  const selected = active?.artifact.marketplaceSlug === item.slug;
  return (
    <article
      className={`flex flex-col gap-4 rounded-xl border p-4 ${selected ? 'border-primary/50 bg-primary/[0.02]' : ''}`}
    >
      <TemplateThumbnail
        classic={item.slug.endsWith('classic')}
        card={scope.documentType === 'id_card'}
      />
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{item.name}</h3>
        <p className="text-xs text-muted-foreground">{item.description}</p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe
          selector={(state) => ({
            submitting: state.isSubmitting,
            canSubmit: state.canSubmit,
            error: state.values.error,
          })}
        >
          {({ submitting, canSubmit, error }) => (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <DocumentButton
                  type="button"
                  variant="outline"
                  onClick={onPreview}
                >
                  <Eye />
                  Preview
                </DocumentButton>
                <DocumentPermission
                  schoolId={scope.schoolId}
                  action={SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES}
                >
                  <DocumentButton
                    type="submit"
                    disabled={selected || submitting || !canSubmit}
                  >
                    {selected ? <Check /> : <LayoutTemplate />}
                    {selected
                      ? 'Selected'
                      : submitting
                        ? 'Selecting…'
                        : 'Use template'}
                  </DocumentButton>
                </DocumentPermission>
              </div>
              {error && <DocumentNotice error>{error}</DocumentNotice>}
            </div>
          )}
        </form.Subscribe>
      </form>
    </article>
  );
}
function MarketplacePreview({
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
  if (preview.isPending) return <DocumentLoading />;
  if (preview.isError)
    return <DocumentReadError error={preview.error} retry={preview.refetch} />;
  return (
    <DocumentPreview
      html={preview.data.html}
      label={preview.data.name}
      sample
    />
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
  return preview.isError ? (
    <DocumentReadError error={preview.error} retry={preview.refetch} />
  ) : (
    <DocumentPreview
      html={preview.data?.html}
      label={template.artifact.name}
      sample
    />
  );
}
const proposalSchema = z
  .object({ content: z.string(), html: z.string() })
  .nullable();
/** Draft content remains local until an explicit save creates a new revision;
 * AI suggestions and preview responses never replace the active template.
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
      mode: 'save',
      proposal: null as z.infer<typeof proposalSchema>,
    },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, 'Give this template a name').max(120),
        content: z.string().trim().min(1, 'Add template HTML').max(200_000),
        preview: z.string(),
        previewContent: z.string(),
        error: z.string(),
        mode: z.enum(['save', 'preview']),
        proposal: proposalSchema,
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
    <div className="flex flex-col gap-5">
      <DocumentPanel
        title="Make it yours"
        description={`Editing ${template.artifact.name}. Changes only become active when you save.`}
      >
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
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <TemplateSourceForm
            form={form}
            template={template}
            onReload={onReload}
          />
          <TemplateDraftPreview
            form={form}
            template={template}
            initialHtml={initialPreview.data?.html}
          />
        </div>
        <details className="rounded-lg border p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Code2 className="size-4" />
            Template variable reference
          </summary>
          <pre className="mt-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
            {initialPreview.data?.contextHelp ?? 'Loading variable reference…'}
          </pre>
        </details>
      </DocumentPanel>
      <DocumentPermission
        schoolId={scope.schoolId}
        action={SCHOOL_ACTIONS.EDIT_DOCUMENT_TEMPLATES_WITH_AI}
      >
        <AiTemplateEditor
          scope={scope}
          getContent={() => form.state.values.content}
          onProposal={(proposal) => form.setFieldValue('proposal', proposal)}
        />
      </DocumentPermission>
      <form.Subscribe selector={(state) => state.values.proposal}>
        {(proposal) =>
          proposal && (
            <DocumentPanel
              title="Review AI’s suggestion"
              description="Review the layout and source. Apply it to your draft when ready, then save to activate it."
            >
              <DocumentPreview
                html={proposal.html}
                sample
                label="AI suggestion"
              />
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  View suggested source
                </summary>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">
                  {proposal.content}
                </pre>
              </details>
              <div className="flex gap-2">
                <DocumentButton
                  onClick={() => {
                    form.setFieldValue('content', proposal.content);
                    form.setFieldValue('preview', proposal.html);
                    form.setFieldValue('previewContent', proposal.content);
                    form.setFieldValue('proposal', null);
                  }}
                >
                  Apply to draft
                </DocumentButton>
                <DocumentButton
                  variant="outline"
                  onClick={() => form.setFieldValue('proposal', null)}
                >
                  Discard suggestion
                </DocumentButton>
              </div>
            </DocumentPanel>
          )
        }
      </form.Subscribe>
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
            description="Use the variable reference below. Keep styles self-contained; school branding and student photos are embedded automatically."
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
            {values.error && (
              <DocumentNotice error>
                {values.error} Your edits are still here. Reload the saved
                revision if someone else changed the template.
              </DocumentNotice>
            )}
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
                onClick={() => {
                  if (confirmNavigation()) void onReload();
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
        <div className="flex flex-col gap-3">
          {(values.previewContent || template.content) !== values.content && (
            <DocumentNotice>
              Preview reflects an earlier draft. Preview changes again before
              saving.
            </DocumentNotice>
          )}
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
function AiTemplateEditor({
  scope,
  getContent,
  onProposal,
}: {
  scope: DocumentTemplateScope;
  getContent: () => string;
  onProposal: (proposal: { content: string; html: string }) => void;
}) {
  const availability = useQuery(
    orpc.school.getDocumentAiAvailability.queryOptions({
      input: { schoolId: scope.schoolId },
    }),
  );
  const form = useForm({
    defaultValues: { prompt: '', error: '' },
    validators: {
      onChange: z.object({
        prompt: z
          .string()
          .trim()
          .min(1, 'Describe the change you want')
          .max(4000),
        error: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      form.setFieldValue('error', '');
      try {
        onProposal(
          await client.school.proposeDocumentTemplate({
            ...scope,
            prompt: value.prompt,
            content: getContent(),
          }),
        );
      } catch (error) {
        form.setFieldValue(
          'error',
          error instanceof Error
            ? error.message
            : 'Unable to generate a suggestion.',
        );
      }
    },
  });
  return (
    <DocumentPanel
      title="Design with a prompt"
      description="Describe a change in your own words. AI suggests a draft using the template’s variables."
    >
      {availability.isError ? (
        <DocumentReadError
          error={availability.error}
          retry={availability.refetch}
        />
      ) : !availability.data?.available ? (
        <DocumentNotice>
          {availability.isPending
            ? 'Checking AI availability…'
            : 'AI editing is not configured yet. You can still customize the template source above.'}
        </DocumentNotice>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="prompt">
            {(field) => (
              <DocumentField
                field={field}
                label="What would you like to change?"
                multiline
                description="For example: Use our green school color, make the student photo larger, and add a principal signature area."
              />
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              submitting: state.isSubmitting,
              canSubmit: state.canSubmit,
              error: state.values.error,
            })}
          >
            {({ submitting, canSubmit, error }) => (
              <div className="flex flex-col items-start gap-3">
                {error && <DocumentNotice error>{error}</DocumentNotice>}
                <DocumentButton
                  type="submit"
                  disabled={submitting || !canSubmit}
                >
                  <Sparkles />
                  {submitting ? 'Creating a suggestion…' : 'Suggest changes'}
                </DocumentButton>
              </div>
            )}
          </form.Subscribe>
        </form>
      )}
    </DocumentPanel>
  );
}
