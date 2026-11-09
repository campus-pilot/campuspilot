import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examLifecycleTable, examPlanTable, examResultTable } from '@campuspilot/db/schema/exam';
import { examResultPublicationTable } from '@campuspilot/db/schema/exam-result-publication';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { and, eq, like } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
} from '../../../test/fixtures';
import { dispatchNow } from '../../../test/notifications';
import { createReportCardDocumentSource } from '../documents/report-card';
import { studentResultEventKey, sweepResultPublications } from './results';
import { PDFDocument } from 'pdf-lib';

/** One school with two classes; class A has an approved and an unapproved student. */
describe('result notifications', () => {
  let schoolId: string, sessionId: string, classA: string, classB: string;
  let approvedStudent: string, pendingStudent: string, classBStudent: string;
  const admissionOf = new Map<string, string>();
  let principal: ReturnType<typeof createTestClient>, principalId: string;
  let accountant: ReturnType<typeof createTestClient>;
  let teacherA: ReturnType<typeof createTestClient>, teacherB: ReturnType<typeof createTestClient>;
  const exam = () => ({ schoolId, sessionId, examSlug: 'final' });
  const setStatus = (status: 'ready' | 'active' | 'completed') =>
    db.update(examLifecycleTable).set({ status }).where(and(eq(examLifecycleTable.sessionId, sessionId), eq(examLifecycleTable.examSlug, 'final')));

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: 'Results School' })).id;
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
    await db
      .update(schoolSessionTable)
      .set({ sessionConfig: { examConfig: { final: { name: 'Final examination', order: 1 } }, gradingScale: { a: { label: 'A', minScore: 0 } }, coScholasticAreas: {}, attendanceTracking: { enabled: false } } })
      .where(eq(schoolSessionTable.id, sessionId));
    classA = (await createTestClass({ schoolId, label: 'Grade 8' })).schoolClass.id;
    classB = (await createTestClass({ schoolId, label: 'Grade 9' })).schoolClass.id;
    const enroll = async (classId: string, name: string) => {
      const admissionId = (await createTestAdmission({ schoolId, name })).id;
      const enrollment = (await createTestStudent({ schoolId, sessionId, classId, admissionId })).id;
      admissionOf.set(enrollment, admissionId);
      return enrollment;
    };
    approvedStudent = await enroll(classA, 'Asha Approved');
    pendingStudent = await enroll(classA, 'Pranav Pending');
    classBStudent = await enroll(classB, 'Bela Other');
    for (const classId of [classA, classB]) {
      await db
        .update(classTable)
        .set({ config: { subjects: { math: { name: 'Mathematics', books: [], examModes: { written: { name: 'Written', percentage: 100 } } } } } })
        .where(eq(classTable.id, classId));
      const [plan] = await db
        .insert(examPlanTable)
        .values({ schoolId, sessionId, classId, examSlug: 'final', subjectSlug: 'math', totalMarks: 100, modeConfig: { written: { maxMarks: 100, percentage: 100 } }, status: 'active' })
        .returning();
      for (const studentId of classId === classA ? [approvedStudent, pendingStudent] : [classBStudent]) {
        await db.insert(examResultTable).values({ schoolId, sessionId, examPlanId: plan!.id, studentId, marks: { written: 75 }, approved: studentId !== pendingStudent });
      }
    }
    await db.insert(examLifecycleTable).values({ schoolId, sessionId, examSlug: 'final', status: 'active' });
    const principalSession = await createSchoolStaffSession(schoolId, [{ role: 'principal' }]);
    principal = createTestClient(principalSession.session);
    principalId = principalSession.user.id;
    accountant = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'accountant' }])).session);
    teacherA = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [classA] } }])).session);
    teacherB = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [classB] } }])).session);
  });

  it("renders one student's report card PDF with the selected template, never with unapproved results", async () => {
    const source = createReportCardDocumentSource();
    const context = { schoolId };
    await expect(source.available(context)).resolves.toBe(false);
    // Without a selected template the source says so, instead of "never producible".
    await expect(source.produce({ kind: 'report_card', sessionId, examSlug: 'final', filename: 'Report card.pdf', admissionId: admissionOf.get(approvedStudent)! }, context)).resolves.toBe('template_unavailable');
    const template = await principal.school.selectMarketplaceTemplate({ schoolId, documentType: 'report_card', slug: 'report_card-default', expectedRevisionId: null });
    await expect(source.available(context)).resolves.toBe(true);
    const request = { kind: 'report_card' as const, sessionId, examSlug: 'final', filename: 'Report card.pdf' };
    const document = await source.produce({ ...request, admissionId: admissionOf.get(approvedStudent)! }, context);
    expect(document).toMatchObject({ mimeType: 'application/pdf', templateRevisionId: template.artifact.id });
    if (!document || document === 'template_unavailable') throw new Error('Expected a report card PDF.');
    expect((await PDFDocument.load(document.bytes)).getPageCount()).toBe(1);
    await expect(source.produce({ ...request, admissionId: admissionOf.get(pendingStudent)! }, context)).resolves.toBeNull();
    await expect(source.produce({ ...request, admissionId: 'adm_unknown' }, context)).resolves.toBeNull();
  });

  it('sends one student result only for approved results, to assigned teachers and school roles', async () => {
    const one = { ...exam(), classId: classA, studentId: approvedStudent };
    await expect(teacherB.school.previewStudentResultNotification(one)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(teacherA.school.previewStudentResultNotification(one)).resolves.toMatchObject({
      recipientCount: 1,
      channels: { whatsapp: { owed: 0, skipped: { disabled: 1 } }, web_push: { owed: 0, skipped: { disabled: 1 } } },
    });
    await expect(teacherA.school.previewStudentResultNotification({ ...one, studentId: pendingStudent })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // The enrollment must belong to the class the permission was checked for.
    await expect(teacherA.school.previewStudentResultNotification({ ...exam(), classId: classA, studentId: classBStudent })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const key = randomUUID();
    await teacherA.school.sendStudentResultNotification({ ...one, idempotencyKey: key });
    await teacherA.school.sendStudentResultNotification({ ...one, idempotencyKey: key });
    await accountant.school.sendStudentResultNotification({ ...one, idempotencyKey: randomUUID() });
    const events = await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, schoolId), like(notificationEventTable.key, 'exam-result:%')));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'exam.results_published', data: { examSlug: 'final', examName: 'Final examination', studentName: 'Asha Approved' } });
    expect(events.every((event) => event.key.length <= 300)).toBe(true);

    // The longest client key fits, and concurrent retries of one press return the same event.
    const longKey = `${randomUUID()}${'k'.repeat(164)}`;
    await Promise.all([
      teacherA.school.sendStudentResultNotification({ ...one, idempotencyKey: longKey }),
      teacherA.school.sendStudentResultNotification({ ...one, idempotencyKey: longKey }),
    ]);
    const longEventKey = studentResultEventKey({ ...one, idempotencyKey: longKey }, admissionOf.get(approvedStudent)!);
    expect(await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.key, longEventKey)))).toHaveLength(1);
  });

  it('publishes a completed examination once, to every registered student, and notifies the publisher when settled', async () => {
    await expect(principal.school.previewExamResultPublication(exam())).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await db.update(examResultTable).set({ approved: true }).where(eq(examResultTable.studentId, pendingStudent));
    await setStatus('completed');
    await expect(teacherA.school.publishExamResults(exam())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(principal.school.getExamResultPublication(exam())).resolves.toBeNull();
    await expect(principal.school.previewExamResultPublication(exam())).resolves.toMatchObject({ recipientCount: 3 });

    const publication = await principal.school.publishExamResults(exam());
    expect(publication).toMatchObject({ examName: 'Final examination', publishedBy: principalId, finishedAt: null, outcome: null, snapshot: { recipientCount: 3, channels: { whatsapp: { skipped: { disabled: 3 } } } } });
    await expect(accountant.school.publishExamResults(exam())).rejects.toMatchObject({ code: 'CONFLICT' });
    const events = await db.select().from(notificationEventTable).where(like(notificationEventTable.key, `exam-results:${publication.id}:%`));
    expect(events).toHaveLength(3);

    // Not finished while the fan-outs are pending; finished once they settled.
    await sweepResultPublications();
    await expect(principal.school.getExamResultPublication(exam())).resolves.toMatchObject({ finishedAt: null });
    // Every check is recorded, so unsettled publications rotate behind unchecked ones.
    const [checked] = await db.select().from(examResultPublicationTable).where(eq(examResultPublicationTable.id, publication.id));
    expect(checked!.settleCheckedAt).toBeInstanceOf(Date);
    for (const event of events) await dispatchNow(event.id);
    await sweepResultPublications();
    const finished = await principal.school.getExamResultPublication(exam());
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished).toMatchObject({ outcome: { recipientCount: 3, sentCount: 0, skippedCount: 3, failedCount: 0 } });
    const [staffEvent] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.key, `exam-results-finished:${publication.id}`));
    expect(staffEvent).toMatchObject({ type: 'exam.results_publish_finished', recipients: { kind: 'staff_users', userIds: [principalId] }, data: { recipientCount: 3, skippedCount: 3 } });

    // Reopening retracts nothing; the publication stays recorded.
    await setStatus('active');
    await expect(db.select().from(examResultPublicationTable).where(eq(examResultPublicationTable.id, publication.id))).resolves.toHaveLength(1);
  });
});
