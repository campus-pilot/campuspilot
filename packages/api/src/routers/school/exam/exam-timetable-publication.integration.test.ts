import { db } from '@campuspilot/db';
import { examLifecycleTable } from '@campuspilot/db/schema/exam';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { and, eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createAdmissionWithLogin,
  createExamSession,
  createResultsSchool,
  createSubjectClass,
  enroll,
} from '../../../../test/exam-results';
import { expectRpcCode } from '../../../../test/finance/assertions';
import { createSchoolStaffSession, createTestClient, setTestSchoolFeature, type TestClient } from '../../../../test/fixtures';
import { createCadetTestClient, signInCadet, type CadetCredentials } from '../../../../test/cadet';

/** Signs in through the Cadet Portal with the password the principal issued. */
async function cadetClient(credentials: CadetCredentials) {
  const { cookie, response } = await signInCadet(credentials);
  expect(response.status).toBe(200);
  return createCadetTestClient(new Headers({ cookie }));
}

type Scope = { schoolId: string; sessionId: string; examSlug: string };

/** Draft, publish and withdraw of an examination timetable, with its notifications. */
describe('exam timetable publication', () => {
  let scope: Scope;
  let classId: string;
  let studentCredentials: CadetCredentials;
  let principal: TestClient;
  let teacher: TestClient;
  let config: { columns: string[]; rows: { id: string; date: string; startTime: string; endTime: string; cells: Record<string, { subjectSlug: string; modeSlug: string }[]> }[] };

  const events = async (type: string) =>
    db
      .select()
      .from(notificationEventTable)
      .where(and(eq(notificationEventTable.schoolId, scope.schoolId), eq(notificationEventTable.type, type)));

  beforeEach(async () => {
    const school = await createResultsSchool({ features: ['cadet'] });
    principal = school.principal;
    teacher = createTestClient((await createSchoolStaffSession(school.school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session);
    const sessionId = await createExamSession(school.school.id, 2026, { term: 'Term 1' }, { active: true });
    const placement = await createSubjectClass(school.school.id, 'Class 7', { maths: 'Mathematics' });
    classId = placement.classId;
    const { admission, credentials } = await createAdmissionWithLogin(principal, school.school.id, 'Asha Rao');
    studentCredentials = credentials;
    await enroll({ schoolId: school.school.id, admissionId: admission.id, sessionId, ...placement });
    scope = { schoolId: school.school.id, sessionId, examSlug: 'term' };
    const preview = await principal.school.getExamPlanPreview(scope);
    await principal.school.generateExamPlan({ ...scope, configurationVersion: preview.configurationVersion });
    config = {
      columns: [classId],
      rows: [{ id: 'slot-1', date: '2026-10-20', startTime: '09:00', endTime: '10:00', cells: { [classId]: [{ subjectSlug: 'maths', modeSlug: 'written' }] } }],
    };
  });

  it('keeps a saved timetable as a draft until it is published', async () => {
    const saved = await principal.school.saveExamTimetable({ ...scope, config });
    expect(saved.publishedAt).toBeNull();
    expect(saved.publicationCount).toBe(0);
    expect(await events('exam.timetable_published')).toHaveLength(0);
  });

  it('publishes once, notifying staff and every registered student, and freezes the timetable', async () => {
    await expectRpcCode(principal.school.publishExamTimetable(scope), 'NOT_FOUND');
    await principal.school.saveExamTimetable({ ...scope, config });
    const preview = await principal.school.previewExamTimetablePublish(scope);
    expect(preview.staffRecipientCount).toBeGreaterThan(0);
    expect(preview.cadetForecast?.recipientCount).toBe(1);

    const published = await principal.school.publishExamTimetable(scope);
    expect(published.publishedAt).toEqual(expect.any(String));
    expect(published.publicationCount).toBe(1);
    expect(await events('exam.timetable_published')).toHaveLength(1);
    expect(await events('exam.timetable_published_staff')).toHaveLength(1);

    await expectRpcCode(principal.school.publishExamTimetable(scope), 'BAD_REQUEST');
    await expectRpcCode(principal.school.saveExamTimetable({ ...scope, config }), 'BAD_REQUEST');
    await expectRpcCode(principal.school.deleteExamTimetable(scope), 'BAD_REQUEST');
  });

  it('notifies only the staff while the Cadet Portal is off', async () => {
    await setTestSchoolFeature(scope.schoolId, 'cadet', false);
    await principal.school.saveExamTimetable({ ...scope, config });
    expect((await principal.school.previewExamTimetablePublish(scope)).cadetForecast).toBeNull();
    await principal.school.publishExamTimetable(scope);
    expect(await events('exam.timetable_published')).toHaveLength(0);
    expect(await events('exam.timetable_published_staff')).toHaveLength(1);
  });

  it('refuses to publish an empty timetable', async () => {
    await principal.school.saveExamTimetable({ ...scope, config: { columns: [classId], rows: [] } });
    await expectRpcCode(principal.school.publishExamTimetable(scope), 'BAD_REQUEST');
  });

  it('withdraws to a draft silently, allows editing, and notifies again when republished', async () => {
    await principal.school.saveExamTimetable({ ...scope, config });
    await principal.school.publishExamTimetable(scope);
    await expectRpcCode(principal.school.withdrawExamTimetable({ ...scope, examSlug: 'missing' }), 'NOT_FOUND');

    const draft = await principal.school.withdrawExamTimetable(scope);
    expect(draft.publishedAt).toBeNull();
    expect(draft.publishedBy).toBeNull();
    expect(draft.publicationCount).toBe(1);
    expect(await events('exam.timetable_published')).toHaveLength(1);
    await expectRpcCode(principal.school.withdrawExamTimetable(scope), 'BAD_REQUEST');

    await principal.school.saveExamTimetable({ ...scope, config });
    const republished = await principal.school.publishExamTimetable(scope);
    expect(republished.publicationCount).toBe(2);
    expect(await events('exam.timetable_published')).toHaveLength(2);
    expect(await db.select().from(notificationEventTable).where(like(notificationEventTable.key, 'exam-timetable:%:2:%'))).toHaveLength(1);
  });

  it('is closed once the examination has ended, but a published timetable stays published', async () => {
    await principal.school.saveExamTimetable({ ...scope, config });
    await principal.school.publishExamTimetable(scope);
    // The lifecycle is its own fact; completing through the procedures needs approved marks for every student.
    await db.insert(examLifecycleTable).values({ ...scope, status: 'completed' }).onConflictDoUpdate({
      target: [examLifecycleTable.sessionId, examLifecycleTable.examSlug],
      set: { status: 'completed' },
    });
    await expectRpcCode(principal.school.withdrawExamTimetable(scope), 'BAD_REQUEST');
    await expectRpcCode(principal.school.saveExamTimetable({ ...scope, config }), 'BAD_REQUEST');
    expect((await principal.school.getExamTimetable(scope))!.publishedAt).not.toBeNull();
  });

  it('refuses to draft or publish once the examination has ended', async () => {
    await principal.school.saveExamTimetable({ ...scope, config });
    await db.insert(examLifecycleTable).values({ ...scope, status: 'completed' }).onConflictDoUpdate({
      target: [examLifecycleTable.sessionId, examLifecycleTable.examSlug],
      set: { status: 'completed' },
    });
    await expectRpcCode(principal.school.publishExamTimetable(scope), 'BAD_REQUEST');
  });

  it('may be drafted and published while the examination is in progress', async () => {
    await principal.school.transitionExam({ ...scope, status: 'active' });
    await principal.school.saveExamTimetable({ ...scope, config });
    expect((await principal.school.publishExamTimetable(scope)).publishedAt).not.toBeNull();
  });

  it('is limited to the roles that manage the timetable', async () => {
    await principal.school.saveExamTimetable({ ...scope, config });
    await expectRpcCode(teacher.school.publishExamTimetable(scope), 'FORBIDDEN');
    await expectRpcCode(teacher.school.previewExamTimetablePublish(scope), 'FORBIDDEN');
    await expectRpcCode(teacher.school.withdrawExamTimetable(scope), 'FORBIDDEN');
    await expectRpcCode(createTestClient(null).school.publishExamTimetable(scope), 'UNAUTHORIZED');
  });

  it('shows an enrolled student the published timetable of every class, and nothing while it is a draft', async () => {
    const student = await cadetClient(studentCredentials);
    await principal.school.saveExamTimetable({ ...scope, config });
    await expectRpcCode(student.getTimetable(scope), 'NOT_FOUND');
    expect((await student.listTimetables({})).items).toHaveLength(0);

    await principal.school.publishExamTimetable(scope);
    const timetable = await student.getTimetable(scope);
    expect(timetable.examName).toBe('Term 1');
    expect(timetable.columns).toEqual([{ classId, label: 'Class 7' }]);
    expect(timetable.rows[0]!.entries[0]!.subjects).toEqual([{ subjectName: 'Mathematics', modeName: 'Written' }]);
    expect((await student.listTimetables({})).items.map((item) => item.examSlug)).toEqual(['term']);

    await principal.school.withdrawExamTimetable(scope);
    await expectRpcCode(student.getTimetable(scope), 'NOT_FOUND');
  });

  it('hides the timetable from a student who is not enrolled in its session', async () => {
    const { credentials } = await createAdmissionWithLogin(principal, scope.schoolId, 'Bela Rao');
    const outsider = await cadetClient(credentials);
    await principal.school.saveExamTimetable({ ...scope, config });
    await principal.school.publishExamTimetable(scope);
    await expectRpcCode(outsider.getTimetable(scope), 'NOT_FOUND');
    expect((await outsider.listTimetables({})).items).toHaveLength(0);
  });
});
