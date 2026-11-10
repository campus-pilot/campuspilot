import { z } from 'zod';
import {
  NOTICE_BODY_MODES,
  noticeBodySchema,
  noticeTitleSchema,
  validateNoticeAudience,
  type NoticeBodyMode,
  type NoticeStatus,
} from '@campuspilot/api/routers/school/notice/notice.dto';
import { NOTICE_TEMPLATE_STARTER } from '@campuspilot/api/routers/school/notice/notice-template-guide';
import { readSchoolFeatureDisabled } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import {
  NOTICE_AUDIENCE_CHOICES,
  NOTICE_CADET_CLASS_SCOPES,
  noticeAudienceChoicesOffered,
  noticeAudienceFacts,
  noticeAudienceIncludesCadets,
  noticeAudienceSelection,
  type NoticeAudienceChoice,
  type NoticeAudienceFacts,
} from '@campuspilot/components/notices';

import { resolveQueryBoundary, type QueryBoundaryInput } from '@campuspilot/components/query-boundary';

import { noticeHref } from '../notifications/notification-routes';
import { schoolSessionHref } from '../school-route';

/** A notice's school and session, as every notices screen receives them from the route. */
export type NoticeSessionScope = { schoolId: string; sessionId: string };

export function noticesHref({ schoolId, sessionId }: NoticeSessionScope) {
  return schoolSessionHref(schoolId, sessionId, '/notices');
}

export function newNoticeHref({ schoolId, sessionId }: NoticeSessionScope) {
  return schoolSessionHref(schoolId, sessionId, '/notices/new');
}

export function editNoticeHref({ schoolId, sessionId }: NoticeSessionScope, noticeId: string) {
  return `${noticeHref(schoolId, sessionId, noticeId)}/edit`;
}

/**
 * The starter template and the variable list of the custom-template editor
 * are owned by the API next to the renderer's context
 * (`notice-template-guide.ts`), so they cannot drift from what a notice can
 * actually read. Re-exported for the editor.
 */
export { NOTICE_TEMPLATE_STARTER, NOTICE_TEMPLATE_VARIABLES } from '@campuspilot/api/routers/school/notice/notice-template-guide';

/**
 * Whether this school can address students, as the editor needs to know it.
 * Three different facts, never folded into a boolean:
 * - `available`: the school has the Cadet Portal;
 * - `disabled`: it is known not to have it;
 * - `unknown`: the school's features could not be read, so nobody can say.
 */
export type CadetAudienceAvailability = 'available' | 'disabled' | 'unknown';

/** The availability of student audiences from the `cadet` feature's view (never called while it is `pending`). */
export function cadetAudienceAvailability(cadet: { enabled: boolean; status: 'pending' | 'unknown' | 'ready' }): CadetAudienceAvailability {
  if (cadet.status !== 'ready') return 'unknown';
  return cadet.enabled ? 'available' : 'disabled';
}

/**
 * Why a student audience cannot be saved right now, or null when it can.
 * The server refuses it too (the disabled-feature error for `cadet`); the
 * form says so next to the audience before the author loses a round trip.
 */
export function cadetAudienceBlock(audience: NoticeAudienceChoice, availability: CadetAudienceAvailability): string | null {
  if (!noticeAudienceIncludesCadets(audience) || availability === 'available') return null;
  return availability === 'disabled'
    ? 'The Cadet Portal is not enabled for this school, so a notice cannot be addressed to students. Choose Staff to save it for staff only.'
    : 'We could not check whether this school has the Cadet Portal. Retry, or choose Staff to save it for staff only.';
}

/**
 * What the author is told about student audiences under the audience
 * choices, or null when there is nothing to explain. It separates "this
 * school does not have the portal" from "we could not find out", and says
 * what happens to a draft that is already addressed to students: nothing,
 * until the author changes it.
 */
