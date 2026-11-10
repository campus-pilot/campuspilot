'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { NOTICE_BODY_MODES, NOTICE_TITLE_MAX_LENGTH, type NoticeBodyMode, type NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import { ClassScopePicker } from '@campuspilot/components/class-scope-picker';
import { DocumentErrors, DocumentNotice, DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { NoticeAudienceField, NoticeCadetClassScopeField, noticeAudienceIncludesCadets } from '@campuspilot/components/notices';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { ToggleGroup, ToggleGroupItem } from '@campuspilot/ui/components/toggle-group';
import { toast } from '@campuspilot/ui/lib/toast';

import { client, orpc } from '@/lib/orpc';
import { DirtyGuard } from '../exam/exam-common';
import { noticeHref } from '../notifications/notification-routes';
import { RequirePermissions } from '../require-permissions';
import {
  NOTICE_BODY_MODE_LABELS,
  NOTICE_TEMPLATE_VARIABLES,
  audienceNarrowed,
  noticeErrorMessage,
  noticeFormDefaults,
  noticeFormSchema,
  noticePreviewContent,
  noticeSaveInput,
  noticesHref,
  type NoticePreviewContent,
  type NoticeSessionScope,
} from './notice-model';

const TemplateCodeEditor = dynamic(() => import('../documents/template-code-editor').then((module) => module.TemplateCodeEditor), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-card text-sm text-muted-foreground">Loading code editor…</div>,
});

/** How long the author must pause before the preview is rendered again (the template editor's delay). */
const PREVIEW_DEBOUNCE_MS = 650;

type EditorProps = {
  scope: NoticeSessionScope;
  /** The draft being edited, as it was when the editor opened; null for a new notice. */
  baseline: NoticeDto | null;
  cadetsAvailable: boolean;
};

/**
 * The editor's form, save and live preview.
 *
 * The preview follows the form through the form's own debounced change
 * listener (no effect): after a pause it records what to render, and a
 * query renders it. The query cache discards out-of-date responses, and the
 * last good render stays on screen while a newer one loads or fails.
 * `previewContent` is derived request state, not an input value.
 */
function useNoticeEditor({ scope, baseline, cadetsAvailable }: EditorProps) {
  const router = useRouter();
  const cache = useQueryClient();
  const defaultValues = noticeFormDefaults(baseline, cadetsAvailable);
  const [previewContent, setPreviewContent] = useState<NoticePreviewContent | null>(() => noticePreviewContent(defaultValues));
  const form = useForm({
    defaultValues,
    validators: { onSubmit: noticeFormSchema },
    listeners: {
      onChangeDebounceMs: PREVIEW_DEBOUNCE_MS,
      onChange: ({ formApi }) => setPreviewContent(noticePreviewContent(formApi.state.values)),
    },
    onSubmit: async ({ value }) => {
      try {
        const input = noticeSaveInput(value);
        const saved = baseline
          ? await client.school.updateNotice({ schoolId: scope.schoolId, noticeId: baseline.id, ...input })
          : await client.school.createNotice({ ...scope, ...input });
        cache.setQueryData(orpc.school.getNotice.queryKey({ input: { schoolId: scope.schoolId, noticeId: saved.id } }), saved);
        await Promise.all([
          cache.invalidateQueries({ queryKey: orpc.school.listNotices.key() }),
          cache.invalidateQueries({ queryKey: orpc.school.previewNotice.key() }),
        ]);
        toast.success('Draft saved.');
        router.push(noticeHref(scope.schoolId, scope.sessionId, saved.id));
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: noticeErrorMessage(error, 'Unable to save this notice.'), fields: {} } });
      }
    },
  });
  const preview = useQuery(
    orpc.school.previewNotice.queryOptions({
      input: previewContent ? { schoolId: scope.schoolId, source: { kind: 'unsaved', sessionId: scope.sessionId, ...previewContent } } : skipToken,
      placeholderData: keepPreviousData,
      retry: false,
      staleTime: 60_000,
    }),
  );
  return { form, preview, hasPreviewContent: previewContent !== null };
}

type NoticeEditorState = ReturnType<typeof useNoticeEditor>;
type NoticeForm = NoticeEditorState['form'];

