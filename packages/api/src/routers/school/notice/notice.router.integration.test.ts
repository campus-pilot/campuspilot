import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { noticeClassTable, noticeTable } from '@campuspilot/db/schema/notice';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, eq, like } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { readPdfPageDrawing } from '../../../../test/pdf-placements';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  setTestSchoolFeature,
  type TestClient,
} from '../../../../test/fixtures';
import { noticePdfKey } from './notice.render';

/**
 * One school with notices and the Cadet Portal: two classes (two registered
 * students in Grade 6, one in Grade 7), an enrolled student without a class
 * and an unregistered one; a principal, a manager, two teachers and an
 * accountant.
 */
describe('school notices', () => {
  let schoolId: string, sessionId: string, grade6: string, grade7: string;
  let principal: TestClient, manager: TestClient, teacher: TestClient, otherTeacher: TestClient, accountant: TestClient, examCoordinator: TestClient;
  let principalId: string, teacherId: string;
  let staffCount: number;

  const plain = (overrides: Record<string, unknown> = {}) => ({
    schoolId,
    sessionId,
    title: 'Sports Day',
    bodyMode: 'plain' as const,
    body: 'The Annual Sports Day is on Saturday.\n\nPlease be seated by 8:30 AM.',
    toStaff: true,
    cadetScope: 'none' as const,
    classIds: [] as string[],
    // updateNotice requires it (a full replacement); createNotice would default it.
    pageSize: 'full' as const,
    ...overrides,
  });
  const eventsOf = (noticeId: string) =>
    db
      .select()
      .from(notificationEventTable)
      .where(and(eq(notificationEventTable.schoolId, schoolId), like(notificationEventTable.key, `notice%:${noticeId}%`)));

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: 'Notice School', features: ['notices', 'cadet'] })).id;
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true })).id;
    grade6 = (await createTestClass({ schoolId, label: 'Grade 6' })).schoolClass.id;
    grade7 = (await createTestClass({ schoolId, label: 'Grade 7' })).schoolClass.id;
    const enroll = async (name: string, classId: string | null, registered = true) => {
      const admissionId = (await createTestAdmission({ schoolId, name, registered })).id;
      await createTestStudent({ schoolId, sessionId, classId, admissionId });
      return admissionId;
    };
    await enroll('Asha Six', grade6);
    await enroll('Bela Six', grade6);
    await enroll('Chetan Seven', grade7);
    await enroll('Deepa Unplaced', null);
    await enroll('Esha Left', grade6, false);
    // Enrolled in another session only: never addressed by this session's notices.
    const otherSession = (await createTestSession({ schoolId, sessionStartYear: 2025, sessionEndYear: 2026 })).id;
    await createTestStudent({ schoolId, sessionId: otherSession, classId: grade6, admissionId: (await createTestAdmission({ schoolId, name: 'Farah Past' })).id });

    const principalSession = await createSchoolStaffSession(schoolId, [{ role: 'principal' }]);
    principal = createTestClient(principalSession.session);
    principalId = principalSession.user.id;
    manager = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'manager' }])).session);
    const teacherSession = await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [grade6] } }]);
    teacher = createTestClient(teacherSession.session);
    teacherId = teacherSession.user.id;
    otherTeacher = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [grade7] } }])).session);
    accountant = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'accountant' }])).session);
    examCoordinator = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'exam_coordinator' }])).session);
    staffCount = 6;
  });

  describe('authentication, authorization and the feature gate', () => {
    it('rejects anonymous callers on every procedure', async () => {
      const anonymous = createTestClient(null);
      const scope = { schoolId, noticeId: 'ntc_missing' };
      for (const call of [
        () => anonymous.school.listNotices({ schoolId, sessionId }),
        () => anonymous.school.getNotice(scope),
        () => anonymous.school.createNotice(plain()),
        () => anonymous.school.updateNotice({ ...plain(), noticeId: 'ntc_missing', expectedVersion: 1 }),
        () => anonymous.school.deleteNotice(scope),
        () => anonymous.school.previewNotice({ schoolId, source: { kind: 'saved', noticeId: 'ntc_missing' } }),
        () => anonymous.school.previewNoticePublish(scope),
        () => anonymous.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null }),
        () => anonymous.school.getNoticeDownload(scope),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      }
    });

    it('rejects users without a role in the school, including staff of another school and platform administrators', async () => {
      const other = await createTestSchool({ features: ['notices', 'cadet'] });
      const outsiders = [
        createTestClient((await createSchoolStaffSession(other.id, [{ role: 'principal' }])).session),
        createTestClient(await createRegularUserSession()),
        createTestClient(await createAdminSession()),
      ];
      const draft = await principal.school.createNotice(plain());
      for (const outsider of outsiders) {
        await expectPermissionDenied(outsider.school.listNotices({ schoolId, sessionId }));
        await expectPermissionDenied(outsider.school.getNotice({ schoolId, noticeId: draft.id }));
        await expectPermissionDenied(outsider.school.createNotice(plain()));
        await expectPermissionDenied(outsider.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null }));
        await expectPermissionDenied(outsider.school.getNoticeDownload({ schoolId, noticeId: draft.id }));
      }
    });

    it('lets every staff role read and draft, and only principal and manager publish', async () => {
      for (const client of [principal, manager, teacher, accountant, examCoordinator]) {
        const draft = await client.school.createNotice(plain());
        await expect(client.school.getNotice({ schoolId, noticeId: draft.id })).resolves.toMatchObject({ id: draft.id, status: 'draft' });
        await expect(client.school.listNotices({ schoolId, sessionId })).resolves.toMatchObject({ pagination: { currentPage: 1 } });
      }
      const draft = await teacher.school.createNotice(plain());
      for (const client of [teacher, accountant, examCoordinator]) {
        await expectPermissionDenied(client.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null }));
        await expectPermissionDenied(client.school.previewNoticePublish({ schoolId, noticeId: draft.id }));
      }
      await expect(manager.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null })).resolves.toMatchObject({ status: 'published' });
    });

    it('refuses every procedure while the school has no notices feature, after the permission check, and writes nothing', async () => {
      const off = await createTestSchool();
      const offSession = (await createTestSession({ schoolId: off.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const offPrincipal = createTestClient((await createSchoolStaffSession(off.id, [{ role: 'principal' }])).session);
      const scope = { schoolId: off.id, noticeId: 'ntc_missing' };
      const body = { ...plain(), schoolId: off.id, sessionId: offSession };
      await expectFeatureDisabled(offPrincipal.school.listNotices({ schoolId: off.id, sessionId: offSession }), 'notices');
      await expectFeatureDisabled(offPrincipal.school.getNotice(scope), 'notices');
      await expectFeatureDisabled(offPrincipal.school.createNotice(body), 'notices');
      await expectFeatureDisabled(offPrincipal.school.updateNotice({ ...body, noticeId: 'ntc_missing', expectedVersion: 1 }), 'notices');
      await expectFeatureDisabled(offPrincipal.school.deleteNotice(scope), 'notices');
      await expectFeatureDisabled(offPrincipal.school.previewNotice({ schoolId: off.id, source: { kind: 'unsaved', sessionId: offSession, title: 'T', bodyMode: 'plain', body: 'B' } }), 'notices');
      await expectFeatureDisabled(offPrincipal.school.previewNoticePublish(scope), 'notices');
      await expectFeatureDisabled(offPrincipal.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null }), 'notices');
      await expectFeatureDisabled(offPrincipal.school.getNoticeDownload(scope), 'notices');
      expect(await db.select().from(noticeTable).where(eq(noticeTable.schoolId, off.id))).toHaveLength(0);
      // A caller without access cannot tell whether the school has the feature.
      await expectPermissionDenied(principal.school.listNotices({ schoolId: off.id, sessionId: offSession }));

      // Switching the feature off stops an existing notice at once; switching it on restores it.
      const flipped = await createTestSchool({ features: ['notices'] });
      const flippedSession = (await createTestSession({ schoolId: flipped.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const flippedPrincipal = createTestClient((await createSchoolStaffSession(flipped.id, [{ role: 'principal' }])).session);
      const kept = await flippedPrincipal.school.createNotice({ ...plain(), schoolId: flipped.id, sessionId: flippedSession });
      await setTestSchoolFeature(flipped.id, 'notices', false);
      await expectFeatureDisabled(flippedPrincipal.school.getNotice({ schoolId: flipped.id, noticeId: kept.id }), 'notices');
      await setTestSchoolFeature(flipped.id, 'notices', true);
      await expect(flippedPrincipal.school.getNotice({ schoolId: flipped.id, noticeId: kept.id })).resolves.toMatchObject({ id: kept.id });
    });
  });

  describe('input validation', () => {
    it('rejects an empty or oversized title and body, an empty audience and inconsistent class selections', async () => {
      const invalid = [
        plain({ title: '   ' }),
        plain({ title: 'x'.repeat(201) }),
        plain({ body: '  \n ' }),
        plain({ body: 'x'.repeat(200_001) }),
        plain({ bodyMode: 'markdown' }),
        plain({ toStaff: false, cadetScope: 'none' }),
        plain({ cadetScope: 'selected_classes', classIds: [] }),
        plain({ cadetScope: 'all_classes', classIds: [grade6] }),
        plain({ cadetScope: 'none', classIds: [grade6] }),
        plain({ cadetScope: 'selected_classes', classIds: [grade6, grade6] }),
        plain({ cadetScope: 'everyone' }),
      ];
      for (const input of invalid) {
        await expect(principal.school.createNotice(input as never), JSON.stringify(input).slice(0, 120)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      await expect(principal.school.listNotices({ schoolId, sessionId, limit: 21 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(principal.school.listNotices({ schoolId, sessionId, orderBy: { field: 'body', direction: 'asc' } } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('rejects a template notice whose Handlebars is invalid, on create and on update', async () => {
      await expect(principal.school.createNotice(plain({ bodyMode: 'template', body: '<p>{{#if notice.title}}</p>' }))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(principal.school.createNotice(plain({ bodyMode: 'template', body: '{{unknownHelper notice.title}}' }))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const draft = await principal.school.createNotice(plain({ bodyMode: 'template', body: '<h1>{{notice.title}}</h1>' }));
      await expect(principal.school.updateNotice({ ...plain({ bodyMode: 'template', body: '{{> partial}}' }), noticeId: draft.id, expectedVersion: draft.version })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // The same text is fine as plain text: it is data there, never compiled.
      await expect(principal.school.updateNotice({ ...plain({ body: '{{#if notice.title}}' }), noticeId: draft.id, expectedVersion: draft.version })).resolves.toMatchObject({ bodyMode: 'plain', body: '{{#if notice.title}}' });
    });
  });

  describe('tenant isolation', () => {
    it('refuses a session or a class of another school, and never finds another school\'s notice', async () => {
      const other = await createTestSchool({ features: ['notices', 'cadet'] });
      const otherSession = (await createTestSession({ schoolId: other.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const otherClass = (await createTestClass({ schoolId: other.id, label: 'Other Grade' })).schoolClass.id;
      const otherPrincipal = createTestClient((await createSchoolStaffSession(other.id, [{ role: 'principal' }])).session);
      const theirs = await otherPrincipal.school.createNotice({ ...plain(), schoolId: other.id, sessionId: otherSession });

      await expect(principal.school.createNotice(plain({ sessionId: otherSession }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.listNotices({ schoolId, sessionId: otherSession })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.createNotice(plain({ cadetScope: 'selected_classes', classIds: [otherClass] }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.createNotice(plain({ cadetScope: 'selected_classes', classIds: [grade6, otherClass] }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.previewNotice({ schoolId, source: { kind: 'unsaved', sessionId: otherSession, title: 'T', bodyMode: 'plain', body: 'B' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

      // Naming our school with their notice id finds nothing, for every procedure.
      const scope = { schoolId, noticeId: theirs.id };
      await expect(principal.school.getNotice(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.updateNotice({ ...plain(), noticeId: theirs.id, expectedVersion: theirs.version })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.deleteNotice(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.previewNotice({ schoolId, source: { kind: 'saved', noticeId: theirs.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.previewNoticePublish(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(principal.school.getNoticeDownload(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(otherPrincipal.school.getNotice({ schoolId: other.id, noticeId: theirs.id })).resolves.toMatchObject({ status: 'draft' });
      expect((await principal.school.listNotices({ schoolId, sessionId })).items.map((item) => item.id)).not.toContain(theirs.id);
    });
  });

  describe('drafts', () => {
    it('persists a draft with its audience and reports what the caller may do with it', async () => {
      const draft = await teacher.school.createNotice(plain({ toStaff: false, cadetScope: 'selected_classes', classIds: [grade7, grade6] }));
      expect(draft).toMatchObject({
        schoolId,
        sessionId,
        title: 'Sports Day',
        status: 'draft',
        toStaff: false,
        cadetScope: 'selected_classes',
        // Class display order, not input order.
        classIds: [grade6, grade7],
        classes: [
          { classId: grade6, name: 'Grade 6' },
          { classId: grade7, name: 'Grade 7' },
        ],
        version: 1,
        issuedOn: null,
        createdBy: teacherId,
        publishedAt: null,
        publishedBy: null,
        publishedStaffCount: null,
        publishedCadetCount: null,
        templateRevisionId: null,
        viewer: { canEdit: true, canPublish: false },
      });
      expect(draft.createdByName).toEqual(expect.any(String));
      const [row] = await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id));
      expect(row).toMatchObject({ schoolId, sessionId, status: 'draft', createdBy: teacherId });
      const classes = await db.select().from(noticeClassTable).where(eq(noticeClassTable.noticeId, draft.id));
      expect(classes.map((entry) => entry.classId).sort()).toEqual([grade6, grade7].sort());
      expect(classes.every((entry) => entry.schoolId === schoolId)).toBe(true);
      expect(await eventsOf(draft.id)).toHaveLength(0);
    });

    it('shows a draft only to its author and to staff who may publish; others get NOT_FOUND', async () => {
      const draft = await teacher.school.createNotice(plain({ title: 'Teacher draft' }));
      const scope = { schoolId, noticeId: draft.id };
      for (const client of [otherTeacher, accountant, examCoordinator]) {
        await expect(client.school.getNotice(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(client.school.previewNotice({ schoolId, source: { kind: 'saved', noticeId: draft.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(client.school.updateNotice({ ...plain({ title: 'Hijacked' }), noticeId: draft.id, expectedVersion: draft.version })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(client.school.deleteNotice(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(client.school.getNoticeDownload(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect((await client.school.listNotices({ schoolId, sessionId, searchQuery: 'Teacher draft' })).items).toHaveLength(0);
      }
      await expect(teacher.school.getNotice(scope)).resolves.toMatchObject({ viewer: { canEdit: true, canPublish: false } });
      for (const client of [principal, manager]) {
        await expect(client.school.getNotice(scope)).resolves.toMatchObject({ title: 'Teacher draft', viewer: { canEdit: true, canPublish: true } });
        expect((await client.school.listNotices({ schoolId, sessionId, searchQuery: 'Teacher draft' })).items.map((item) => item.id)).toEqual([draft.id]);
      }
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id)))[0]).toMatchObject({ title: 'Teacher draft' });
    });

    it('lets the author and a publisher replace a draft, and replaces its classes', async () => {
      const draft = await teacher.school.createNotice(plain({ toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] }));
      const byAuthor = await teacher.school.updateNotice({ ...plain({ title: 'Edited', toStaff: true, cadetScope: 'all_classes' }), noticeId: draft.id, expectedVersion: draft.version });
      expect(byAuthor).toMatchObject({ title: 'Edited', toStaff: true, cadetScope: 'all_classes', classIds: [] });
      expect(await db.select().from(noticeClassTable).where(eq(noticeClassTable.noticeId, draft.id))).toHaveLength(0);
      const byManager = await manager.school.updateNotice({ ...plain({ title: 'Manager edit', cadetScope: 'selected_classes', classIds: [grade7] }), noticeId: draft.id, expectedVersion: byAuthor.version });
      expect(byManager).toMatchObject({ title: 'Manager edit', classIds: [grade7], classes: [{ classId: grade7, name: 'Grade 7' }], createdBy: teacherId });
      // Every saved change is one version.
      expect([draft.version, byAuthor.version, byManager.version]).toEqual([1, 2, 3]);
      expect(new Date(byManager.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(draft.updatedAt).getTime());
    });

    it('deletes a draft for its author or a publisher, with its class rows', async () => {
      const own = await teacher.school.createNotice(plain({ cadetScope: 'selected_classes', classIds: [grade6] }));
      await expect(teacher.school.deleteNotice({ schoolId, noticeId: own.id })).resolves.toEqual({ deleted: true });
      expect(await db.select().from(noticeTable).where(eq(noticeTable.id, own.id))).toHaveLength(0);
      expect(await db.select().from(noticeClassTable).where(eq(noticeClassTable.noticeId, own.id))).toHaveLength(0);
      await expect(teacher.school.deleteNotice({ schoolId, noticeId: own.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const theirs = await teacher.school.createNotice(plain());
      await expect(principal.school.deleteNotice({ schoolId, noticeId: theirs.id })).resolves.toEqual({ deleted: true });
    });

    it('lists with search, filters, ordering and pagination', async () => {
      const listSchool = await createTestSchool({ features: ['notices', 'cadet'] });
      const listSession = (await createTestSession({ schoolId: listSchool.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const client = createTestClient((await createSchoolStaffSession(listSchool.id, [{ role: 'principal' }])).session);
      const base = { ...plain(), schoolId: listSchool.id, sessionId: listSession };
      const alpha = await client.school.createNotice({ ...base, title: 'Alpha staff' });
      const beta = await client.school.createNotice({ ...base, title: 'Beta cadets 100%', toStaff: false, cadetScope: 'all_classes' });
      const gamma = await client.school.createNotice({ ...base, title: 'Gamma both', cadetScope: 'all_classes' });
      await client.school.publishNotice({ schoolId: listSchool.id, noticeId: gamma.id, expectedVersion: gamma.version, expectedTemplateRevisionId: null });
      await client.school.publishNotice({ schoolId: listSchool.id, noticeId: alpha.id, expectedVersion: alpha.version, expectedTemplateRevisionId: null });
      const list = (input: Record<string, unknown> = {}) => client.school.listNotices({ schoolId: listSchool.id, sessionId: listSession, ...input } as never);
      const ids = async (input: Record<string, unknown> = {}) => (await list(input)).items.map((item) => item.id);

      expect(await ids()).toEqual([gamma.id, beta.id, alpha.id]);
      expect(await ids({ orderBy: { field: 'title', direction: 'asc' } })).toEqual([alpha.id, beta.id, gamma.id]);
      // Published newest first, then drafts; ascending keeps drafts last too.
      expect(await ids({ orderBy: { field: 'publishedAt', direction: 'desc' } })).toEqual([alpha.id, gamma.id, beta.id]);
      expect(await ids({ orderBy: { field: 'publishedAt', direction: 'asc' } })).toEqual([gamma.id, alpha.id, beta.id]);
      expect(await ids({ filters: { status: 'draft' } })).toEqual([beta.id]);
      expect(await ids({ filters: { status: 'published', toStaff: true } })).toEqual([gamma.id, alpha.id]);
      expect(await ids({ filters: { toStaff: false } })).toEqual([beta.id]);
      expect(await ids({ filters: { toCadets: true } })).toEqual([gamma.id, beta.id]);
      expect(await ids({ filters: { toCadets: false } })).toEqual([alpha.id]);
      expect(await ids({ searchQuery: 'BETA' })).toEqual([beta.id]);
      // LIKE wildcards in the search text are literal.
      expect(await ids({ searchQuery: '100%' })).toEqual([beta.id]);
      expect(await ids({ searchQuery: '%' })).toEqual([beta.id]);
      expect(await ids({ searchQuery: '_' })).toEqual([]);

      const first = await list({ limit: 2 });
      expect(first.pagination).toEqual({ nextCursor: '2', currentPage: 1, totalPages: 2, totalItems: 3, pageSize: 2 });
      const second = await list({ limit: 2, cursor: first.pagination.nextCursor });
      expect(second.items.map((item) => item.id)).toEqual([alpha.id]);
      expect(second.pagination.nextCursor).toBeNull();
      // List rows carry no body.
      expect(first.items[0]).not.toHaveProperty('body');
      // Another session of the same school lists none of them.
      const otherSession = (await createTestSession({ schoolId: listSchool.id, sessionStartYear: 2027, sessionEndYear: 2028 })).id;
      expect((await client.school.listNotices({ schoolId: listSchool.id, sessionId: otherSession })).items).toHaveLength(0);
    });
  });

  describe('the Cadet Portal rule', () => {
    it('refuses any student scope while the school has no cadet feature, on create, update, forecast and publish', async () => {
      const school = await createTestSchool({ features: ['notices'] });
      const session = (await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const classId = (await createTestClass({ schoolId: school.id, label: 'Grade 1' })).schoolClass.id;
      const client = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal' }])).session);
      const base = { ...plain(), schoolId: school.id, sessionId: session };

      await expectFeatureDisabled(client.school.createNotice({ ...base, cadetScope: 'all_classes' }), 'cadet');
      await expectFeatureDisabled(client.school.createNotice({ ...base, toStaff: false, cadetScope: 'selected_classes', classIds: [classId] }), 'cadet');
      expect(await db.select().from(noticeTable).where(eq(noticeTable.schoolId, school.id))).toHaveLength(0);
      const staffOnly = await client.school.createNotice(base);
      await expectFeatureDisabled(client.school.updateNotice({ ...base, noticeId: staffOnly.id, expectedVersion: staffOnly.version, cadetScope: 'all_classes' }), 'cadet');
      await expect(client.school.getNotice({ schoolId: school.id, noticeId: staffOnly.id })).resolves.toMatchObject({ cadetScope: 'none' });

      // A draft saved while the school had the portal cannot be published once it is switched off.
      await setTestSchoolFeature(school.id, 'cadet', true);
      const draft = await client.school.createNotice({ ...base, cadetScope: 'all_classes' });
      await setTestSchoolFeature(school.id, 'cadet', false);
      await expectFeatureDisabled(client.school.previewNoticePublish({ schoolId: school.id, noticeId: draft.id }), 'cadet');
      await expectFeatureDisabled(client.school.publishNotice({ schoolId: school.id, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null }), 'cadet');
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id)))[0]).toMatchObject({ status: 'draft', publishedAt: null });
      expect(await db.select().from(notificationEventTable).where(eq(notificationEventTable.schoolId, school.id))).toHaveLength(0);
      // Staff-only notices never need the portal.
      await expect(client.school.publishNotice({ schoolId: school.id, noticeId: staffOnly.id, expectedVersion: staffOnly.version, expectedTemplateRevisionId: null })).resolves.toMatchObject({ status: 'published', publishedCadetCount: 0 });
    });
  });

  describe('preview', () => {
    it('renders unsaved content without persisting it, escaping plain text and sanitizing a template', async () => {
      const before = (await db.select().from(noticeTable).where(eq(noticeTable.schoolId, schoolId))).length;
      const plainPreview = await teacher.school.previewNotice({ schoolId, source: { kind: 'unsaved', sessionId, title: 'Fees <reminder>', bodyMode: 'plain', body: '<script>alert(1)</script>\n\n{{school.name}}' } });
      expect(plainPreview.html).toContain('Content-Security-Policy');
      expect(plainPreview.html).toContain('Notice School');
      expect(plainPreview.html).toContain('Fees &lt;reminder&gt;');
      expect(plainPreview.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(plainPreview.html).toContain('{{school.name}}');
      expect(plainPreview.html).not.toContain('<script');
      expect(plainPreview.html).toContain('Session 2026-2027');

      const templatePreview = await teacher.school.previewNotice({
        schoolId,
        source: { kind: 'unsaved', sessionId, title: 'Custom', bodyMode: 'template', body: '<h1 onclick="x()">{{notice.title}} at {{school.name}}</h1><script>bad()</script><p>[{{student.name}}][{{notice.paragraphs.length}}]</p>' },
      });
      expect(templatePreview.html).toContain('<h1>Custom at Notice School</h1>');
      expect(templatePreview.html).toContain('<p>[][0]</p>');
      expect(templatePreview.html).not.toMatch(/<script|onclick/);
      await expect(teacher.school.previewNotice({ schoolId, source: { kind: 'unsaved', sessionId, title: 'Bad', bodyMode: 'template', body: '{{#each}}' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // The structural limits apply to an unsaved preview as well as to a save.
      const selfCalling = '{{#*inline "p"}}{{> p}}{{> p}}{{/inline}}{{> p}}';
      await expect(teacher.school.previewNotice({ schoolId, source: { kind: 'unsaved', sessionId, title: 'Loop', bodyMode: 'template', body: selfCalling } })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Templates cannot use partials, inline partials or decorators.' });
      await expect(teacher.school.createNotice(plain({ bodyMode: 'template', body: selfCalling }))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const deep = `${'{{#each this}}'.repeat(5)}x${'{{/each}}'.repeat(5)}`;
      await expect(teacher.school.previewNotice({ schoolId, source: { kind: 'unsaved', sessionId, title: 'Deep', bodyMode: 'template', body: deep } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await db.select().from(noticeTable).where(eq(noticeTable.schoolId, schoolId))).length).toBe(before);
    });

    it('renders a saved draft with the school\'s current Notice template', async () => {
      const school = await createTestSchool({ name: 'Template School', features: ['notices'] });
      const session = (await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const client = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal' }])).session);
      const draft = await client.school.createNotice({ ...plain(), schoolId: school.id, sessionId: session });
      const preview = () => client.school.previewNotice({ schoolId: school.id, source: { kind: 'saved', noticeId: draft.id } });
      // No selected template: the built-in default design.
      expect((await preview()).html).toContain('class="notice-label"');
      await client.school.saveDocumentTemplate({ schoolId: school.id, documentType: 'notice', name: 'Ours', content: '<section class="ours">{{notice.title}}{{#each notice.paragraphs}}<p>{{this}}</p>{{/each}}</section>', pageSize: 'full', expectedRevisionId: null });
      const custom = (await preview()).html;
      expect(custom).toContain('<section class="ours">Sports Day<p>The Annual Sports Day is on Saturday.</p><p>Please be seated by 8:30 AM.</p></section>');
      expect(custom).not.toContain('class="notice-label"');
    });
  });

  describe('publishing', () => {
    it('forecasts the recipients: every member for staff, registered students of the scope for cadets', async () => {
      const staffOnly = await principal.school.createNotice(plain());
      await expect(principal.school.previewNoticePublish({ schoolId, noticeId: staffOnly.id })).resolves.toEqual({
        kind: 'ready',
        version: 1,
        templateRevisionId: null,
        pageSize: 'full',
        toStaff: true,
        staffRecipientCount: staffCount,
        cadetScope: 'none',
        cadetForecast: null,
      });
      const everyone = await principal.school.createNotice(plain({ toStaff: false, cadetScope: 'all_classes' }));
      // Asha, Bela, Chetan and the unplaced Deepa; never the unregistered or past-session student.
      await expect(principal.school.previewNoticePublish({ schoolId, noticeId: everyone.id })).resolves.toMatchObject({
        kind: 'ready',
        toStaff: false,
        staffRecipientCount: 0,
        cadetScope: 'all_classes',
        cadetForecast: { recipientCount: 4, channels: { whatsapp: { owed: 0, skipped: { disabled: 4 } }, web_push: { owed: 0, skipped: { disabled: 4 } } } },
      });
      const sixOnly = await principal.school.createNotice(plain({ toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] }));
      await expect(principal.school.previewNoticePublish({ schoolId, noticeId: sixOnly.id })).resolves.toMatchObject({ cadetForecast: { recipientCount: 2 } });
      // A forecast writes nothing.
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, sixOnly.id)))[0]).toMatchObject({ status: 'draft' });
      expect(await eventsOf(sixOnly.id)).toHaveLength(0);
    });

    it('publishes once: records who and when, notifies each addressed student and the staff, and freezes the notice', async () => {
      const draft = await teacher.school.createNotice(plain({ title: 'Parent meeting', cadetScope: 'selected_classes', classIds: [grade6] }));
      const scope = { schoolId, noticeId: draft.id };
      const published = await principal.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null });
      expect(published).toMatchObject({
        status: 'published',
        publishedBy: principalId,
        createdBy: teacherId,
        publishedStaffCount: staffCount,
        publishedCadetCount: 2,
        templateRevisionId: null,
        viewer: { canEdit: false, canPublish: false },
      });
      expect(published.publishedAt).toEqual(expect.any(String));

      const events = await eventsOf(draft.id);
      const cadetEvents = events.filter((event) => event.type === 'notice.published');
      const staffEvents = events.filter((event) => event.type === 'notice.published_staff');
      expect(cadetEvents).toHaveLength(2);
      expect(cadetEvents.map((event) => (event.data as { studentName: string }).studentName).sort()).toEqual(['Asha Six', 'Bela Six']);
      for (const event of cadetEvents) {
        const data = event.data as { admissionId: string; noticeId: string; noticeTitle: string; sessionId: string };
        expect(event).toMatchObject({ key: `notice:${draft.id}:${data.admissionId}`, sendPriority: 'bulk', batchKind: 'notice', batchId: draft.id, createdBy: principalId, recipients: { kind: 'admissions', admissionIds: [data.admissionId] } });
        expect(data).toMatchObject({ noticeId: draft.id, noticeTitle: 'Parent meeting', sessionId });
      }
      expect(staffEvents).toHaveLength(1);
      expect(staffEvents[0]).toMatchObject({ key: `notice-staff:${draft.id}`, batchKind: null, data: { noticeId: draft.id, noticeTitle: 'Parent meeting', sessionId } });
      expect((staffEvents[0]!.recipients as { userIds: string[] }).userIds).toHaveLength(staffCount);

      // Published is final: no second publication, no edit, no delete; nothing more is emitted.
      await expect(principal.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(manager.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(principal.school.updateNotice({ ...plain({ title: 'Changed' }), noticeId: draft.id, expectedVersion: draft.version })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(teacher.school.updateNotice({ ...plain({ title: 'Changed' }), noticeId: draft.id, expectedVersion: draft.version })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(principal.school.deleteNotice(scope)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(principal.school.previewNoticePublish(scope)).resolves.toMatchObject({ kind: 'already_published', publishedAt: published.publishedAt });
      expect(await eventsOf(draft.id)).toHaveLength(3);
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id)))[0]).toMatchObject({ title: 'Parent meeting', status: 'published' });

      // Every reader now sees it, whoever it was addressed to.
      for (const client of [otherTeacher, accountant, examCoordinator]) {
        await expect(client.school.getNotice(scope)).resolves.toMatchObject({ status: 'published', viewer: { canEdit: false, canPublish: false } });
      }
    });

    it('fans out exactly once when two people publish at the same moment', async () => {
      const draft = await principal.school.createNotice(plain({ cadetScope: 'all_classes' }));
      const scope = { schoolId, noticeId: draft.id };
      const results = await Promise.allSettled([principal.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null }), manager.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null }), principal.school.publishNotice({ ...scope, expectedVersion: 1, expectedTemplateRevisionId: null })]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'CONFLICT' });
      }
      const events = await eventsOf(draft.id);
      expect(events.filter((event) => event.type === 'notice.published')).toHaveLength(4);
      expect(events.filter((event) => event.type === 'notice.published_staff')).toHaveLength(1);
      expect(new Set(events.map((event) => event.key)).size).toBe(events.length);
    });

    it('publishes a notice nobody is enrolled for, and refuses a selected-classes draft left without classes', async () => {
      const emptyClass = (await createTestClass({ schoolId, label: 'Grade 12' })).schoolClass.id;
      const draft = await principal.school.createNotice(plain({ toStaff: false, cadetScope: 'selected_classes', classIds: [emptyClass] }));
      await expect(principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null })).resolves.toMatchObject({ status: 'published', publishedStaffCount: 0, publishedCadetCount: 0 });
      expect(await eventsOf(draft.id)).toHaveLength(0);

      // A draft whose only class is deleted afterwards (through the real procedure) addresses nobody.
      const doomed = (await createTestClass({ schoolId, label: 'Grade 13' })).schoolClass.id;
      const orphan = await principal.school.createNotice(plain({ toStaff: false, cadetScope: 'selected_classes', classIds: [doomed] }));
      await principal.school.deleteClass({ schoolId, classId: doomed });
      await expect(principal.school.getNotice({ schoolId, noticeId: orphan.id })).resolves.toMatchObject({ classIds: [], classes: [{ classId: null, name: 'Grade 13' }] });
      await expect(principal.school.previewNoticePublish({ schoolId, noticeId: orphan.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(principal.school.publishNotice({ schoolId, noticeId: orphan.id, expectedVersion: orphan.version, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, orphan.id)))[0]).toMatchObject({ status: 'draft' });
    });

    it('keeps a published notice\'s audience record when a class is renamed or deleted, without blocking the deletion', async () => {
      const keep = (await createTestClass({ schoolId, label: 'Grade 9' })).schoolClass.id;
      const renamed = (await createTestClass({ schoolId, label: 'Grade 10' })).schoolClass.id;
      const deleted = (await createTestClass({ schoolId, label: 'Grade 11' })).schoolClass.id;
      const goneBeforePublishing = (await createTestClass({ schoolId, label: 'Grade 14' })).schoolClass.id;
      const draft = await principal.school.createNotice(plain({ toStaff: false, cadetScope: 'selected_classes', classIds: [keep, renamed, deleted, goneBeforePublishing] }));
      // A class deleted while the notice is still a draft was never addressed: publication drops it from the record.
      await principal.school.deleteClass({ schoolId, classId: goneBeforePublishing });
      // A class renamed while it is a draft is recorded under the name it has at publication.
      await db.update(classTable).set({ label: 'Grade 10 (Science)' }).where(eq(classTable.id, renamed));
      await expect(principal.school.getNotice({ schoolId, noticeId: draft.id })).resolves.toMatchObject({
        classIds: [keep, renamed, deleted],
        classes: [
          { classId: keep, name: 'Grade 9' },
          { classId: renamed, name: 'Grade 10 (Science)' },
          { classId: deleted, name: 'Grade 11' },
          { classId: null, name: 'Grade 14' },
        ],
      });
      const published = await principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null });
      const audience = [
        { classId: keep, name: 'Grade 9' },
        { classId: renamed, name: 'Grade 10 (Science)' },
        { classId: deleted, name: 'Grade 11' },
      ];
      expect(published.classes).toEqual(audience);

      // After publication: the reviewer's scenario. Deleting a class succeeds, and the record still names it.
      await expect(principal.school.deleteClass({ schoolId, classId: deleted })).resolves.toMatchObject({ id: deleted });
      await db.update(classTable).set({ label: 'Grade 10 (Commerce)' }).where(eq(classTable.id, renamed));
      const after = await principal.school.getNotice({ schoolId, noticeId: draft.id });
      expect(after.cadetScope).toBe('selected_classes');
      expect(after.classIds).toEqual([keep, renamed]);
      expect(after.classes).toEqual([
        { classId: keep, name: 'Grade 9' },
        // The name at publication, not the class's later name.
        { classId: renamed, name: 'Grade 10 (Science)' },
        { classId: null, name: 'Grade 11' },
      ]);
      const listed = (await principal.school.listNotices({ schoolId, sessionId, searchQuery: draft.title, filters: { toStaff: false } })).items.find((item) => item.id === draft.id);
      expect(listed?.classes).toEqual(after.classes);
      // Even with every class gone the notice still says whom it went to.
      await principal.school.deleteClass({ schoolId, classId: keep });
      await principal.school.deleteClass({ schoolId, classId: renamed });
      const orphaned = await principal.school.getNotice({ schoolId, noticeId: draft.id });
      expect(orphaned.classIds).toEqual([]);
      expect(orphaned.classes.map((entry) => entry.name).sort()).toEqual(['Grade 10 (Science)', 'Grade 11', 'Grade 9']);
    });

    it('publishes only the version the publisher reviewed: an edit in between is a CONFLICT and notifies nobody', async () => {
      const draft = await teacher.school.createNotice(plain({ title: 'Reviewed', toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] }));
      const scope = { schoolId, noticeId: draft.id };
      // The principal opens the notice and the forecast...
      const reviewed = await principal.school.getNotice(scope);
      await expect(principal.school.previewNoticePublish(scope)).resolves.toMatchObject({ kind: 'ready', version: reviewed.version });
      // ...the author widens the audience and replaces the text...
      const edited = await teacher.school.updateNotice({ ...plain({ title: 'Not reviewed', body: 'Different text.', toStaff: true, cadetScope: 'all_classes' }), noticeId: draft.id, expectedVersion: draft.version });
      expect(edited.version).toBe(reviewed.version + 1);
      // ...and the principal's click publishes nothing.
      await expect(principal.school.publishNotice({ ...scope, expectedVersion: reviewed.version, expectedTemplateRevisionId: null })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'This notice changed since you opened it. Review it again.',
      });
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id)))[0]).toMatchObject({ status: 'draft', title: 'Not reviewed', publishedAt: null });
      expect(await eventsOf(draft.id)).toHaveLength(0);
      // The forecast now names the new version; publishing that one works.
      await expect(principal.school.previewNoticePublish(scope)).resolves.toMatchObject({ kind: 'ready', version: edited.version });
      const published = await principal.school.publishNotice({ ...scope, expectedVersion: edited.version, expectedTemplateRevisionId: null });
      expect(published).toMatchObject({ status: 'published', title: 'Not reviewed', version: edited.version + 1 });
      // Input validation: the version is required and positive.
      await expect(principal.school.publishNotice(scope as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(principal.school.publishNotice({ ...scope, expectedVersion: 0, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('refuses to overwrite a draft someone else changed since it was opened', async () => {
      const draft = await teacher.school.createNotice(plain({ title: 'Shared draft' }));
      const byManager = await manager.school.updateNotice({ ...plain({ title: 'Manager wording' }), noticeId: draft.id, expectedVersion: draft.version });
      // The author still holds version 1.
      await expect(teacher.school.updateNotice({ ...plain({ title: 'Author wording' }), noticeId: draft.id, expectedVersion: draft.version })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'This notice changed since you opened it. Review it again.',
      });
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id)))[0]).toMatchObject({ title: 'Manager wording', version: byManager.version });
      // Two saves of the same version at once: exactly one wins.
      const results = await Promise.allSettled([
        teacher.school.updateNotice({ ...plain({ title: 'A' }), noticeId: draft.id, expectedVersion: byManager.version }),
        manager.school.updateNotice({ ...plain({ title: 'B' }), noticeId: draft.id, expectedVersion: byManager.version }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
      await expect(teacher.school.updateNotice({ ...plain(), noticeId: draft.id } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('fixes the issued-on date at publication: a later change of the session time zone does not move it', async () => {
      const school = await createTestSchool({ name: 'Dated School', features: ['notices'] });
      const session = (await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const client = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal' }])).session);
      // These two zones are 25 hours apart, so they never share a calendar date.
      const setZone = (timeZone: string) => db.update(schoolSessionTable).set({ financeConfig: { timeZone } as never }).where(eq(schoolSessionTable.id, session));
      const dateIn = (timeZone: string, instant: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
      const html = async (noticeId: string) => (await client.school.previewNotice({ schoolId: school.id, source: { kind: 'saved', noticeId } })).html;
      const body = '<p id="d">{{notice.issuedOn}}|{{notice.issuedOnDisplay}}</p>';

      await setZone('Pacific/Kiritimati');
      const draft = await client.school.createNotice({ ...plain({ bodyMode: 'template', body }), schoolId: school.id, sessionId: session });
      const stillDraft = await client.school.createNotice({ ...plain({ bodyMode: 'template', body }), schoolId: school.id, sessionId: session });
      expect(draft.issuedOn).toBeNull();
      const published = await client.school.publishNotice({ schoolId: school.id, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null });
      const issuedOn = dateIn('Pacific/Kiritimati', new Date(published.publishedAt!));
      expect(published.issuedOn).toBe(issuedOn);
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id)))[0]).toMatchObject({ issuedOn });
      const before = await html(draft.id);
      expect(before).toContain(`${issuedOn}|`);

      await setZone('Pacific/Pago_Pago');
      // The published notice keeps its date, in the page and in the PDF rendered afterwards...
      expect(await html(draft.id)).toBe(before);
      const download = await client.school.getNoticeDownload({ schoolId: school.id, noticeId: draft.id });
      expect((await fetch(download.url)).status).toBe(200);
      expect((await client.school.getNotice({ schoolId: school.id, noticeId: draft.id })).issuedOn).toBe(issuedOn);
      // ...while a draft, which has no date yet, shows today's in the session's current zone.
      expect(await html(stillDraft.id)).toContain(`${dateIn('Pacific/Pago_Pago', new Date())}|`);
      expect(await html(stillDraft.id)).not.toContain(`${issuedOn}|`);
    });

    it('pins the template revision, so a later template change never alters a published notice', async () => {
      const school = await createTestSchool({ name: 'Pinned School', features: ['notices'] });
      const session = (await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const client = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal' }])).session);
      const base = { ...plain(), schoolId: school.id, sessionId: session };
      const template = (marker: string) => `<section data-x="1" class="${marker}">${marker}: {{notice.title}} {{notice.issuedOn}}</section>`;
      const html = async (noticeId: string) => (await client.school.previewNotice({ schoolId: school.id, source: { kind: 'saved', noticeId } })).html;

      // Published with the built-in default (nothing selected): null is pinned and stays the default.
      const builtIn = await client.school.createNotice(base);
      const builtInPublished = await client.school.publishNotice({ schoolId: school.id, noticeId: builtIn.id, expectedVersion: builtIn.version, expectedTemplateRevisionId: null });
      expect(builtInPublished.templateRevisionId).toBeNull();

      const first = await client.school.saveDocumentTemplate({ schoolId: school.id, documentType: 'notice', name: 'First', content: template('first'), pageSize: 'full', expectedRevisionId: null });
      const pinned = await client.school.createNotice(base);
      const pinnedPublished = await client.school.publishNotice({ schoolId: school.id, noticeId: pinned.id, expectedVersion: pinned.version, expectedTemplateRevisionId: first.artifact.id });
      expect(pinnedPublished.templateRevisionId).toBe(first.artifact.id);
      const draft = await client.school.createNotice(base);
      const custom = await client.school.createNotice({ ...base, bodyMode: 'template', body: '<h1 class="own">{{notice.title}}</h1>' });
      const customPublished = await client.school.publishNotice({ schoolId: school.id, noticeId: custom.id, expectedVersion: custom.version, expectedTemplateRevisionId: null });
      expect(customPublished.templateRevisionId).toBeNull();
      const pinnedBefore = await html(pinned.id);
      expect(pinnedBefore).toContain('first: Sports Day');

      await client.school.saveDocumentTemplate({ schoolId: school.id, documentType: 'notice', name: 'Second', content: template('second'), pageSize: 'full', expectedRevisionId: first.artifact.id });
      // Published notices are byte-for-byte what they were; the draft follows the school's current template.
      expect(await html(pinned.id)).toBe(pinnedBefore);
      expect(await html(builtIn.id)).toContain('class="notice-label"');
      expect(await html(custom.id)).toContain('<h1 class="own">Sports Day</h1>');
      expect(await html(draft.id)).toContain('second: Sports Day');
      // Rendering twice gives the same document: the date is the publication date, not "now".
      expect(await html(pinned.id)).toBe(await html(pinned.id));
    });

    it('publishes only inside the Notice template the publisher reviewed: a template replaced in between is a CONFLICT and notifies nobody', async () => {
      const school = await createTestSchool({ name: 'Reviewed Template School', features: ['notices'] });
      const session = (await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
      const client = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal' }])).session);
      const base = { ...plain(), schoolId: school.id, sessionId: session };
      const template = (text: string) => `<section><p>${text}</p><h1>{{notice.title}}</h1>{{#each notice.paragraphs}}<p>{{this}}</p>{{/each}}</section>`;
      const preview = (noticeId: string) => client.school.previewNotice({ schoolId: school.id, source: { kind: 'saved', noticeId } });
      const stored = async (noticeId: string) => (await db.select().from(noticeTable).where(eq(noticeTable.id, noticeId)))[0]!;

      // The publisher reviews a draft printed with the built-in design...
      const draft = await client.school.createNotice(base);
      const scope = { schoolId: school.id, noticeId: draft.id };
      const reviewedBuiltIn = await preview(draft.id);
      expect(reviewedBuiltIn).toMatchObject({ version: draft.version, templateRevisionId: null });
      await expect(client.school.previewNoticePublish(scope)).resolves.toMatchObject({ kind: 'ready', version: draft.version, templateRevisionId: null });
      // ...a template manager selects a design that carries text of its own...
      const first = await client.school.saveDocumentTemplate({ schoolId: school.id, documentType: 'notice', name: 'First', content: template('School closed tomorrow'), pageSize: 'full', expectedRevisionId: null });
      // ...and the publisher's click sends nothing: the notice itself did not change, the page around it did.
      await expect(client.school.publishNotice({ ...scope, expectedVersion: reviewedBuiltIn.version!, expectedTemplateRevisionId: reviewedBuiltIn.templateRevisionId })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: "The school's Notice template changed since you opened this notice. Review it again.",
      });
      expect(await stored(draft.id)).toMatchObject({ status: 'draft', publishedAt: null, templateRevisionId: null, version: draft.version });
      expect(await eventsOf(draft.id)).toHaveLength(0);

      // The publisher reviews again: the preview and the forecast now name the selected revision...
      const reviewedFirst = await preview(draft.id);
      expect(reviewedFirst).toMatchObject({ version: draft.version, templateRevisionId: first.artifact.id });
      expect(reviewedFirst.html).toContain('School closed tomorrow');
      await expect(client.school.previewNoticePublish(scope)).resolves.toMatchObject({ kind: 'ready', templateRevisionId: first.artifact.id });
      // ...which is replaced once more before the click.
      const second = await client.school.saveDocumentTemplate({ schoolId: school.id, documentType: 'notice', name: 'Second', content: template('School open as usual'), pageSize: 'full', expectedRevisionId: first.artifact.id });
      await expect(client.school.publishNotice({ ...scope, expectedVersion: draft.version, expectedTemplateRevisionId: first.artifact.id })).rejects.toMatchObject({ code: 'CONFLICT' });
      // Claiming the built-in design does not help either.
      await expect(client.school.publishNotice({ ...scope, expectedVersion: draft.version, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await eventsOf(draft.id)).toHaveLength(0);

      // Publishing with the revision of the current preview works and pins exactly that revision.
      const reviewedSecond = await preview(draft.id);
      expect(reviewedSecond.templateRevisionId).toBe(second.artifact.id);
      const published = await client.school.publishNotice({ ...scope, expectedVersion: reviewedSecond.version!, expectedTemplateRevisionId: reviewedSecond.templateRevisionId });
      expect(published).toMatchObject({ status: 'published', templateRevisionId: second.artifact.id });
      expect((await preview(draft.id)).html).toContain('School open as usual');
      // A published notice's preview names its pinned revision.
      expect(await preview(draft.id)).toMatchObject({ version: published.version, templateRevisionId: second.artifact.id });

      // A notice that is its own template is not printed inside the school's: its reviewed revision is null whatever is selected.
      const own = await client.school.createNotice({ ...base, bodyMode: 'template', body: '<h1>{{notice.title}}</h1>' });
      expect(await preview(own.id)).toMatchObject({ templateRevisionId: null });
      await expect(client.school.previewNoticePublish({ schoolId: school.id, noticeId: own.id })).resolves.toMatchObject({ kind: 'ready', templateRevisionId: null });
      await expect(client.school.publishNotice({ schoolId: school.id, noticeId: own.id, expectedVersion: own.version, expectedTemplateRevisionId: second.artifact.id })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(client.school.publishNotice({ schoolId: school.id, noticeId: own.id, expectedVersion: own.version, expectedTemplateRevisionId: null })).resolves.toMatchObject({ status: 'published', templateRevisionId: null });

      // Unsaved text is previewed with the current selection and has no version.
      await expect(client.school.previewNotice({ schoolId: school.id, source: { kind: 'unsaved', sessionId: session, title: 'T', bodyMode: 'plain', body: 'B' } })).resolves.toMatchObject({ version: null, templateRevisionId: second.artifact.id });
      // Input validation: the reviewed revision must be stated, as null or an id.
      const another = await client.school.createNotice(base);
      await expect(client.school.publishNotice({ schoolId: school.id, noticeId: another.id, expectedVersion: another.version } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(client.school.publishNotice({ schoolId: school.id, noticeId: another.id, expectedVersion: another.version, expectedTemplateRevisionId: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('refuses to publish a draft that no longer renders', async () => {
      const draft = await principal.school.createNotice(plain({ bodyMode: 'template', body: '<p>{{notice.title}}</p>' }));
      // A source saved by an older release that the renderer now rejects.
      await db.update(noticeTable).set({ body: '{{unknownHelper notice.title}}' }).where(eq(noticeTable.id, draft.id));
      await expect(principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, draft.id)))[0]).toMatchObject({ status: 'draft' });
      expect(await eventsOf(draft.id)).toHaveLength(0);
    });
  });

  describe('print size', () => {
    it('stores full A4 by default and the chosen size for both body modes', async () => {
      const byDefault = await teacher.school.createNotice(plain({ title: 'Default size' }));
      expect(byDefault.pageSize).toBe('full');
      const halfPlain = await teacher.school.createNotice(plain({ title: 'Half plain', pageSize: 'half' }));
      expect(halfPlain.pageSize).toBe('half');
      const halfTemplate = await teacher.school.createNotice(plain({ title: 'Half template', bodyMode: 'template', body: '<p class="{{print.size}}">{{notice.title}}</p>', pageSize: 'half' }));
      expect(halfTemplate.pageSize).toBe('half');
      await expect(teacher.school.createNotice(plain({ pageSize: 'a5' }))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await db.select({ pageSize: noticeTable.pageSize }).from(noticeTable).where(eq(noticeTable.id, halfPlain.id)))[0]).toEqual({ pageSize: 'half' });
    });

    it('previews at the notice\'s size and tells the template that size', async () => {
      const preview = await teacher.school.previewNotice({ schoolId, source: { kind: 'unsaved', ...plain({ pageSize: 'half' }) } as never });
      expect(preview.pageSize).toBe('half');
      expect(preview.html).toContain('size:210mm 148.5mm');
      expect(preview.html).toContain('notice--half');
      const custom = await teacher.school.previewNotice({ schoolId, source: { kind: 'unsaved', ...plain({ bodyMode: 'template', body: '<p class="size-{{print.size}}">x</p>', pageSize: 'half' }) } as never });
      expect(custom.html).toContain('class="size-half"');
    });

    it('treats a size change as an edit: it bumps the version, so a publisher never confirms a stale size', async () => {
      const draft = await teacher.school.createNotice(plain({ title: 'Resized' }));
      const reviewed = await principal.school.previewNoticePublish({ schoolId, noticeId: draft.id });
      expect(reviewed).toMatchObject({ kind: 'ready', version: draft.version, pageSize: 'full' });
      const resized = await teacher.school.updateNotice({ ...plain({ title: 'Resized', pageSize: 'half' }), noticeId: draft.id, expectedVersion: draft.version });
      expect(resized).toMatchObject({ pageSize: 'half', version: draft.version + 1 });
      await expect(principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(principal.school.previewNoticePublish({ schoolId, noticeId: draft.id })).resolves.toMatchObject({ kind: 'ready', pageSize: 'half' });
    });

    /**
     * Review round 4, R4-2: `pageSize` used to default on the update too, so
     * an update that left it out reset a half-A4 draft to full A4.
     */
    it('defaults the size of a new notice but requires it when a draft is replaced', async () => {
      const { pageSize: _omitted, ...withoutSize } = plain({ title: 'Sized' });
      const created = await teacher.school.createNotice(withoutSize);
      expect(created).toMatchObject({ pageSize: 'full' });
      const half = await teacher.school.updateNotice({ ...plain({ title: 'Sized', pageSize: 'half' }), noticeId: created.id, expectedVersion: created.version });
      const { pageSize: _dropped, ...replacementWithoutSize } = plain({ title: 'Sized again' });
      await expect(
        teacher.school.updateNotice({ ...replacementWithoutSize, noticeId: created.id, expectedVersion: half.version } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // Nothing was written: the draft is still half A4 at the same version.
      expect((await db.select().from(noticeTable).where(eq(noticeTable.id, created.id)))[0]).toMatchObject({ title: 'Sized', pageSize: 'half', version: half.version });
    });

    it('pins the size at publication: the notice, its preview and its cached PDF stay half A4, imposed two copies per A4 sheet', async () => {
      const draft = await principal.school.createNotice(plain({ title: 'Half notice', pageSize: 'half' }));
      const published = await principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null });
      expect(published).toMatchObject({ status: 'published', pageSize: 'half' });
      // A published notice is immutable: its size cannot be changed afterwards.
      await expect(principal.school.updateNotice({ ...plain({ title: 'Half notice', pageSize: 'full' }), noticeId: draft.id, expectedVersion: published.version })).rejects.toMatchObject({ code: 'CONFLICT' });
      const preview = await teacher.school.previewNotice({ schoolId, source: { kind: 'saved', noticeId: draft.id } });
      expect(preview).toMatchObject({ pageSize: 'half' });
      expect(preview.html).toContain('size:210mm 148.5mm');

      const download = await teacher.school.getNoticeDownload({ schoolId, noticeId: draft.id });
      const pdf = await PDFDocument.load(new Uint8Array(await (await fetch(download.url)).arrayBuffer()));
      // A short half-page notice is one half page: one A4 sheet carrying it twice.
      expect(pdf.getPageCount()).toBe(1);
      expect(Math.round(pdf.getPage(0).getSize().width)).toBe(595);
      expect(Math.round(pdf.getPage(0).getSize().height)).toBe(842);
      // The sheet draws Chromium's half page twice, at full size, one copy in each half, with no clipping (R4-3).
      const { placements, clips } = readPdfPageDrawing(pdf, 0);
      expect(clips).toBe(false);
      expect(placements).toHaveLength(2);
      expect(placements[1]!.object).toBe(placements[0]!.object);
      for (const placement of placements) {
        expect(placement.scaleX).toBeCloseTo(1, 1);
        expect(placement.scaleY).toBeCloseTo(1, 1);
      }
      expect(placements[0]!.y).toBeCloseTo(841.89 / 2, 0);
      expect(placements[1]!.y).toBeCloseTo(0, 0);
      // Cached under the half-size key only; no full-size object exists for it.
      await expect(getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: noticePdfKey(schoolId, draft.id, 'half') }))).resolves.toBeDefined();
      await expect(getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: noticePdfKey(schoolId, draft.id, 'full') }))).rejects.toBeDefined();
    });

    it('lets a long half-page notice continue on further half pages (one A4 sheet each) instead of clipping it', async () => {
      const paragraph = 'This paragraph is repeated to make the notice longer than half a printed page. '.repeat(6);
      const body = Array.from({ length: 12 }, (_, index) => `${index + 1}. ${paragraph}`).join('\n\n');
      const draft = await principal.school.createNotice(plain({ title: 'Long half notice', body, pageSize: 'half' }));
      await principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null });
      const download = await principal.school.getNoticeDownload({ schoolId, noticeId: draft.id });
      const pdf = await PDFDocument.load(new Uint8Array(await (await fetch(download.url)).arrayBuffer()));
      expect(pdf.getPageCount()).toBeGreaterThan(1);
      for (const page of pdf.getPages()) expect(Math.round(page.getSize().height)).toBe(842);
      const preview = await principal.school.previewNotice({ schoolId, source: { kind: 'saved', noticeId: draft.id } });
      expect(preview.html).toContain('12. This paragraph');
    });
  });

  describe('PDF download', () => {
    it('has no PDF for a draft', async () => {
      const draft = await principal.school.createNotice(plain());
      await expect(principal.school.getNoticeDownload({ schoolId, noticeId: draft.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('renders a published notice once, caches it under the school prefix and serves the same file to every reader', async () => {
      const draft = await principal.school.createNotice(plain({ title: 'Holiday list' }));
      await principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null });
      const key = noticePdfKey(schoolId, draft.id, 'full');
      await expect(getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))).rejects.toBeDefined();

      const download = await teacher.school.getNoticeDownload({ schoolId, noticeId: draft.id });
      expect(download.expiresIn).toBe(300);
      const response = await fetch(download.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('content-disposition')).toContain('Notice Holiday list.pdf');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      const page = pdf.getPage(0).getSize();
      expect(Math.round(page.width)).toBe(595);
      expect(Math.round(page.height)).toBe(842);

      const stored = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      const lastModified = stored.LastModified?.getTime();
      expect(Buffer.from(await stored.Body!.transformToByteArray()).equals(Buffer.from(bytes))).toBe(true);
      // A second request (another reader) reuses the cached object.
      await accountant.school.getNoticeDownload({ schoolId, noticeId: draft.id });
      const again = await getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      expect(again.LastModified?.getTime()).toBe(lastModified);
    });

    it('lets a long notice flow over several A4 pages instead of clipping it', async () => {
      const paragraph = 'This paragraph is repeated to make the notice longer than a single printed page. '.repeat(6);
      const body = Array.from({ length: 40 }, (_, index) => `${index + 1}. ${paragraph}`).join('\n\n');
      const draft = await principal.school.createNotice(plain({ title: 'Long notice', body }));
      await principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version, expectedTemplateRevisionId: null });
      const download = await principal.school.getNoticeDownload({ schoolId, noticeId: draft.id });
      const pdf = await PDFDocument.load(new Uint8Array(await (await fetch(download.url)).arrayBuffer()));
      expect(pdf.getPageCount()).toBeGreaterThan(1);
      for (const page of pdf.getPages()) {
        expect(Math.round(page.getSize().width)).toBe(595);
        expect(Math.round(page.getSize().height)).toBe(842);
      }
      const preview = await principal.school.previewNotice({ schoolId, source: { kind: 'saved', noticeId: draft.id } });
      expect(preview.html).toContain('40. This paragraph');
    });
  });
});
