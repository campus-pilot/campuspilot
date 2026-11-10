import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  NOTICE_TEMPLATE_STARTER,
  NOTICE_FIELD_IDS,
  cadetAudienceAvailability,
  cadetAudienceBlock,
  cadetAudienceNote,
  firstInvalidNoticeField,
  isNoticeConflict,
  noticeAudienceChoicesFor,
  noticeBelongsToSession,
  noticeFormSchemaFor,
  noticeLoadFailure,
  PUBLISH_REVIEW_CHANGE_MESSAGES,
  cadetAudienceUnpublishable,
  newestRenderedPreview,
  noticeBoundaryState,
  publishReviewChange,
  publishReviewOf,
  savedNoticePreviewInput,
  savedNoticePreviewKeySuffix,
  whatsappPdfLine,
  draftNotice,
  editNoticeHref,
  newNoticeHref,
  noticeActionsFor,
  noticeAudienceFilterOptions,
  noticeFormDefaults,
  noticeFormSchema,
  noticeListApiFilters,
  noticePreviewContent,
  noticeSaveInput,
  noticePrintSizeDescription,
  noticesHref,
  publishedRecipientSummary,
  staffRecipientLine,
  type NoticeFormValues,
} from './notice-model';
import { NoticePrintSize } from './notice-print-size';

const scope = { schoolId: 'sch 1', sessionId: 'ses_1' };

function values(overrides: Partial<NoticeFormValues> = {}): NoticeFormValues {
  return { ...noticeFormDefaults(null), title: 'Sports day', plainBody: 'Come at 8.', ...overrides };
}

function issues(value: NoticeFormValues) {
  const result = noticeFormSchema.safeParse(value);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
}

test('notice routes are built under the session and encode their parts', () => {
  assert.equal(noticesHref(scope), '/school/sch%201/sessions/ses_1/notices');
  assert.equal(newNoticeHref(scope), '/school/sch%201/sessions/ses_1/notices/new');
  assert.equal(editNoticeHref(scope, 'ntc/1'), '/school/sch%201/sessions/ses_1/notices/ntc%2F1/edit');
});

test('a new notice starts as plain text to staff, with the template starter kept for the advanced mode', () => {
  assert.deepEqual(noticeFormDefaults(null), {
    title: '',
    bodyMode: 'plain',
    pageSize: 'full',
    plainBody: '',
    templateBody: NOTICE_TEMPLATE_STARTER,
    audience: 'staff',
    cadetClassScope: 'all_classes',
    classIds: [],
  });
});

test('a saved draft opens with its own body in its own mode and its stored audience', () => {
  const draft = { title: 'Fee reminder', bodyMode: 'template' as const, body: '<p>{{notice.title}}</p>', pageSize: 'half' as const, toStaff: false, cadetScope: 'selected_classes' as const, classIds: ['c1', 'c2'] };
  const form = noticeFormDefaults(draft);
  assert.equal(form.templateBody, '<p>{{notice.title}}</p>');
  assert.equal(form.plainBody, '');
  assert.equal(form.audience, 'cadets');
  assert.equal(form.cadetClassScope, 'selected_classes');
  assert.deepEqual(form.classIds, ['c1', 'c2']);
  // Its print size is kept and sent back as it is.
  assert.equal(form.pageSize, 'half');
  assert.deepEqual(noticeSaveInput(form), draft);
});

test('opening a draft never rewrites its stored audience, whatever the school can address today (review U2)', () => {
  const cadetsOnly = { title: 'Fee reminder', bodyMode: 'plain' as const, body: 'Pay by Friday.', pageSize: 'full' as const, toStaff: false, cadetScope: 'all_classes' as const, classIds: [] };
  const form = noticeFormDefaults(cadetsOnly);
  assert.equal(form.audience, 'cadets');
  // Saved unchanged, the stored facts are sent back as they were: never "to staff".
  assert.deepEqual(noticeSaveInput(form), cadetsOnly);
  // The choices on offer always include the stored one, so it is shown as it is.
  assert.deepEqual(noticeAudienceChoicesFor('disabled', cadetsOnly), ['staff', 'cadets']);
  assert.deepEqual(noticeAudienceChoicesFor('unknown', cadetsOnly), ['staff', 'cadets']);
  assert.deepEqual(noticeAudienceChoicesFor('available', cadetsOnly), ['staff', 'cadets', 'staff_and_cadets']);
  assert.deepEqual(noticeAudienceChoicesFor('disabled', null), ['staff']);
});