export function cadetAudienceNote(availability: CadetAudienceAvailability, stored: NoticeAudienceChoice | null): { text: string; retry: boolean } | null {
  const storedForCadets = stored !== null && noticeAudienceIncludesCadets(stored);
  if (availability === 'available') return null;
  if (availability === 'unknown') {
    return {
      text: storedForCadets
        ? 'We could not check whether this school has the Cadet Portal. This draft stays addressed to students; it cannot be saved until the check succeeds.'
        : 'We could not check whether this school has the Cadet Portal, so only Staff can be chosen for now.',
      retry: true,
    };
  }
  return storedForCadets
    ? { text: 'This draft is addressed to students, but the Cadet Portal is not enabled for this school. It stays as it is until you change it; to save or publish it, choose Staff.', retry: false }
    : null;
}

/** The audience choices the editor offers; see `noticeAudienceChoicesOffered`. */
export function noticeAudienceChoicesFor(availability: CadetAudienceAvailability, notice: NoticeAudienceFacts | null) {
  return noticeAudienceChoicesOffered(availability === 'available', notice ? noticeAudienceSelection(notice).audience : null);
}

/**
 * The editor's values. The two bodies are separate fields, so switching
 * between plain text and a custom template never overwrites what was typed
 * in the other mode; only the active mode's body is validated and saved.
 * The audience is held as the readable choice plus the class scope
 * (`NoticeAudienceSelection`) and converted to the stored facts on save.
 *
 * `availability` is read when the form is submitted (a getter, because the
 * school's features can change while the editor is open): a student
 * audience the school cannot address is an error on the audience field.
 */
export function noticeFormSchemaFor(availability: () => CadetAudienceAvailability) {
  return z
    .object({
      title: noticeTitleSchema,
      bodyMode: z.enum(NOTICE_BODY_MODES),
      plainBody: z.string(),
      templateBody: z.string(),
      audience: z.enum(NOTICE_AUDIENCE_CHOICES),
      cadetClassScope: z.enum(NOTICE_CADET_CLASS_SCOPES),
      classIds: z.array(z.string()),
    })
    .superRefine((value, context) => {
      const field = activeBodyField(value.bodyMode);
      const body = noticeBodySchema.safeParse(value[field]);
      if (!body.success) {
        for (const issue of body.error.issues) {
          context.addIssue({ code: 'custom', path: [field], message: value.bodyMode === 'template' && issue.code === 'too_small' ? 'Add the template HTML.' : issue.message });
        }
      }
      const blocked = cadetAudienceBlock(value.audience, availability());
      if (blocked) context.addIssue({ code: 'custom', path: ['audience'], message: blocked });
      // The server's own audience rules, on the facts this selection stores.
      validateNoticeAudience(noticeAudienceFacts(value), context);
    });
}

/** The form schema of a school that can address students (the shape of the values is the same for every school). */
export const noticeFormSchema = noticeFormSchemaFor(() => 'available');

export type NoticeFormValues = z.input<typeof noticeFormSchema>;

/** The form field that holds the body of a mode. */
export function activeBodyField(bodyMode: NoticeBodyMode) {
  return bodyMode === 'plain' ? ('plainBody' as const) : ('templateBody' as const);
}

type SavedNoticeContent = NoticeAudienceFacts & { title: string; bodyMode: NoticeBodyMode; body: string };

/**
 * The editor's starting values: a saved draft exactly as stored, or an
 * empty plain-text notice to staff. The stored audience is never adjusted
 * to what the school can address today: whether students can be addressed
 * is a separate fact (`CadetAudienceAvailability`), applied when saving,
 * not a reason to rewrite a draft the moment it is opened.
 */
export function noticeFormDefaults(notice: SavedNoticeContent | null): NoticeFormValues {
  const saved = notice ? noticeAudienceSelection(notice) : { audience: 'staff' as const, cadetClassScope: 'all_classes' as const, classIds: [] };
  return {
    title: notice?.title ?? '',
    bodyMode: notice?.bodyMode ?? 'plain',
    plainBody: notice?.bodyMode === 'plain' ? notice.body : '',
    templateBody: notice?.bodyMode === 'template' ? notice.body : NOTICE_TEMPLATE_STARTER,
    audience: saved.audience,
    cadetClassScope: saved.cadetClassScope,
    classIds: [...saved.classIds],
  };
}

/**
 * The form fields in the order they appear, for moving focus to the first
 * one that failed validation (the body field is the active mode's).
 */
