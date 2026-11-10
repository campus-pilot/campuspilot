import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NOTICE_TEMPLATE_STARTER,
  audienceNarrowed,
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
  noticesHref,
  publishedRecipientSummary,
  staffRecipientLine,
  type NoticeFormValues,
} from './notice-model';

const scope = { schoolId: 'sch 1', sessionId: 'ses_1' };

function values(overrides: Partial<NoticeFormValues> = {}): NoticeFormValues {
  return { ...noticeFormDefaults(null, true), title: 'Sports day', plainBody: 'Come at 8.', ...overrides };
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
  assert.deepEqual(noticeFormDefaults(null, true), {
    title: '',
    bodyMode: 'plain',
    plainBody: '',
    templateBody: NOTICE_TEMPLATE_STARTER,
    audience: 'staff',
    cadetClassScope: 'all_classes',
    classIds: [],
  });
});

test('a saved draft opens with its own body in its own mode and its stored audience', () => {
  const draft = { title: 'Fee reminder', bodyMode: 'template' as const, body: '<p>{{notice.title}}</p>', toStaff: false, cadetScope: 'selected_classes' as const, classIds: ['c1', 'c2'] };
  const form = noticeFormDefaults(draft, true);
  assert.equal(form.templateBody, '<p>{{notice.title}}</p>');
  assert.equal(form.plainBody, '');
  assert.equal(form.audience, 'cadets');
  assert.equal(form.cadetClassScope, 'selected_classes');
  assert.deepEqual(form.classIds, ['c1', 'c2']);
  assert.deepEqual(noticeSaveInput(form), draft);
});

test('without the Cadet Portal a draft to students opens as Staff and says so', () => {
  const draft = { title: 'T', bodyMode: 'plain' as const, body: 'B', toStaff: false, cadetScope: 'all_classes' as const, classIds: [] };
  assert.equal(noticeFormDefaults(draft, false).audience, 'staff');
  assert.equal(audienceNarrowed(draft, false), true);
  assert.equal(audienceNarrowed(draft, true), false);
  assert.equal(audienceNarrowed({ cadetScope: 'none' }, false), false);
  assert.equal(audienceNarrowed(null, false), false);
});

test('saving sends only the active body, trimmed, and the audience as explicit facts', () => {
  assert.deepEqual(noticeSaveInput(values({ title: '  Sports day ', plainBody: ' Come at 8.\n', audience: 'staff_and_cadets', cadetClassScope: 'selected_classes', classIds: ['c1'] })), {
    title: 'Sports day',
    bodyMode: 'plain',
    body: 'Come at 8.',
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
  assert.deepEqual(noticePreviewContent(values({ title: '' })), { title: 'Untitled notice', bodyMode: 'plain', body: 'Come at 8.' });
  assert.deepEqual(noticePreviewContent(values({ bodyMode: 'template', templateBody: '<p>x</p>' })), { title: 'Sports day', bodyMode: 'template', body: '<p>x</p>' });
});

test('list filters map one choice per filter onto the API filters', () => {
  assert.deepEqual(noticeListApiFilters(undefined, true), {});
  assert.deepEqual(noticeListApiFilters({ status: 'draft', audience: 'staff' }, true), { status: 'draft', toStaff: true });
  assert.deepEqual(noticeListApiFilters({ audience: 'cadets' }, true), { toCadets: true });
  assert.deepEqual(noticeListApiFilters({ audience: 'cadets' }, false), {});
  assert.deepEqual(noticeAudienceFilterOptions(false).map(({ value }) => value), ['staff']);
  assert.deepEqual(noticeAudienceFilterOptions(true).map(({ value }) => value), ['staff', 'cadets']);
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