test('feature off and could-not-load are different facts with different words', () => {
  assert.equal(cadetAudienceAvailability({ enabled: true, status: 'ready' }), 'available');
  assert.equal(cadetAudienceAvailability({ enabled: false, status: 'ready' }), 'disabled');
  assert.equal(cadetAudienceAvailability({ enabled: false, status: 'unknown' }), 'unknown');

  assert.equal(cadetAudienceNote('available', 'cadets'), null);
  assert.equal(cadetAudienceNote('disabled', 'staff'), null);
  assert.equal(cadetAudienceNote('disabled', null), null);
  const off = cadetAudienceNote('disabled', 'staff_and_cadets');
  assert.match(off!.text, /not enabled for this school/);
  assert.match(off!.text, /stays as it is until you change it/);
  assert.equal(off!.retry, false);
  const unknownDraft = cadetAudienceNote('unknown', 'cadets');
  assert.match(unknownDraft!.text, /could not check/);
  assert.doesNotMatch(unknownDraft!.text, /not enabled/);
  assert.equal(unknownDraft!.retry, true);
  assert.deepEqual(cadetAudienceNote('unknown', null), { text: 'We could not check whether this school has the Cadet Portal, so only Staff can be chosen for now.', retry: true });
});

test('a student audience the school cannot address is blocked on the audience field with the reason, and staff is never blocked', () => {
  const cadets = values({ audience: 'cadets' });
  assert.deepEqual(Object.keys(issues(cadets)), []);
  const blockedBy = (availability: 'disabled' | 'unknown', value: NoticeFormValues) => {
    const result = noticeFormSchemaFor(() => availability).safeParse(value);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
  };
  assert.match(blockedBy('disabled', cadets).audience!, /not enabled for this school/);
  assert.match(blockedBy('unknown', values({ audience: 'staff_and_cadets' })).audience!, /could not check/);
  assert.deepEqual(blockedBy('disabled', values({ audience: 'staff' })), {});
  assert.deepEqual(blockedBy('unknown', values({ audience: 'staff' })), {});
  assert.equal(cadetAudienceBlock('cadets', 'available'), null);
  // The availability is read when the form is submitted, so a flag that changes while the editor is open applies.
  let availability: 'available' | 'disabled' = 'disabled';
  const schema = noticeFormSchemaFor(() => availability);
  assert.equal(schema.safeParse(cadets).success, false);
  availability = 'available';
  assert.equal(schema.safeParse(cadets).success, true);
});

test('focus goes to the first invalid field in screen order', () => {
  assert.equal(firstInvalidNoticeField({ classIds: ['x'], title: ['Enter a title.'] }, 'plain'), 'title');
  assert.equal(firstInvalidNoticeField({ plainBody: ['Enter the notice text.'], audience: ['x'] }, 'plain'), 'plainBody');
  assert.equal(firstInvalidNoticeField({ templateBody: ['Add the template HTML.'], plainBody: ['ignored'] }, 'template'), 'templateBody');
  assert.equal(firstInvalidNoticeField({ title: [], classIds: ['Choose at least one class.'] }, 'plain'), 'classIds');
  assert.equal(firstInvalidNoticeField({}, 'plain'), null);
  // Every field has a control to focus and an error element to describe it.
  for (const ids of Object.values(NOTICE_FIELD_IDS)) assert.notEqual(ids.control, ids.error);
});

test('a notice that could not be loaded is described as what happened (review U5)', () => {
  assert.deepEqual(noticeLoadFailure({ code: 'NOT_FOUND', message: 'Notice was not found.' }), { kind: 'not_found' });
  assert.deepEqual(noticeLoadFailure({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'notices' } }), { kind: 'feature_disabled', feature: 'notices' });
  assert.deepEqual(noticeLoadFailure(new Error('Failed to fetch')), { kind: 'failed', message: 'Failed to fetch' });
  assert.deepEqual(noticeLoadFailure({ code: 'FORBIDDEN' }), { kind: 'failed', message: 'Unable to load this notice.' });
});