export function firstInvalidNoticeField(fields: Partial<Record<keyof NoticeFormValues, unknown>>, bodyMode: NoticeBodyMode): keyof NoticeFormValues | null {
  const order: (keyof NoticeFormValues)[] = ['title', activeBodyField(bodyMode), 'audience', 'cadetClassScope', 'classIds'];
  const failed = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value));
  return order.find((name) => failed(fields[name])) ?? null;
}

/** The DOM id of each field's focusable control and of its error text (`aria-describedby`). */
export const NOTICE_FIELD_IDS = {
  title: { control: 'notice-title', error: 'notice-title-error' },
  plainBody: { control: 'notice-plain-body', error: 'notice-plain-body-error' },
  templateBody: { control: 'notice-template-body', error: 'notice-template-body-error' },
  audience: { control: 'notice-audience', error: 'notice-audience-error' },
  cadetClassScope: { control: 'notice-class-scope', error: 'notice-class-scope-error' },
  classIds: { control: 'notice-classes', error: 'notice-classes-error' },
  bodyMode: { control: 'notice-body-mode', error: 'notice-body-mode-error' },
} as const satisfies Record<keyof NoticeFormValues, { control: string; error: string }>;

/**
 * Why a notice could not be loaded, as the page should say it:
 * - `not_found`: it does not exist, or it is someone else's draft (the
 *   server answers both the same way). Retrying cannot help;
 * - `feature_disabled`: the school does not have notices (or the named
 *   feature) any more;
 * - `failed`: anything else, typically the network. Worth a retry.
 */
export type NoticeLoadFailure = { kind: 'not_found' } | { kind: 'feature_disabled'; feature: NonNullable<ReturnType<typeof readSchoolFeatureDisabled>> } | { kind: 'failed'; message: string };

export function noticeLoadFailure(error: unknown): NoticeLoadFailure {
  const feature = readSchoolFeatureDisabled(error);
  if (feature) return { kind: 'feature_disabled', feature };
  if ((error as { code?: unknown } | null)?.code === 'NOT_FOUND') return { kind: 'not_found' };
  return { kind: 'failed', message: noticeErrorMessage(error, 'Unable to load this notice.') };
}

/**
 * Whether a notice belongs to the session of the route it is shown under.
 * A notice opened under another session's URL (a hand-edited link, or the
 * session switched while it was open) is treated as not found there, rather
 * than shown inside the wrong session's navigation and class list.
 */
export function noticeBelongsToSession(notice: { sessionId: string }, scope: NoticeSessionScope) {
  return notice.sessionId === scope.sessionId;
}

/** Whether a failed save or publication means the notice changed underneath (CONFLICT): the stored notice is then loaded again. */
export function isNoticeConflict(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'CONFLICT';
}

/**
 * What a publisher reviewed: the notice version and the school Notice
 * template revision of the preview that was on the page when Publish was
 * pressed. Both are sent with the publication, which the server refuses
 * (CONFLICT) when either is no longer what would be published.
 */
export type PublishReview = { version: number; templateRevisionId: string | null };

/** The input of the saved notice's preview on the notice page; the publish dialog reads the same cached render. */
export function savedNoticePreviewInput(notice: { schoolId: string; id: string }) {
  return { schoolId: notice.schoolId, source: { kind: 'saved' as const, noticeId: notice.id } };
}

/**
 * What the saved notice's preview is cached under beyond its input: the
 * version the page shows. The input names the notice only, so without this
 * a render of version 1 would stand for version 2 after the draft was saved
 * elsewhere (and stay, if refreshing it failed), and the publish dialog
 * would confirm a page nobody was shown. Appended to the procedure's key,
 * so invalidating every `previewNotice` still covers it.
 */
export function savedNoticePreviewKeySuffix(notice: { version: number }) {
  return { version: notice.version } as const;
}

/**
 * The review a rendered preview stands for, or null when there is none to
 * confirm: the preview has not loaded (or failed), so the publisher has not
 * seen the notice as it would be published.
 */
