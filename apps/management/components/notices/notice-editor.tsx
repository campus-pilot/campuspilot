'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, skipToken, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { NOTICE_BODY_MODES, NOTICE_PAGE_SIZE_LABELS, NOTICE_PAGE_SIZES, NOTICE_TITLE_MAX_LENGTH, type NoticeBodyMode, type NoticeDto, type NoticePageSize } from '@campuspilot/api/routers/school/notice/notice.dto';
import { ClassScopePicker } from '@campuspilot/components/class-scope-picker';
import { DocumentButton, DocumentErrors, DocumentNotice, DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { NoticeAudienceField, NoticeCadetClassScopeField, noticeAudienceIncludesCadets, noticeAudienceSelection } from '@campuspilot/components/notices';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { ToggleGroup, ToggleGroupItem } from '@campuspilot/ui/components/toggle-group';
import { toast } from '@campuspilot/ui/lib/toast';

import { client, orpc } from '@/lib/orpc';
import { DirtyGuard } from '../exam/exam-common';
import { noticeHref } from '../notifications/notification-routes';
import { featureFlagsOutdatedBy } from '../require-feature-model';
import { RequirePermissions } from '../require-permissions';
import {
  NOTICE_BODY_MODE_LABELS,
  NOTICE_FIELD_IDS,
  NOTICE_TEMPLATE_VARIABLES,
  cadetAudienceNote,
  firstInvalidNoticeField,
  isNoticeConflict,
  newestRenderedPreview,
  noticeAudienceChoicesFor,
  noticeErrorMessage,
  noticeFormDefaults,
  noticeFormSchemaFor,
  noticePreviewContent,
  noticePrintSizeDescription,
  noticeSaveInput,
  noticesHref,
  type CadetAudienceAvailability,
  type NoticePreviewContent,
  type RenderedPreview,
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
  /** The draft being edited; null for a new notice. The editor works from the draft as it was when it opened. */
  baseline: NoticeDto | null;
  /** Whether this school can address students: available, known to be off, or unknown (features could not be read). */
  cadetAudience: CadetAudienceAvailability;
  /** Reads the school's features again (offered while `cadetAudience` is unknown). */
  onRetryFeatures: () => void;
  /** Reopens the editor on the notice as it is stored now, discarding what was typed (offered after a conflict). */
  onReload?: () => void;
};

type NoticePreview = UseQueryResult<{ html: string; pageSize: NoticePageSize }>;

/** What the live preview renders and the order in which it was typed (see `newestRenderedPreview`). */
type PreviewRequest = { content: NoticePreviewContent | null; sequence: number };

/**
 * The live preview's render. Each content is its own query, so an
 * out-of-date response can never replace a newer one. `lastGood` is the
 * last render that succeeded: `keepPreviousData` only bridges the wait for a
 * new render, and a render that **fails** (every keystroke inside an
 * unfinished `{{#if …}}`) has no data, which used to blank the panel. The
 * successful render is recorded when its request resolves (an event, not an
 * effect), and `staleTime: 0` makes every shown content pass through there.
 * Renders resolve in any order, so each carries the `sequence` of the
 * content it was asked for and an older one never replaces a newer one as
 * "the last preview that worked".
 */
function useNoticePreview(scope: NoticeSessionScope, { content, sequence }: PreviewRequest) {
  const [lastGood, setLastGood] = useState<RenderedPreview>();
  const input = content ? { schoolId: scope.schoolId, source: { kind: 'unsaved' as const, sessionId: scope.sessionId, ...content } } : null;
  const preview: NoticePreview = useQuery({
    queryKey: input ? orpc.school.previewNotice.queryKey({ input }) : [...orpc.school.previewNotice.key(), 'nothing-to-render'],
    queryFn: input
      ? async () => {
          const rendered = await client.school.previewNotice(input);
          setLastGood((current) => newestRenderedPreview(current, { sequence, html: rendered.html }));
          return rendered;
        }
      : skipToken,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });
  return { preview, lastGoodHtml: lastGood?.html };
}

/**
 * The editor's form, save and live preview.
 *
 * - **The draft as opened.** `opened` is the baseline of the first render.
 *   The form starts from it and a save names its `version`, so a background
 *   refetch of the notice neither replaces what the author is typing nor
 *   lets the save overwrite someone else's change unseen: the server
 *   answers CONFLICT, and the editor offers to load the stored notice.
 * - **The stored audience is shown as it is.** Whether students can be
 *   addressed (`cadetAudience`) is checked when saving, on the audience
 *   field; it never rewrites the form.
 * - **The preview** follows the form through the form's own debounced
 *   change listener (no effect): after a pause it records what to render.
 *   `previewRequest` is derived request state, not an input value.
 */
function useNoticeEditor({ scope, baseline, cadetAudience }: EditorProps) {
  const router = useRouter();
  const cache = useQueryClient();
  const [opened] = useState(baseline);
  const [conflict, setConflict] = useState(false);
  const defaultValues = noticeFormDefaults(opened);
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest>(() => ({ content: noticePreviewContent(defaultValues), sequence: 0 }));
  const form = useForm({
    defaultValues,
    // Rebuilt each render, so the check uses the features as they are when Save is pressed.
    validators: { onSubmit: noticeFormSchemaFor(() => cadetAudience) },
    listeners: {
      onChangeDebounceMs: PREVIEW_DEBOUNCE_MS,
      onChange: ({ formApi }) => setPreviewRequest((current) => ({ content: noticePreviewContent(formApi.state.values), sequence: current.sequence + 1 })),
    },
    onSubmitInvalid: ({ formApi }) => {
      const errors = Object.fromEntries(Object.entries(formApi.state.fieldMeta).map(([name, meta]) => [name, meta?.errors ?? []]));
      const field = firstInvalidNoticeField(errors, formApi.state.values.bodyMode);
      if (field) document.getElementById(NOTICE_FIELD_IDS[field].control)?.focus();
    },
    onSubmit: async ({ value }) => {
      try {
        const input = noticeSaveInput(value);
        const saved = opened
          ? await client.school.updateNotice({ schoolId: scope.schoolId, noticeId: opened.id, expectedVersion: opened.version, ...input })
          : await client.school.createNotice({ ...scope, ...input });
        cache.setQueryData(orpc.school.getNotice.queryKey({ input: { schoolId: scope.schoolId, noticeId: saved.id } }), saved);
        await Promise.all([
          cache.invalidateQueries({ queryKey: orpc.school.listNotices.key() }),
          cache.invalidateQueries({ queryKey: orpc.school.previewNotice.key() }),
        ]);
        toast.success('Draft saved.');
        router.push(noticeHref(scope.schoolId, scope.sessionId, saved.id));
      } catch (error) {
        // The form calls the API directly, so the app-wide cache handlers do not see this error.
        if (featureFlagsOutdatedBy(error)) void cache.invalidateQueries({ queryKey: orpc.school.getFeatureFlags.key() });
        if (opened && isNoticeConflict(error)) {
          setConflict(true);
          void cache.invalidateQueries({ queryKey: orpc.school.getNotice.queryKey({ input: { schoolId: scope.schoolId, noticeId: opened.id } }) });
        }
        form.setErrorMap({ onSubmit: { form: noticeErrorMessage(error, 'Unable to save this notice.'), fields: {} } });
      }
    },
  });
  return { form, opened, conflict, hasPreviewContent: previewRequest.content !== null, ...useNoticePreview(scope, previewRequest) };
}

type NoticeEditorState = ReturnType<typeof useNoticeEditor>;
type NoticeForm = NoticeEditorState['form'];

/** `aria-invalid` and `aria-describedby` of a control whose error text has the given id. */
function invalidProps(errors: readonly unknown[], errorId: string) {
  return errors.length > 0 ? ({ 'aria-invalid': true, 'aria-describedby': errorId } as const) : {};
}

function TitleField({ form }: { form: NoticeForm }) {
  const ids = NOTICE_FIELD_IDS.title;
  return (
    <form.Field name="title">
      {(field) => (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.control}>Title</Label>
          <Input id={ids.control} maxLength={NOTICE_TITLE_MAX_LENGTH} placeholder="For example: Annual Sports Day" {...invalidProps(field.state.meta.errors, ids.error)} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          <DocumentErrors id={ids.error} errors={field.state.meta.errors} />
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

function isPageSize(value: string): value is NoticePageSize {
  return (NOTICE_PAGE_SIZES as readonly string[]).includes(value);
}

/**
 * The paper the notice prints on, for both body modes. A plain notice's
 * school Notice design and a custom template both adapt to it
 * (`print.size`); the live preview shows the chosen frame. Changing it is a
 * saved edit, so it gives the draft a new version like any other change.
 */
function PrintSizeField({ form }: { form: NoticeForm }) {
  const ids = NOTICE_FIELD_IDS.pageSize;
  return (
    <form.Field name="pageSize">
      {(field) => (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span id={ids.control} className="text-sm font-medium">Print size</span>
            <ToggleGroup type="single" variant="outline" spacing={0} aria-labelledby={ids.control} aria-describedby={ids.error} value={field.state.value} onValueChange={(value) => { if (isPageSize(value)) field.handleChange(value); }}>
              {NOTICE_PAGE_SIZES.map((size) => <ToggleGroupItem key={size} value={size}>{NOTICE_PAGE_SIZE_LABELS[size]}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <p id={ids.error} className="text-xs text-muted-foreground">{noticePrintSizeDescription(field.state.value)}</p>
        </div>
      )}
    </form.Field>
  );
}

function PlainBodyField({ form }: { form: NoticeForm }) {
  const ids = NOTICE_FIELD_IDS.plainBody;
  return (
    <form.Field name="plainBody">
      {(field) => (
        <div className="flex flex-col gap-1.5">
          <Textarea id={ids.control} aria-label="Notice text" className="min-h-56" placeholder="Write the notice as you would write a message. Leave a blank line between paragraphs." {...invalidProps(field.state.meta.errors, ids.error)} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          <DocumentErrors id={ids.error} errors={field.state.meta.errors} />
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
      <p className="text-xs text-muted-foreground">A notice can show school, session and notice details only. Scripts and outside files are removed, and it prints on as many pages as it needs. Use {'{{print.size}}'} in a class to adapt the layout to full or half A4.</p>
    </div>
  );
}

function TemplateBodyField({ form }: { form: NoticeForm }) {
  const ids = NOTICE_FIELD_IDS.templateBody;
  return (
    <form.Field name="templateBody">
      {(field) => (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">You write the whole document in HTML with Handlebars variables. Your school&apos;s notice template is not used.</p>
          {/* The code editor has no single input to label; the group carries the field's name, validity and error, and takes focus when it is the first invalid field. */}
          <div id={ids.control} role="group" aria-label="Notice template code" tabIndex={-1} className="flex h-[28rem] overflow-hidden rounded-lg border aria-invalid:border-destructive" {...invalidProps(field.state.meta.errors, ids.error)}>
            <TemplateCodeEditor value={field.state.value} onBlur={field.handleBlur} onChange={field.handleChange} />
          </div>
          <DocumentErrors id={ids.error} errors={field.state.meta.errors} />
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
      <PrintSizeField form={form} />
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
              // The classes already loaded stay usable when a refetch fails.
              isError={classes.isError && classes.data === undefined}
              invalid={field.state.meta.errors.length > 0}
              id={NOTICE_FIELD_IDS.classIds.control}
              errorId={NOTICE_FIELD_IDS.classIds.error}
              search={search}
              page={page}
              onSelectedIdsChange={field.handleChange}
              onSearchChange={(value) => view.setFieldValue('search', value)}
              onPageChange={(value) => view.setFieldValue('page', value)}
            >
              <DocumentErrors id={NOTICE_FIELD_IDS.classIds.error} errors={field.state.meta.errors} />
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

/** What the author is told when students cannot be addressed, with a retry when that is merely unknown. */
function CadetAudienceNote({ note, onRetry }: { note: { text: string; retry: boolean }; onRetry: () => void }) {
  return (
    <p className="text-xs text-muted-foreground">
      {note.text}
      {note.retry ? <DocumentButton variant="outline" size="sm" className="ml-2" onClick={onRetry}>Retry</DocumentButton> : null}
    </p>
  );
}

/**
 * Who the notice is for. The stored audience is always shown as it is. When
 * the school cannot address students (or that could not be checked), new
 * student choices are not offered, a draft that already addresses students
 * keeps saying so with the reason, and saving it is refused on this field
 * until the author chooses Staff: the audience is never changed for them.
 */
function AudienceSection({ form, scope, opened, cadetAudience, onRetryFeatures }: { form: NoticeForm; scope: NoticeSessionScope; opened: NoticeDto | null; cadetAudience: CadetAudienceAvailability; onRetryFeatures: () => void }) {
  const ids = NOTICE_FIELD_IDS.audience;
  const choices = noticeAudienceChoicesFor(cadetAudience, opened);
  const note = cadetAudienceNote(cadetAudience, opened ? noticeAudienceSelection(opened).audience : null);
  return (
    <form.Field name="audience">
      {(field) => (
        <div id={ids.control} tabIndex={-1} className="flex flex-col gap-4">
          <NoticeAudienceField value={field.state.value} choices={choices} invalid={field.state.meta.errors.length > 0} errorId={ids.error} onChange={field.handleChange}>
            <DocumentErrors id={ids.error} errors={field.state.meta.errors} />
            {note ? <CadetAudienceNote note={note} onRetry={onRetryFeatures} /> : null}
          </NoticeAudienceField>
          {noticeAudienceIncludesCadets(field.state.value) ? <CadetClassScopeSection form={form} scope={scope} /> : null}
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

/**
 * Shown when a save was refused because the draft changed since it was
 * opened. What was typed stays on screen (it may be worth copying); loading
 * the stored notice is the author's explicit step, since it discards it.
 */
function ConflictNotice({ onReload }: { onReload?: () => void }) {
  return (
    <DocumentNotice error>
      Someone else changed this notice after you opened it, so your changes were not saved. Load the latest version to review it; what you typed here will be replaced.
      {onReload ? <DocumentButton variant="outline" className="ml-3" onClick={onReload}>Load the latest version</DocumentButton> : null}
    </DocumentNotice>
  );
}

function SaveBar({ form, cancelHref, schoolId, conflict, onReload }: { form: NoticeForm; cancelHref: string; schoolId: string; conflict: boolean; onReload?: () => void }) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, errors: state.errors })}>
      {({ canSubmit, isSubmitting, errors }) => (
        <div className="flex flex-col gap-3 border-t pt-4">
          {conflict ? <ConflictNotice onReload={onReload} /> : <DocumentErrors errors={errors} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!canSubmit || isSubmitting || conflict}>{isSubmitting ? 'Saving…' : 'Save draft'}</Button>
            <Button asChild type="button" variant="outline"><Link href={cancelHref}>Cancel</Link></Button>
          </div>
          <SaveHint schoolId={schoolId} />
        </div>
      )}
    </form.Subscribe>
  );
}

/** What is said under the preview: refreshing, following the text, or (after a failed render) that an older render is shown. */
function previewStatus(preview: NoticePreview, showingLastGood: boolean) {
  if (preview.isFetching) return 'Refreshing preview…';
  if (preview.isError) return showingLastGood ? 'Showing the last preview that worked. It updates when the problem above is fixed.' : null;
  return 'The preview follows what you write, with today as the date.';
}

/**
 * The sandboxed render of the unsaved notice. A render error (for example
 * unfinished template code) is shown above the last render that worked, so
 * the panel never goes blank while the author is in the middle of a line.
 * Only when nothing has rendered yet does the placeholder say what to do.
 */
function LivePreview({ preview, lastGoodHtml, hasContent }: { preview: NoticePreview; lastGoodHtml: string | undefined; hasContent: boolean }) {
  const failed = preview.isError && hasContent;
  const html = !hasContent ? undefined : failed ? lastGoodHtml : preview.data?.html;
  return (
    <aside className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-4 xl:self-start">
      {failed ? <DocumentNotice error>{noticeErrorMessage(preview.error, 'Unable to render this notice.')}</DocumentNotice> : null}
      <DocumentPreview fitPageWidth html={html} label={preview.data ? `Preview · ${NOTICE_PAGE_SIZE_LABELS[preview.data.pageSize]}` : 'Preview'} placeholder={failed ? 'Fix the problem above to see the preview.' : "Write the notice text to see it on your school's letterhead."} />
      <p className="text-xs text-muted-foreground" aria-live="polite">{hasContent ? previewStatus(preview, failed && html !== undefined) : null}</p>
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
  const { scope, cadetAudience, onRetryFeatures, onReload } = props;
  const { form, opened, conflict, preview, lastGoodHtml, hasPreviewContent } = useNoticeEditor(props);
  const cancelHref = opened ? noticeHref(scope.schoolId, scope.sessionId, opened.id) : noticesHref(scope);
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{opened ? 'Edit notice' : 'New notice'}</h1>
        <p className="text-sm text-muted-foreground">Write the notice, choose who it is for, and save it as a draft.</p>
      </div>
      <form.Subscribe selector={(state) => state.isDirty}>
        {(dirty) => <DirtyGuard dirty={dirty} description="Your unsaved notice changes will be lost." />}
      </form.Subscribe>
      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <form className="flex min-w-0 flex-col gap-5" noValidate onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
          <TitleField form={form} />
          <BodySection form={form} />
          <AudienceSection form={form} scope={scope} opened={opened} cadetAudience={cadetAudience} onRetryFeatures={onRetryFeatures} />
          <SaveBar form={form} cancelHref={cancelHref} schoolId={scope.schoolId} conflict={conflict} onReload={onReload} />
        </form>
        <LivePreview preview={preview} lastGoodHtml={lastGoodHtml} hasContent={hasPreviewContent} />
      </div>
    </section>
  );
}