test('a notice is shown only under its own session (review U4)', () => {
  assert.equal(noticeBelongsToSession({ sessionId: 'ses_1' }, scope), true);
  assert.equal(noticeBelongsToSession({ sessionId: 'ses_2' }, scope), false);
});

test('publishing is offered only for the preview that was read: its version and its template revision (review B3, R2B3)', () => {
  // The review is what the rendered preview on the page says it rendered.
  assert.deepEqual(publishReviewOf({ version: 3, templateRevisionId: 'art_1' }), { version: 3, templateRevisionId: 'art_1' });
  assert.deepEqual(publishReviewOf({ version: 3, templateRevisionId: null }), { version: 3, templateRevisionId: null });
  // No preview on the page, or one of unsaved text: nothing has been reviewed.
  assert.equal(publishReviewOf(undefined), null);
  assert.equal(publishReviewOf({ version: null, templateRevisionId: null }), null);
  assert.deepEqual(savedNoticePreviewInput({ schoolId: 'sch_1', id: 'ntc_1' }), { schoolId: 'sch_1', source: { kind: 'saved', noticeId: 'ntc_1' } });

  const reviewed = { version: 3, templateRevisionId: 'art_1' };
  assert.equal(publishReviewChange(reviewed, null), null);
  assert.equal(publishReviewChange(reviewed, { version: 3, templateRevisionId: 'art_1' }), null);
  assert.equal(publishReviewChange(reviewed, { version: 4, templateRevisionId: 'art_1' }), 'notice');
  // The same notice inside another template is a change too, in both directions of "no template".
  assert.equal(publishReviewChange(reviewed, { version: 3, templateRevisionId: 'art_2' }), 'template');
  assert.equal(publishReviewChange(reviewed, { version: 3, templateRevisionId: null }), 'template');
  assert.equal(publishReviewChange({ version: 3, templateRevisionId: null }, { version: 3, templateRevisionId: 'art_2' }), 'template');
  assert.equal(publishReviewChange({ version: 3, templateRevisionId: null }, { version: 3, templateRevisionId: null }), null);
  assert.match(PUBLISH_REVIEW_CHANGE_MESSAGES.template, /Notice template changed/);
  assert.match(PUBLISH_REVIEW_CHANGE_MESSAGES.notice, /notice changed/);

  assert.equal(isNoticeConflict({ code: 'CONFLICT' }), true);
  assert.equal(isNoticeConflict({ code: 'BAD_REQUEST' }), false);
  assert.equal(isNoticeConflict(null), false);
});

test('the saved preview is cached per version, so an older render never stands for the version shown (review R3U3)', () => {
  assert.notDeepEqual(savedNoticePreviewKeySuffix({ version: 1 }), savedNoticePreviewKeySuffix({ version: 2 }));
  assert.deepEqual(savedNoticePreviewKeySuffix({ version: 2 }), { version: 2 });
});

test('a loaded notice survives a failed refetch; only "gone" or "feature off" replaces it (review R2U1)', () => {
  const notice = { sessionId: scope.sessionId, title: 'Draft' };
  const network = new Error('Failed to fetch');
  const notFound = Object.assign(new Error('Notice was not found.'), { code: 'NOT_FOUND' });
  const featureOff = { code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'notices' } };

  assert.deepEqual(noticeBoundaryState({ data: undefined, error: null }, scope), { kind: 'pending' });
  assert.deepEqual(noticeBoundaryState({ data: undefined, error: network }, scope), { kind: 'unavailable', error: network });
  assert.deepEqual(noticeBoundaryState({ data: notice, error: null }, scope), { kind: 'ready', notice, refetchError: null });
  // The defect: one failed request on returning to the tab unmounted the editor and discarded the typed text.
  // The failed refresh is reported beside the held notice, for the page's quiet note (review R3U3).
  assert.deepEqual(noticeBoundaryState({ data: notice, error: network }, scope), { kind: 'ready', notice, refetchError: network });
  assert.deepEqual(noticeBoundaryState({ data: notice, error: { code: 'INTERNAL_SERVER_ERROR' } }, scope), { kind: 'ready', notice, refetchError: { code: 'INTERNAL_SERVER_ERROR' } });
  // Answers that make the held notice untrue still replace it.
  assert.deepEqual(noticeBoundaryState({ data: notice, error: notFound }, scope), { kind: 'unavailable', error: notFound });
  assert.deepEqual(noticeBoundaryState({ data: notice, error: featureOff }, scope), { kind: 'unavailable', error: featureOff });
  // Another session's notice is not shown under this route, loaded or not.
  assert.deepEqual(noticeBoundaryState({ data: { ...notice, sessionId: 'ses_other' }, error: null }, scope), { kind: 'elsewhere' });
});