export function publishReviewOf(preview: { version: number | null; templateRevisionId: string | null } | undefined): PublishReview | null {
  return preview && preview.version !== null ? { version: preview.version, templateRevisionId: preview.templateRevisionId } : null;
}

/**
 * What changed between the reviewed preview and the server's forecast for
 * the publication, or null while they agree (or the forecast has not
 * loaded). `notice`: the draft was saved again; `template`: the school's
 * Notice template was replaced, so the same text would be printed inside a
 * page nobody reviewed.
 */
export function publishReviewChange(reviewed: PublishReview, forecast: PublishReview | null): 'notice' | 'template' | null {
  if (!forecast) return null;
  if (forecast.version !== reviewed.version) return 'notice';
  return forecast.templateRevisionId === reviewed.templateRevisionId ? null : 'template';
}

/** What the publisher is told for each reason the review is no longer current. */
export const PUBLISH_REVIEW_CHANGE_MESSAGES: Record<'notice' | 'template', string> = {
  notice: 'This notice changed since you opened it. Close this dialog and review it again before publishing.',
  template: "The school's Notice template changed since you opened this notice, so it would be printed differently from the preview you read. Close this dialog and review it again before publishing.",
};

/** The DOM id of the page note that says why a draft cannot be published as addressed; the disabled Publish button is described by it. */
export const NOTICE_UNPUBLISHABLE_REASON_ID = 'notice-unpublishable-reason';

/**
 * Why a draft cannot be published as it is addressed, or null. A draft for
 * students in a school that is known not to have the Cadet Portal is
 * refused by the server; the page and the publish dialog say so and point
 * at the audience instead of offering a retry that cannot help.
 */
export function cadetAudienceUnpublishable(notice: { status: NoticeStatus; cadetScope: NoticeAudienceFacts['cadetScope'] }, availability: CadetAudienceAvailability | 'pending'): string | null {
  if (notice.status !== 'draft' || notice.cadetScope === 'none' || availability !== 'disabled') return null;
  return 'This draft is addressed to students, but the Cadet Portal is not enabled for this school. To publish it, edit it and choose Staff.';
}

/**
 * One notice read, resolved for the page: the notice it holds, or why none
 * is shown. Data already held wins over a failed refetch
 * (`resolveQueryBoundary`): only an answer that makes it untrue (not found,
 * feature switched off) replaces a notice, or an editor with typed text,
 * that is on screen. A notice of another session than the route's is not
 * found there.
 */
export type NoticeBoundaryState<T> = { kind: 'pending' } | { kind: 'unavailable'; error: unknown } | { kind: 'elsewhere' } | { kind: 'ready'; notice: T; refetchError: unknown };

export function noticeBoundaryState<T extends { sessionId: string }>(query: QueryBoundaryInput<T>, scope: NoticeSessionScope): NoticeBoundaryState<T> {
  const state = resolveQueryBoundary(query, { replaces: (error) => noticeLoadFailure(error).kind !== 'failed' });
  if (state.kind === 'pending') return state;
  if (state.kind === 'failed') return { kind: 'unavailable', error: state.error };
  return noticeBelongsToSession(state.data, scope) ? { kind: 'ready', notice: state.data, refetchError: state.refetchError } : { kind: 'elsewhere' };
}

/**
 * The newest successful render of the live preview. Renders resolve in any
 * order (each content is its own request), so a slow, older one must not
 * replace a newer one as "the last preview that worked": `sequence` is the
 * order in which the contents were typed.
 */
export type RenderedPreview = { sequence: number; html: string };

export function newestRenderedPreview(current: RenderedPreview | undefined, resolved: RenderedPreview): RenderedPreview {
  return current && current.sequence > resolved.sequence ? current : resolved;
}

/**
 * The line under the students' forecast about the PDF, or null. It is said
 * only when WhatsApp will actually send something: a school whose WhatsApp
 * channel is off, or whose students have no number, is not promised a PDF.
 */
export function whatsappPdfLine(forecast: { channels: { whatsapp: { owed: number } } } | null): string | null {
  return forecast && forecast.channels.whatsapp.owed > 0 ? 'WhatsApp messages carry the notice as a PDF.' : null;
}

