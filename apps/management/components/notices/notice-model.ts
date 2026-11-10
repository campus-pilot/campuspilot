import { z } from 'zod';
import {
  NOTICE_BODY_MODES,
  noticeBodySchema,
  noticeTitleSchema,
  validateNoticeAudience,
  type NoticeBodyMode,
  type NoticeStatus,
} from '@campuspilot/api/routers/school/notice/notice.dto';
import {
  NOTICE_AUDIENCE_CHOICES,
  NOTICE_CADET_CLASS_SCOPES,
  noticeAudienceFacts,
  noticeAudienceSelection,
  type NoticeAudienceChoice,
  type NoticeAudienceFacts,
} from '@campuspilot/components/notices';

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
 * What a new custom-template notice starts from: a small, complete letterhead
 * that uses every commonly needed variable, so the author edits a working
 * document instead of facing an empty editor. Notices flow over as many A4
 * pages as they need, so it sets no fixed height.
 */
export const NOTICE_TEMPLATE_STARTER = `<style>
  .notice { font: 14px/1.55 Arial, Helvetica, sans-serif; color: #1f2933; }
  .notice h1 { margin: 0; font-size: 22px; }
  .notice .meta { margin: 2mm 0 8mm; font-size: 12px; color: #52606d; }
  .notice h2 { margin: 0 0 5mm; font-size: 18px; text-align: center; }
  .notice p { margin: 0 0 4mm; }
</style>
<div class="notice">
  <h1>{{school.name}}</h1>
  <p class="meta">Session {{session.startYear}}-{{session.endYear}} · {{notice.issuedOnDisplay}}</p>
  <h2>{{notice.title}}</h2>
  <p>Write your notice here.</p>
</div>
`;

/**
 * The variables a custom notice template can read. A notice context holds
 * school, session and notice facts only (`buildNoticeContext` on the server);
 * nothing about students, staff, results or fees is reachable.
 */
export const NOTICE_TEMPLATE_VARIABLES: readonly { name: string; description: string }[] = [
  { name: '{{notice.title}}', description: 'The title above' },
  { name: '{{notice.issuedOnDisplay}}', description: 'Publication date in words, for example 15 October 2026 (today while a draft)' },
  { name: '{{notice.issuedOn}}', description: 'The same date as 2026-10-15' },
  { name: '{{school.name}}', description: 'School name' },
  { name: '{{school.location}}', description: 'School address, when set' },
  { name: '{{school.registrationNo}}', description: 'Registration number, when set' },
  { name: '{{school.logoUrl}}', description: 'School logo for an <img src>, when uploaded' },
  { name: '{{session.startYear}}', description: 'First year of the session' },
  { name: '{{session.endYear}}', description: 'Last year of the session' },
];

/**
 * The editor's values. The two bodies are separate fields, so switching
 * between plain text and a custom template never overwrites what was typed
 * in the other mode; only the active mode's body is validated and saved.
 * The audience is held as the readable choice plus the class scope
 * (`NoticeAudienceSelection`) and converted to the stored facts on save.
 */
export const noticeFormSchema = z
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
    // The server's own audience rules, on the facts this selection stores.
    validateNoticeAudience(noticeAudienceFacts(value), context);
  });

export type NoticeFormValues = z.input<typeof noticeFormSchema>;

/** The form field that holds the body of a mode. */
export function activeBodyField(bodyMode: NoticeBodyMode) {
  return bodyMode === 'plain' ? ('plainBody' as const) : ('templateBody' as const);
}

type SavedNoticeContent = NoticeAudienceFacts & { title: string; bodyMode: NoticeBodyMode; body: string };

/**
 * The editor's starting values: a saved draft, or an empty plain-text notice
 * to staff. A school without the Cadet Portal can address staff only, so a
 * draft that addressed students opens as "Staff" (`audienceNarrowed` says
 * when that happened, and the editor tells the author).
 */
export function noticeFormDefaults(notice: SavedNoticeContent | null, cadetsAvailable: boolean): NoticeFormValues {
  const saved = notice ? noticeAudienceSelection(notice) : { audience: 'staff' as const, cadetClassScope: 'all_classes' as const, classIds: [] };
  return {
    title: notice?.title ?? '',
    bodyMode: notice?.bodyMode ?? 'plain',
    plainBody: notice?.bodyMode === 'plain' ? notice.body : '',
    templateBody: notice?.bodyMode === 'template' ? notice.body : NOTICE_TEMPLATE_STARTER,
    audience: cadetsAvailable ? saved.audience : 'staff',
    cadetClassScope: saved.cadetClassScope,
    classIds: [...saved.classIds],
  };
}

/** True when a saved draft addresses students but the school can no longer address them. */
export function audienceNarrowed(notice: Pick<NoticeAudienceFacts, 'cadetScope'> | null, cadetsAvailable: boolean) {
  return !cadetsAvailable && notice !== null && notice.cadetScope !== 'none';
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

/** The API filters of a list filter selection: an audience choice asks for notices that include it. */
export function noticeListApiFilters(filters: NoticeListFilters | undefined, cadetsAvailable: boolean) {
  return {
    ...(filters?.status ? { status: filters.status } : {}),
    ...(filters?.audience === 'staff' ? { toStaff: true } : {}),
    ...(filters?.audience === 'cadets' && cadetsAvailable ? { toCadets: true } : {}),
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

/** The audience choice labels the list filter offers; students only with the Cadet Portal. */
export function noticeAudienceFilterOptions(cadetsAvailable: boolean): { value: 'staff' | 'cadets'; label: string }[] {
  return [{ value: 'staff', label: 'Staff' }, ...(cadetsAvailable ? [{ value: 'cadets' as const, label: 'Cadets' }] : [])];
}

export type { NoticeAudienceChoice };

export function noticeErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