test('a draft for cadets in a school without the portal says why it cannot be published (review R2U2)', () => {
  const draft = { status: 'draft' as const, cadetScope: 'all_classes' as const };
  assert.match(cadetAudienceUnpublishable(draft, 'disabled') ?? '', /Cadet Portal is not enabled/);
  // Not when the portal is there, not when nobody knows, and not for other notices.
  assert.equal(cadetAudienceUnpublishable(draft, 'available'), null);
  assert.equal(cadetAudienceUnpublishable(draft, 'unknown'), null);
  assert.equal(cadetAudienceUnpublishable(draft, 'pending'), null);
  assert.equal(cadetAudienceUnpublishable({ status: 'draft', cadetScope: 'none' }, 'disabled'), null);
  assert.equal(cadetAudienceUnpublishable({ status: 'published', cadetScope: 'all_classes' }, 'disabled'), null);
});

test('the last preview that worked is the newest content, whatever order the renders resolve in (review R2U5)', () => {
  const a = { sequence: 1, html: 'A' };
  const b = { sequence: 2, html: 'B' };
  assert.deepEqual(newestRenderedPreview(undefined, a), a);
  assert.deepEqual(newestRenderedPreview(a, b), b);
  // A slow render of older content resolves after a newer one: the newer stays.
  assert.deepEqual(newestRenderedPreview(b, a), b);
  // The same content rendered again replaces itself.
  assert.deepEqual(newestRenderedPreview(b, { sequence: 2, html: 'B2' }), { sequence: 2, html: 'B2' });
});

test('the PDF line is said only when WhatsApp will send something (review U7)', () => {
  const forecast = (owed: number) => ({ channels: { whatsapp: { owed } } });
  assert.equal(whatsappPdfLine(forecast(12)), 'WhatsApp messages carry the notice as a PDF.');
  assert.equal(whatsappPdfLine(forecast(0)), null);
  assert.equal(whatsappPdfLine(null), null);
});

test('saving sends only the active body, trimmed, and the audience as explicit facts', () => {
  assert.deepEqual(noticeSaveInput(values({ title: '  Sports day ', plainBody: ' Come at 8.\n', audience: 'staff_and_cadets', cadetClassScope: 'selected_classes', classIds: ['c1'] })), {
    title: 'Sports day',
    bodyMode: 'plain',
    body: 'Come at 8.',
    pageSize: 'full',
    toStaff: true,
    cadetScope: 'selected_classes',
    classIds: ['c1'],
  });
  // A class selection remembered from an earlier choice is not sent for "Staff".
  assert.deepEqual(noticeSaveInput(values({ audience: 'staff', cadetClassScope: 'selected_classes', classIds: ['c1'] })).classIds, []);
  assert.equal(noticeSaveInput(values({ bodyMode: 'template', templateBody: '<p>Hi</p>' })).body, '<p>Hi</p>');
});

test('validation reports each problem on the field that shows it', () => {
  assert.deepEqual(issues(values()), {});
  assert.deepEqual(issues(values({ title: '  ' })), { title: 'Enter a title.' });
  assert.deepEqual(issues(values({ plainBody: '' })), { plainBody: 'Enter the notice text.' });
  assert.deepEqual(issues(values({ bodyMode: 'template', templateBody: ' ' })), { templateBody: 'Add the template HTML.' });
  assert.deepEqual(issues(values({ audience: 'cadets', cadetClassScope: 'selected_classes' })), { classIds: 'Choose at least one class.' });
});

test('only the active mode is validated, and remembered classes do not block another audience', () => {
  assert.deepEqual(issues(values({ bodyMode: 'plain', templateBody: '' })), {});
  assert.deepEqual(issues(values({ bodyMode: 'template', plainBody: '' })), {});
  assert.deepEqual(issues(values({ audience: 'staff', cadetClassScope: 'selected_classes', classIds: [] })), {});
  assert.deepEqual(issues(values({ audience: 'cadets', cadetClassScope: 'all_classes', classIds: ['c1'] })), {});
});