function TitleField({ form }: { form: NoticeForm }) {
  return (
    <form.Field name="title">
      {(field) => (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notice-title">Title</Label>
          <Input id="notice-title" maxLength={NOTICE_TITLE_MAX_LENGTH} placeholder="For example: Annual Sports Day" aria-invalid={field.state.meta.errors.length > 0} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          <DocumentErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function isBodyMode(value: string): value is NoticeBodyMode {
  return (NOTICE_BODY_MODES as readonly string[]).includes(value);
}

/** Plain text is the default; the custom template is the advanced path and says what it is for. */
function BodyModeField({ form }: { form: NoticeForm }) {
  return (
    <form.Field name="bodyMode">
      {(field) => (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span id="notice-body-mode" className="text-sm font-medium">Notice text</span>
          <ToggleGroup type="single" variant="outline" spacing={0} aria-labelledby="notice-body-mode" value={field.state.value} onValueChange={(value) => { if (isBodyMode(value)) field.handleChange(value); }}>
            {NOTICE_BODY_MODES.map((mode) => <ToggleGroupItem key={mode} value={mode}>{NOTICE_BODY_MODE_LABELS[mode]}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      )}
    </form.Field>
  );
}

function PlainBodyField({ form }: { form: NoticeForm }) {
  return (
    <form.Field name="plainBody">
      {(field) => (
        <div className="flex flex-col gap-1.5">
          <Textarea aria-label="Notice text" className="min-h-56" placeholder="Write the notice as you would write a message. Leave a blank line between paragraphs." aria-invalid={field.state.meta.errors.length > 0} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          <DocumentErrors errors={field.state.meta.errors} />
          <p className="text-xs text-muted-foreground">Your school&apos;s letterhead, the date and the title are added for you.</p>
        </div>
      )}
    </form.Field>
  );
}

function TemplateVariables() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium">Variables you can use</p>
      <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        {NOTICE_TEMPLATE_VARIABLES.map((variable) => (
          <div key={variable.name} className="contents">
            <dt className="break-all font-mono">{variable.name}</dt>
            <dd className="text-muted-foreground">{variable.description}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">A notice can show school, session and notice details only. Scripts and outside files are removed, and it prints on as many A4 pages as it needs.</p>
    </div>
  );
}

function TemplateBodyField({ form }: { form: NoticeForm }) {
  return (
    <form.Field name="templateBody">
      {(field) => (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">You write the whole document in HTML with Handlebars variables. Your school&apos;s notice template is not used.</p>
          <div className="flex h-[28rem] overflow-hidden rounded-lg border">
            <TemplateCodeEditor value={field.state.value} onBlur={field.handleBlur} onChange={field.handleChange} />
          </div>
          <DocumentErrors errors={field.state.meta.errors} />
          <TemplateVariables />
        </div>
      )}
    </form.Field>
  );
}

function BodySection({ form }: { form: NoticeForm }) {
  return (
    <div className="flex flex-col gap-2">
      <BodyModeField form={form} />
      <form.Subscribe selector={(state) => state.values.bodyMode}>
        {(bodyMode) => (bodyMode === 'plain' ? <PlainBodyField form={form} /> : <TemplateBodyField form={form} />)}
      </form.Subscribe>
    </div>
  );
}

const classPickerViewSchema = z.object({ search: z.string(), page: z.number().int().positive() });

/** The classes of "Selected classes". The picker's search text and page live in their own small form, apart from what is saved. */
function SelectedClassesField({ form, scope }: { form: NoticeForm; scope: NoticeSessionScope }) {
  const classes = useQuery(orpc.school.listClasses.queryOptions({ input: scope }));
  const view = useForm({ defaultValues: { search: '', page: 1 }, validators: { onChange: classPickerViewSchema } });
  return (
    <view.Subscribe selector={(state) => state.values}>
      {({ search, page }) => (
        <form.Field name="classIds">
          {(field) => (
            <ClassScopePicker
              classes={(classes.data ?? []).map(({ id, label }) => ({ id, label }))}
              selectedIds={field.state.value}
              isPending={classes.isPending}
              isError={classes.isError}
              invalid={field.state.meta.errors.length > 0}
              search={search}
              page={page}
              onSelectedIdsChange={field.handleChange}
              onSearchChange={(value) => view.setFieldValue('search', value)}
              onPageChange={(value) => view.setFieldValue('page', value)}
            >
              <DocumentErrors errors={field.state.meta.errors} />
            </ClassScopePicker>
          )}
        </form.Field>
      )}
    </view.Subscribe>
  );
}

function CadetClassScopeSection({ form, scope }: { form: NoticeForm; scope: NoticeSessionScope }) {
  return (
    <form.Field name="cadetClassScope">
      {(field) => (
        <NoticeCadetClassScopeField value={field.state.value} onChange={field.handleChange}>
          {field.state.value === 'selected_classes' ? <SelectedClassesField form={form} scope={scope} /> : null}
        </NoticeCadetClassScopeField>
      )}
    </form.Field>
  );
}

/**
 * Who the notice is for. Without the Cadet Portal the student choices are
 * not rendered; `narrowed` tells the author of a draft that addressed
 * students why it now reads "Staff".
 */
function AudienceSection({ form, scope, cadetsAvailable, narrowed }: { form: NoticeForm; scope: NoticeSessionScope; cadetsAvailable: boolean; narrowed: boolean }) {
  return (
    <form.Field name="audience">
      {(field) => (
        <div className="flex flex-col gap-4">
          <NoticeAudienceField value={field.state.value} cadetsAvailable={cadetsAvailable} onChange={field.handleChange}>
            <DocumentErrors errors={field.state.meta.errors} />
            {narrowed ? <p className="text-xs text-muted-foreground">This draft was addressed to cadets. The Cadet Portal is not enabled for this school, so saving addresses it to staff only.</p> : null}
          </NoticeAudienceField>
          {cadetsAvailable && noticeAudienceIncludesCadets(field.state.value) ? <CadetClassScopeSection form={form} scope={scope} /> : null}
        </div>
      )}
    </form.Field>
  );
}

/** Tells the author what saving does and who publishes, by their own permission. */
function SaveHint({ schoolId }: { schoolId: string }) {
  return (
    <RequirePermissions
      permissions={{ action: SCHOOL_ACTIONS.PUBLISH_NOTICE, resource: { kind: 'school', schoolId } }}
      fallback={<p className="text-xs text-muted-foreground">Saving keeps this as a draft that only you, the principal and managers can see. A principal or manager publishes it.</p>}
    >
      <p className="text-xs text-muted-foreground">Saving keeps this as a draft and notifies nobody. You publish it from the notice page, after checking who will receive it.</p>
    </RequirePermissions>
  );
}

function SaveBar({ form, cancelHref, schoolId }: { form: NoticeForm; cancelHref: string; schoolId: string }) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, errors: state.errors })}>
      {({ canSubmit, isSubmitting, errors }) => (
        <div className="flex flex-col gap-3 border-t pt-4">
          <DocumentErrors errors={errors} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Saving…' : 'Save draft'}</Button>
            <Button asChild type="button" variant="outline"><Link href={cancelHref}>Cancel</Link></Button>
          </div>
          <SaveHint schoolId={schoolId} />
        </div>
      )}
    </form.Subscribe>
  );
}

function previewStatus(preview: NoticeEditorState['preview']) {
  if (preview.isFetching) return 'Refreshing preview…';
  if (preview.isError) return null;
  return 'The preview follows what you write, with today as the date.';
}

/** The sandboxed render of the unsaved notice. A render error (for example invalid template code) is shown above the last good render. */
function LivePreview({ preview, hasContent }: { preview: NoticeEditorState['preview']; hasContent: boolean }) {
  return (
    <aside className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-4 xl:self-start">
      {preview.isError && hasContent ? <DocumentNotice error>{noticeErrorMessage(preview.error, 'Unable to render this notice.')}</DocumentNotice> : null}
      <DocumentPreview fitPageWidth html={hasContent ? preview.data?.html : undefined} label="Preview" placeholder="Write the notice text to see it on your school's letterhead." />
      <p className="text-xs text-muted-foreground" aria-live="polite">{hasContent ? previewStatus(preview) : null}</p>
    </aside>
  );
}

/**
 * Writes or edits a draft: title, text (plain or a custom template), who it
 * is for, and a live preview. Saving never publishes; it returns to the
 * notice page, where publishing is confirmed with its delivery forecast.
 * Leaving with unsaved input asks first (`DirtyGuard`).
 */
export function NoticeEditor(props: EditorProps) {
  const { scope, baseline, cadetsAvailable } = props;
  const { form, preview, hasPreviewContent } = useNoticeEditor(props);
  const cancelHref = baseline ? noticeHref(scope.schoolId, scope.sessionId, baseline.id) : noticesHref(scope);
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{baseline ? 'Edit notice' : 'New notice'}</h1>
        <p className="text-sm text-muted-foreground">Write the notice, choose who it is for, and save it as a draft.</p>
      </div>
      <form.Subscribe selector={(state) => state.isDirty}>
        {(dirty) => <DirtyGuard dirty={dirty} description="Your unsaved notice changes will be lost." />}
      </form.Subscribe>
      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <form className="flex min-w-0 flex-col gap-5" noValidate onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
          <TitleField form={form} />
          <BodySection form={form} />
          <AudienceSection form={form} scope={scope} cadetsAvailable={cadetsAvailable} narrowed={audienceNarrowed(baseline, cadetsAvailable)} />
          <SaveBar form={form} cancelHref={cancelHref} schoolId={scope.schoolId} />
        </form>
        <LivePreview preview={preview} hasContent={hasPreviewContent} />
      </div>
    </section>
  );
}