/** The content and audience a save sends: the active body only, and the audience as its explicit facts. */
export function noticeSaveInput(values: NoticeFormValues) {
  return {
    title: values.title.trim(),
    bodyMode: values.bodyMode,
    body: values[activeBodyField(values.bodyMode)].trim(),
    ...noticeAudienceFacts(values),
  };
}

/** Content the live preview can render. */
export type NoticePreviewContent = { title: string; bodyMode: NoticeBodyMode; body: string };

/**
 * What the live preview renders, or null while there is nothing to render
 * yet. A missing title previews as "Untitled notice" so the author sees the
 * text take shape before naming it; an empty body has no preview.
 */
export function noticePreviewContent(values: Pick<NoticeFormValues, 'title' | 'bodyMode' | 'plainBody' | 'templateBody'>): NoticePreviewContent | null {
  const body = noticeBodySchema.safeParse(values[activeBodyField(values.bodyMode)]);
  if (!body.success) return null;
  const title = noticeTitleSchema.safeParse(values.title);
  return { title: title.success ? title.data : 'Untitled notice', bodyMode: values.bodyMode, body: body.data };
}

/** The list's filter values (one choice per filter). */
export type NoticeListFilters = { status?: NoticeStatus; audience?: 'staff' | 'cadets' };

/**
 * The API filters of a list filter selection: an audience choice asks for
 * notices that include it. A filter reads what notices store, so "Students"
 * is offered whether or not the school can address students today (notices
 * addressed to them earlier are still listed).
 */
export function noticeListApiFilters(filters: NoticeListFilters | undefined) {
  return {
    ...(filters?.status ? { status: filters.status } : {}),
    ...(filters?.audience === 'staff' ? { toStaff: true } : {}),
    ...(filters?.audience === 'cadets' ? { toCadets: true } : {}),
  };
}

type ActionNotice = { status: NoticeStatus; viewer: { canEdit: boolean; canPublish: boolean } };

/**
 * Which header actions a notice offers. The server already combines
 * lifecycle, ownership and permission into `viewer`; a published notice
 * offers only its PDF, which a draft does not have.
 */
export function noticeActionsFor(notice: ActionNotice) {
  const draft = notice.status === 'draft';
  return {
    edit: draft && notice.viewer.canEdit,
    remove: draft && notice.viewer.canEdit,
    publish: draft && notice.viewer.canPublish,
    download: notice.status === 'published',
  };
}

/** What a draft's reader is told about who sees it and who publishes it; null for a published notice. */
export function draftNotice(notice: ActionNotice) {
  if (notice.status !== 'draft') return null;
  return notice.viewer.canPublish
    ? 'This is a draft. Nobody is notified and its audience cannot see it until you publish it.'
    : 'This is a draft. A principal or manager publishes it; until then only you and they can see it, and nobody is notified.';
}

function people(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Notified 12 staff members and 310 students" for a published notice; null while the counts are unknown (a draft). */
export function publishedRecipientSummary(notice: { publishedStaffCount: number | null; publishedCadetCount: number | null } & Pick<NoticeAudienceFacts, 'toStaff' | 'cadetScope'>) {
  if (notice.publishedStaffCount === null || notice.publishedCadetCount === null) return null;
  const parts = [
    ...(notice.toStaff ? [people(notice.publishedStaffCount, 'staff member', 'staff members')] : []),
    ...(notice.cadetScope !== 'none' ? [people(notice.publishedCadetCount, 'student', 'students')] : []),
  ];
  return `Notified ${parts.join(' and ')}`;
}

/** The staff line of the publish confirmation. */
export function staffRecipientLine(count: number) {
  return `${people(count, 'staff member gets', 'staff members get')} a notification in this app.`;
}

export const NOTICE_BODY_MODE_LABELS: Record<NoticeBodyMode, string> = { plain: 'Plain text', template: 'Custom template' };

/** The audience choices the list filter offers. */
export function noticeAudienceFilterOptions(): { value: 'staff' | 'cadets'; label: string }[] {
  return [
    { value: 'staff', label: 'Staff' },
    { value: 'cadets', label: 'Students' },
  ];
}

export type { NoticeAudienceChoice };

export function noticeErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