test('the live preview needs a body and names an untitled notice', () => {
  assert.equal(noticePreviewContent(values({ plainBody: '   ' })), null);
  assert.deepEqual(noticePreviewContent(values({ title: '' })), { title: 'Untitled notice', bodyMode: 'plain', body: 'Come at 8.', pageSize: 'full' });
  assert.deepEqual(noticePreviewContent(values({ bodyMode: 'template', templateBody: '<p>x</p>' })), { title: 'Sports day', bodyMode: 'template', body: '<p>x</p>', pageSize: 'full' });
  // The preview is laid out at the chosen size, for plain text as for a custom template.
  assert.equal(noticePreviewContent(values({ pageSize: 'half' }))?.pageSize, 'half');
});

test('list filters map one choice per filter onto the API filters', () => {
  assert.deepEqual(noticeListApiFilters(undefined), {});
  assert.deepEqual(noticeListApiFilters({ status: 'draft', audience: 'staff' }), { status: 'draft', toStaff: true });
  assert.deepEqual(noticeListApiFilters({ audience: 'cadets' }), { toCadets: true });
  // Filtering reads stored audiences; it does not depend on what the school can address today.
  assert.deepEqual(noticeAudienceFilterOptions().map(({ value }) => value), ['staff', 'cadets']);
});

test('header actions follow the lifecycle and what the server allows this viewer', () => {
  const draft = (canEdit: boolean, canPublish: boolean) => ({ status: 'draft' as const, viewer: { canEdit, canPublish } });
  assert.deepEqual(noticeActionsFor(draft(true, false)), { edit: true, remove: true, publish: false, download: false });
  assert.deepEqual(noticeActionsFor(draft(true, true)), { edit: true, remove: true, publish: true, download: false });
  assert.deepEqual(noticeActionsFor(draft(false, false)), { edit: false, remove: false, publish: false, download: false });
  // A published notice is immutable whatever the viewer flags say.
  assert.deepEqual(noticeActionsFor({ status: 'published', viewer: { canEdit: true, canPublish: true } }), { edit: false, remove: false, publish: false, download: true });
});

test('a draft author who cannot publish is told who does', () => {
  assert.match(draftNotice({ status: 'draft', viewer: { canEdit: true, canPublish: false } }) ?? '', /A principal or manager publishes it/);
  assert.match(draftNotice({ status: 'draft', viewer: { canEdit: true, canPublish: true } }) ?? '', /until you publish it/);
  assert.equal(draftNotice({ status: 'published', viewer: { canEdit: false, canPublish: false } }), null);
});

test('recipient summaries name only the audiences the notice addresses', () => {
  assert.equal(publishedRecipientSummary({ toStaff: true, cadetScope: 'none', publishedStaffCount: 1, publishedCadetCount: 0 }), 'Notified 1 staff member');
  assert.equal(publishedRecipientSummary({ toStaff: true, cadetScope: 'all_classes', publishedStaffCount: 12, publishedCadetCount: 310 }), 'Notified 12 staff members and 310 students');
  assert.equal(publishedRecipientSummary({ toStaff: false, cadetScope: 'selected_classes', publishedStaffCount: 0, publishedCadetCount: 1 }), 'Notified 1 student');
  assert.equal(publishedRecipientSummary({ toStaff: true, cadetScope: 'none', publishedStaffCount: null, publishedCadetCount: null }), null);
  assert.equal(staffRecipientLine(1), '1 staff member gets a notification in this app.');
  assert.equal(staffRecipientLine(4), '4 staff members get a notification in this app.');
});

test('says how each print size comes out of the printer', () => {
  assert.match(noticePrintSizeDescription('half'), /two copies/);
  assert.match(noticePrintSizeDescription('half'), /continues/);
  assert.match(noticePrintSizeDescription('full'), /^Full A4/);
});

test('the notice page states the print size and how it prints as visible text, not a tooltip', () => {
  const half = renderToStaticMarkup(createElement(NoticePrintSize, { pageSize: 'half' }));
  assert.ok(half.includes(noticePrintSizeDescription('half')));
  assert.doesNotMatch(half, /title=/);
  assert.ok(renderToStaticMarkup(createElement(NoticePrintSize, { pageSize: 'full' })).includes(noticePrintSizeDescription('full')));
});
