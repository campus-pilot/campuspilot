import { db } from '@campuspilot/db';
import { noticeClassTable, noticeTable } from '@campuspilot/db/schema/notice';
import { studentTable } from '@campuspilot/db/schema/student';
import { createRouterClient } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { connectCadetMcp, createCadetTestClient } from '../../../test/cadet';
import { createAdmissionWithLogin } from '../../../test/exam-results';
import { expectFeatureDisabled } from '../../../test/feature-flags';
import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  setTestSchoolFeature,
  type TestClient,
} from '../../../test/fixtures';
import { createCadetLogin } from '../../../test/notifications';
import { createCadetOAuthContext } from '../../cadet/context';
import { cadetRouter, type CadetRouterClient } from './cadet.router';

/**
 * Grade 6 (Asha, Bela) and Grade 7 (Chetan) in session 2026-27; Deepa is
 * enrolled without a class; Esha is enrolled in the previous session only.
 */
describe('cadet notices', () => {
  let schoolId: string, sessionId: string, pastSessionId: string, grade6: string, grade7: string;
  let principal: TestClient;
  let ashaId: string, chetanId: string;
  let asha: CadetRouterClient, bela: CadetRouterClient, chetan: CadetRouterClient, deepa: CadetRouterClient, esha: CadetRouterClient;
  const notices: Record<string, string> = {};

  const body = (overrides: Record<string, unknown> = {}) => ({
    schoolId,
    sessionId,
    title: 'Notice',
    bodyMode: 'plain' as const,
    body: 'First paragraph.\n\nSecond <b>paragraph</b>.',
    toStaff: false,
    cadetScope: 'all_classes' as const,
    classIds: [] as string[],
    ...overrides,
  });
  async function create(key: string, overrides: Record<string, unknown>, publish = true) {
    const draft = await principal.school.createNotice(body({ title: key, ...overrides }));
    if (publish) await principal.school.publishNotice({ schoolId, noticeId: draft.id });
    notices[key] = draft.id;
    return draft.id;
  }
  const titles = async (client: CadetRouterClient) => (await client.listNotices({})).items.map((item) => item.title);

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: 'Cadet Notice School', features: ['notices', 'cadet'] })).id;
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true })).id;
    pastSessionId = (await createTestSession({ schoolId, sessionStartYear: 2025, sessionEndYear: 2026 })).id;
    grade6 = (await createTestClass({ schoolId, label: 'Grade 6' })).schoolClass.id;
    grade7 = (await createTestClass({ schoolId, label: 'Grade 7' })).schoolClass.id;
    principal = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'principal' }])).session);
    const student = async (name: string, session: string, classId: string | null) => {
      const admissionId = (await createTestAdmission({ schoolId, name })).id;
      await createTestStudent({ schoolId, sessionId: session, classId, admissionId });
      return { admissionId, client: (await createCadetLogin(admissionId)).client };
    };
    ({ admissionId: ashaId, client: asha } = await student('Asha Six', sessionId, grade6));
    ({ client: bela } = await student('Bela Six', sessionId, grade6));
    ({ admissionId: chetanId, client: chetan } = await student('Chetan Seven', sessionId, grade7));
    ({ client: deepa } = await student('Deepa Unplaced', sessionId, null));
    ({ client: esha } = await student('Esha Past', pastSessionId, grade6));

    await create('All classes', { cadetScope: 'all_classes' });
    await create('Grade 6 only', { cadetScope: 'selected_classes', classIds: [grade6] });
    await create('Grade 7 only', { cadetScope: 'selected_classes', classIds: [grade7] });
    await create('Both grades and staff', { toStaff: true, cadetScope: 'selected_classes', classIds: [grade6, grade7] });
    await create('Staff only', { toStaff: true, cadetScope: 'none' });
    await create('Draft for all', { cadetScope: 'all_classes' }, false);
    await create('Past session', { sessionId: pastSessionId, cadetScope: 'all_classes' });
  });

  it('lists only published notices addressed to the student, newest first', async () => {
    expect(await titles(asha)).toEqual(['Both grades and staff', 'Grade 6 only', 'All classes']);
    expect(await titles(bela)).toEqual(['Both grades and staff', 'Grade 6 only', 'All classes']);
    expect(await titles(chetan)).toEqual(['Both grades and staff', 'Grade 7 only', 'All classes']);
    // Enrolled in the session but in no class: only what addresses every class.
    expect(await titles(deepa)).toEqual(['All classes']);
    // Enrolled in the previous session only: that session's notices, none of this one's.
    expect(await titles(esha)).toEqual(['Past session']);
    const page = await asha.listNotices({ limit: 2 });
    expect(page.items.map((item) => item.title)).toEqual(['Both grades and staff', 'Grade 6 only']);
    expect(page.pagination).toEqual({ nextCursor: '2', currentPage: 1, totalPages: 2, totalItems: 3, pageSize: 2 });
    expect((await asha.listNotices({ cursor: '2', limit: 2 })).items.map((item) => item.title)).toEqual(['All classes']);
    expect(page.items[0]).toEqual({ noticeId: notices['Both grades and staff'], title: 'Both grades and staff', publishedAt: expect.any(Date) });
    await expect(asha.listNotices({ limit: 21 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns an addressed notice rendered, escaped and with its text', async () => {
    const notice = await asha.getNotice({ noticeId: notices['Grade 6 only']! });
    expect(notice).toMatchObject({ noticeId: notices['Grade 6 only'], title: 'Grade 6 only', text: 'First paragraph.\n\nSecond <b>paragraph</b>.' });
    expect(notice.publishedAt).toBeInstanceOf(Date);
    expect(notice.html).toContain('Content-Security-Policy');
    expect(notice.html).toContain('Cadet Notice School');
    expect(notice.html).toContain('Second &lt;b&gt;paragraph&lt;/b&gt;.');
    expect(notice.html).not.toContain('<b>');
    // Nothing staff-only leaves with it.
    expect(Object.keys(notice).sort()).toEqual(['html', 'noticeId', 'publishedAt', 'text', 'title']);

    const designed = await create('Designed', { bodyMode: 'template', body: '<h1 class="own">{{notice.title}}</h1><script>bad()</script>', cadetScope: 'all_classes' });
    const rendered = await asha.getNotice({ noticeId: designed });
    expect(rendered.text).toBeNull();
    expect(rendered.html).toContain('<h1 class="own">Designed</h1>');
    expect(rendered.html).not.toContain('<script');
  });

  it('answers NOT_FOUND for every notice not addressed to the student, exactly like an unknown one', async () => {
    const refused: Array<[CadetRouterClient, string]> = [
      [asha, notices['Grade 7 only']!],
      [chetan, notices['Grade 6 only']!],
      [deepa, notices['Grade 6 only']!],
      [asha, notices['Staff only']!],
      [asha, notices['Draft for all']!],
      [asha, notices['Past session']!],
      [esha, notices['All classes']!],
      [asha, 'ntc_unknownunknownunknown'],
    ];
    for (const [client, noticeId] of refused) {
      await expect(client.getNotice({ noticeId }), noticeId).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Notice was not found.' });
      await expect(client.getNoticeDownload({ noticeId }), noticeId).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(asha.getNotice({ noticeId: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // Another school's notice, even one addressed to all of its classes, does not exist here.
    const other = await createTestSchool({ features: ['notices', 'cadet'] });
    const otherSession = (await createTestSession({ schoolId: other.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
    const otherPrincipal = createTestClient((await createSchoolStaffSession(other.id, [{ role: 'principal' }])).session);
    const theirs = await otherPrincipal.school.createNotice({ ...body(), schoolId: other.id, sessionId: otherSession });
    await otherPrincipal.school.publishNotice({ schoolId: other.id, noticeId: theirs.id });
    await expect(asha.getNotice({ noticeId: theirs.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Not even with a forged class row pointing at the student's class from the other school's notice.
    await db.update(noticeTable).set({ cadetScope: 'selected_classes' }).where(eq(noticeTable.id, theirs.id));
    await db.insert(noticeClassTable).values({ noticeId: theirs.id, classId: grade6, schoolId: other.id });
    await expect(asha.getNotice({ noticeId: theirs.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await titles(asha)).not.toContain('Notice');
  });

  it('follows the student\'s current class: a moved student sees the new class\'s notices and loses the old one\'s', async () => {
    const mover = (await createTestAdmission({ schoolId, name: 'Mohan Mover' })).id;
    const enrollment = await createTestStudent({ schoolId, sessionId, classId: grade6, admissionId: mover });
    const client = (await createCadetLogin(mover)).client;
    expect(await titles(client)).toContain('Grade 6 only');
    await db.update(studentTable).set({ classId: grade7 }).where(and(eq(studentTable.id, enrollment.id), eq(studentTable.schoolId, schoolId)));
    const after = await titles(client);
    expect(after).toContain('Grade 7 only');
    expect(after).not.toContain('Grade 6 only');
    await expect(client.getNotice({ noticeId: notices['Grade 6 only']! })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('downloads the same cached PDF the staff download', async () => {
    const noticeId = notices['Grade 6 only']!;
    const download = await asha.getNoticeDownload({ noticeId });
    expect(download.expiresIn).toBe(300);
    const cadetBytes = Buffer.from(await (await fetch(download.url)).arrayBuffer());
    expect((await PDFDocument.load(new Uint8Array(cadetBytes))).getPageCount()).toBe(1);
    const staff = await principal.school.getNoticeDownload({ schoolId, noticeId });
    const staffBytes = Buffer.from(await (await fetch(staff.url)).arrayBuffer());
    expect(staffBytes.equals(cadetBytes)).toBe(true);
  });

  it('needs a cadet sign-in: anonymous callers are refused and inputs can never name a student or a school', async () => {
    const anonymous = createCadetTestClient(new Headers());
    await expect(anonymous.listNotices({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anonymous.getNotice({ noticeId: notices['All classes']! })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anonymous.getNoticeDownload({ noticeId: notices['All classes']! })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    // Identity fields in the input are ignored: Chetan still gets his own list, never Asha's.
    const forged = await chetan.listNotices({ admissionId: ashaId, schoolId: 'other' } as never);
    expect(forged.items.map((item) => item.title)).toEqual(await titles(chetan));
    expect(chetanId).not.toBe(ashaId);
  });

  it('is refused while the school has no notices feature, and while it has no Cadet Portal', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    const session = (await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
    const admissionId = (await createTestAdmission({ schoolId: school.id })).id;
    await createTestStudent({ schoolId: school.id, sessionId: session, admissionId });
    const client = (await createCadetLogin(admissionId)).client;
    await expectFeatureDisabled(client.listNotices({}), 'notices');
    await expectFeatureDisabled(client.getNotice({ noticeId: 'ntc_any' }), 'notices');
    await expectFeatureDisabled(client.getNoticeDownload({ noticeId: 'ntc_any' }), 'notices');
    await setTestSchoolFeature(school.id, 'notices', true);
    await expect(client.listNotices({})).resolves.toMatchObject({ items: [] });
    await setTestSchoolFeature(school.id, 'cadet', false);
    await expectFeatureDisabled(client.listNotices({}), 'cadet');
  });

  it('lets a connected AI app read the notices addressed to its student, with read-only tool metadata', async () => {
    const login = await createAdmissionWithLogin(principal, schoolId, 'Gita Connected');
    const { claims } = await connectCadetMcp(login.credentials);
    const context = await createCadetOAuthContext({
      headers: new Headers(),
      userId: claims.userId,
      oauthGrant: { clientId: claims.clientId, scopes: claims.scopes, grantId: 'grant' },
    });
    const connected = createRouterClient(cadetRouter, { context: context! });
    // Not enrolled in any session yet: nothing is addressed to this student.
    await expect(connected.listNotices({})).resolves.toMatchObject({ items: [] });
    await expect(connected.getNotice({ noticeId: notices['All classes']! })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await createTestStudent({ schoolId, sessionId, classId: grade7, admissionId: login.admission.id });
    expect((await connected.listNotices({})).items.map((item) => item.title)).toEqual(expect.arrayContaining(['Grade 7 only', 'All classes']));
    await expect(connected.getNotice({ noticeId: notices['Grade 7 only']! })).resolves.toMatchObject({ title: 'Grade 7 only' });
    await expect(connected.getNotice({ noticeId: notices['Grade 6 only']! })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(cadetRouter.listNotices['~orpc'].meta.mcp).toEqual({ exposure: 'core', access: 'read', destructive: false, module: 'notices' });
    expect(cadetRouter.getNotice['~orpc'].meta.mcp).toEqual({ exposure: 'core', access: 'read', destructive: false, module: 'notices' });
    expect(cadetRouter.getNoticeDownload['~orpc'].meta.mcp).toEqual({ exposure: 'hidden', access: 'read', destructive: false, module: 'notices' });
  });
});
