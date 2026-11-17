import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import {
  examClassTable,
  examPlanTable,
  examStudentAssessmentTable,
  examStudentRemarkTable,
  examTimetableTable,
} from '@campuspilot/db/schema/exam';
import { examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCadetTestClient, signInCadet, type CadetCredentials } from '../../../../test/cadet';
import {
  GRADING_SCALE,
  createAdmissionWithLogin,
  createExamSession,
  createResultsSchool,
  createSubjectClass,
  enroll,
} from '../../../../test/exam-results';
import { expectRpcCode } from '../../../../test/finance/assertions';
import { isSchoolSuspendedError } from '../../../school-access/school-access.contract';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClass,
  createTestClient,
  type TestClient,
} from '../../../../test/fixtures';
import { buildDocumentContexts } from '../document/document.context';
import { documentSourceSchema } from '../document/document.dto';
import { selectableExamClassIds } from './exam.dto';

type Scope = { schoolId: string; sessionId: string; examSlug: string };

/** Signs in through the Cadet Portal with the password the principal issued. */
async function cadetClient(credentials: CadetCredentials) {
  const { cookie, response } = await signInCadet(credentials);
  expect(response.status).toBe(200);
  return createCadetTestClient(new Headers({ cookie }));
}

/**
 * Which classes take part in an examination (CAM-14 / CAM-5): chosen when the
 * plan is generated, changeable later, and an excluded class appears nowhere
 * for that examination.
 *
 * Classes: Class 6 (`maths`), Class 7 (`maths`, `science`), each with one
 * enrolled student with a Cadet Portal login, and "Empty" without subjects.
 */
describe('exam class participation', () => {
  let scope: Scope;
  let principal: TestClient;
  let class6: { classId: string; sectionId: string };
  let class7: { classId: string; sectionId: string };
  let emptyClassId: string;
  let student6: string;
  let student7: string;
  let login6: CadetCredentials;
  let login7: CadetCredentials;
  let admission6: string;

  const planRows = () =>
    db
      .select()
      .from(examPlanTable)
      .where(and(eq(examPlanTable.sessionId, scope.sessionId), eq(examPlanTable.examSlug, scope.examSlug)));
  const participants = async () =>
    (
      await db
        .select({ classId: examClassTable.classId })
        .from(examClassTable)
        .where(and(eq(examClassTable.sessionId, scope.sessionId), eq(examClassTable.examSlug, scope.examSlug)))
    )
      .map((row) => row.classId)
      .sort();
  const generate = async (classIds: string[]) => {
    const preview = await principal.school.getExamPlanPreview(scope);
    return principal.school.generateExamPlan({ ...scope, configurationVersion: preview.configurationVersion, classIds });
  };
  const update = async (classIds: string[]) => {
    const preview = await principal.school.getExamPlanPreview(scope);
    return principal.school.updateExamClasses({ ...scope, configurationVersion: preview.configurationVersion, classIds });
  };
  const slot = (cells: Record<string, { subjectSlug: string; modeSlug: string }[]>) => ({
    id: 'slot-1',
    date: '2026-10-20',
    startTime: '09:00',
    endTime: '10:00',
    cells,
  });

  beforeEach(async () => {
    const school = await createResultsSchool({ features: ['cadet'] });
    principal = school.principal;
    const schoolId = school.school.id;
    const sessionId = await createExamSession(schoolId, 2026, { term: 'Term 1' }, { active: true });
    scope = { schoolId, sessionId, examSlug: 'term' };
    class6 = await createSubjectClass(schoolId, 'Class 6', { maths: 'Mathematics' });
    class7 = await createSubjectClass(schoolId, 'Class 7', { maths: 'Mathematics', science: 'Science' });
    emptyClassId = (await createTestClass({ schoolId, label: 'Empty' })).schoolClass.id;
    const asha = await createAdmissionWithLogin(principal, schoolId, 'Asha Rao');
    const ravi = await createAdmissionWithLogin(principal, schoolId, 'Ravi Kumar');
    login6 = asha.credentials;
    login7 = ravi.credentials;
    admission6 = asha.admission.id;
    student6 = (await enroll({ schoolId, admissionId: asha.admission.id, sessionId, ...class6 })).id;
    student7 = (await enroll({ schoolId, admissionId: ravi.admission.id, sessionId, ...class7 })).id;
  });

  describe('generation', () => {
    it('with every class that can take part creates the same plans as before, and records each class', async () => {
      const preview = await principal.school.getExamPlanPreview(scope);
      expect(preview.classes.map((entry) => entry.participating)).toEqual([false, false, false]);
      expect(selectableExamClassIds(preview).sort()).toEqual([class6.classId, class7.classId].sort());
      expect(await generate(selectableExamClassIds(preview))).toEqual({ createdCount: 3 });
      expect((await planRows()).map((plan) => `${plan.classId}:${plan.subjectSlug}`).sort()).toEqual(
        [`${class6.classId}:maths`, `${class7.classId}:maths`, `${class7.classId}:science`].sort(),
      );
      expect(await participants()).toEqual([class6.classId, class7.classId].sort());
      const after = await principal.school.getExamPlanPreview(scope);
      expect(after.classes.filter((entry) => entry.participating).map((entry) => entry.classId).sort()).toEqual(
        [class6.classId, class7.classId].sort(),
      );
      expect(after.configurationVersion).not.toBe(preview.configurationVersion);
    });

    it('refuses zero classes, a class without subjects and a class of another school without writing anything', async () => {
      const preview = await principal.school.getExamPlanPreview(scope);
      const base = { ...scope, configurationVersion: preview.configurationVersion };
      await expectRpcCode(principal.school.generateExamPlan({ ...base, classIds: [] }), 'BAD_REQUEST');
      await expectRpcCode(principal.school.generateExamPlan({ ...base, classIds: [class6.classId, class6.classId] }), 'BAD_REQUEST');
      await expect(principal.school.generateExamPlan({ ...base, classIds: [class6.classId, emptyClassId] })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Empty has no subjects configured, so it cannot take part. Deselect it or add subjects in class settings.',
      });
      await expectRpcCode(principal.school.generateExamPlan({ ...base, classIds: ['not-a-class'] }), 'BAD_REQUEST');
      expect(await planRows()).toHaveLength(0);
      expect(await participants()).toEqual([]);
    });

    it('leaves an excluded class out of plans, result entry, the exam context, the timetable, documents and the Cadet Portal', async () => {
      expect(await generate([class6.classId])).toEqual({ createdCount: 1 });
      expect((await planRows()).map((plan) => plan.classId)).toEqual([class6.classId]);
      expect(await participants()).toEqual([class6.classId]);
      expect((await principal.school.getExamOverview(scope)).planCount).toBe(1);

      // Result entry
      const classes = await principal.school.listExamClasses(scope);
      expect(classes.items.map((entry) => entry.classId)).toEqual([class6.classId]);
      await principal.school.transitionExam({ ...scope, status: 'active' });
      await expectRpcCode(principal.school.getStudentExam({ ...scope, classId: class7.classId, studentId: student7 }), 'NOT_FOUND');
      expect((await principal.school.getStudentExam({ ...scope, classId: class6.classId, studentId: student6 })).subjects).toHaveLength(1);

      // The exam context (timetable editor columns) and the timetable itself
      expect((await principal.school.getExamContext(scope)).classes.map((entry) => entry.id)).toEqual([class6.classId]);
      await expect(
        principal.school.saveExamTimetable({
          ...scope,
          config: { columns: [class6.classId, class7.classId], rows: [slot({ [class7.classId]: [{ subjectSlug: 'maths', modeSlug: 'written' }] })] },
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Every timetable column must be a class taking part in this examination.' });
      await principal.school.saveExamTimetable({
        ...scope,
        config: { columns: [class6.classId], rows: [slot({ [class6.classId]: [{ subjectSlug: 'maths', modeSlug: 'written' }] })] },
      });

      // Documents: the exam-wide admit cards and timetable cover Class 6 only; Class 7 is refused.
      const admit = await buildDocumentContexts(db, scope.schoolId, { documentType: 'admit_card', sessionId: scope.sessionId, examSlug: scope.examSlug });
      expect(admit.studentIds).toEqual([student6]);
      await expect(
        buildDocumentContexts(db, scope.schoolId, { documentType: 'admit_card', sessionId: scope.sessionId, examSlug: scope.examSlug, classId: class7.classId }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'This class does not take part in this examination.' });
      await expect(
        buildDocumentContexts(
          db,
          scope.schoolId,
          documentSourceSchema.parse({ documentType: 'report_card', sessionId: scope.sessionId, examSlug: scope.examSlug, classId: class7.classId }),
        ),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'This class does not take part in this examination.' });
      const timetable = await buildDocumentContexts(db, scope.schoolId, { documentType: 'timetable', sessionId: scope.sessionId, examSlug: scope.examSlug });
      expect((timetable.contexts[0] as { columns: { classId: string }[] }).columns.map((column) => column.classId)).toEqual([class6.classId]);

      // Exam-wide report cards cover Class 6 only.
      await principal.school.saveStudentExam({
        ...scope,
        classId: class6.classId,
        studentId: student6,
        approved: true,
        daysAttended: null,
        coScholastics: null,
        subjects: (await principal.school.getStudentExam({ ...scope, classId: class6.classId, studentId: student6 })).subjects.map(({ plan }) => ({
          examPlanId: plan.id,
          marks: { written: 70 },
        })),
      });
      const reports = await buildDocumentContexts(
        db,
        scope.schoolId,
        documentSourceSchema.parse({ documentType: 'report_card', sessionId: scope.sessionId, examSlug: scope.examSlug }),
      );
      expect(reports.studentIds).toEqual([student6]);

      // Cadet Portal: publishing notifies only the Class 6 student; the Class 7
      // student does not sit the exam, so neither the exam nor its timetable is
      // theirs, and the Class 6 student's timetable has no Class 7 column.
      expect((await principal.school.previewExamTimetablePublish(scope)).cadetForecast?.recipientCount).toBe(1);
      await principal.school.publishExamTimetable(scope);
      const notified = await db
        .select({ data: notificationEventTable.data })
        .from(notificationEventTable)
        .where(and(eq(notificationEventTable.schoolId, scope.schoolId), eq(notificationEventTable.type, 'exam.timetable_published')));
      expect(notified.map((event) => event.data.admissionId)).toEqual([admission6]);
      const ravi = await cadetClient(login7);
      expect((await ravi.listExams({})).items.map((exam) => exam.examSlug)).not.toContain('term');
      expect((await ravi.listTimetables({ limit: 10 })).items).toEqual([]);
      await expectRpcCode(ravi.getTimetable({ sessionId: scope.sessionId, examSlug: scope.examSlug }), 'NOT_FOUND');
      const asha = await cadetClient(login6);
      expect((await asha.listTimetables({ limit: 10 })).items.map((item) => item.examSlug)).toEqual(['term']);
      const published = await asha.getTimetable({ sessionId: scope.sessionId, examSlug: scope.examSlug });
      expect(published.columns.map((column) => column.classId)).toEqual([class6.classId]);
    });
  });

  describe('updateExamClasses', () => {
    it('adds a class back from its class settings and removes it again', async () => {
      await generate([class6.classId]);
      expect(await update([class6.classId, class7.classId])).toEqual({
        addedClassIds: [class7.classId],
        removedClassIds: [],
        createdPlanCount: 2,
        deletedPlanCount: 0,
      });
      expect(await participants()).toEqual([class6.classId, class7.classId].sort());
      expect((await planRows()).filter((plan) => plan.classId === class7.classId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ subjectSlug: 'maths', status: 'draft', totalMarks: 100, modeConfig: { written: { percentage: 100, maxMarks: 100 } } }),
          expect.objectContaining({ subjectSlug: 'science', status: 'draft' }),
        ]),
      );
      // An empty draft timetable column is dropped with the class.
      await principal.school.saveExamTimetable({
        ...scope,
        config: { columns: [class6.classId, class7.classId], rows: [slot({ [class6.classId]: [{ subjectSlug: 'maths', modeSlug: 'written' }] })] },
      });
      expect(await update([class6.classId])).toEqual({
        addedClassIds: [],
        removedClassIds: [class7.classId],
        createdPlanCount: 0,
        deletedPlanCount: 2,
      });
      expect(await participants()).toEqual([class6.classId]);
      expect((await planRows()).map((plan) => plan.classId)).toEqual([class6.classId]);
      expect((await principal.school.getExamTimetable(scope))!.config.columns).toEqual([class6.classId]);
      expect((await principal.school.listExamClasses(scope)).items.map((entry) => entry.classId)).toEqual([class6.classId]);
    });

    it('opens the plans of a class added to a started examination for result entry', async () => {
      await generate([class6.classId]);
      await principal.school.transitionExam({ ...scope, status: 'active' });
      await update([class6.classId, class7.classId]);
      expect((await planRows()).filter((plan) => plan.classId === class7.classId).map((plan) => plan.status)).toEqual(['active', 'active']);
      const workspace = await principal.school.getStudentExam({ ...scope, classId: class7.classId, studentId: student7 });
      await principal.school.saveStudentExam({
        ...scope,
        classId: class7.classId,
        studentId: student7,
        approved: false,
        daysAttended: null,
        coScholastics: null,
        subjects: workspace.subjects.map(({ plan }) => ({ examPlanId: plan.id, marks: { written: 50 } })),
      });
      // A class with saved results cannot be removed.
      await expect(update([class6.classId])).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Class 7 has saved results in this examination, so it cannot be removed.',
      });
      expect(await participants()).toEqual([class6.classId, class7.classId].sort());
    });

    it('refuses removing a class the timetable schedules or a published timetable includes, or that has question papers', async () => {
      await generate([class6.classId, class7.classId]);
      const scheduled = {
        columns: [class6.classId, class7.classId],
        rows: [slot({ [class6.classId]: [{ subjectSlug: 'maths', modeSlug: 'written' }], [class7.classId]: [{ subjectSlug: 'science', modeSlug: 'written' }] })],
      };
      await principal.school.saveExamTimetable({ ...scope, config: scheduled });
      await expect(update([class6.classId])).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: "The draft timetable schedules papers for Class 7. Remove the class's column from the timetable before removing the class.",
      });
      await principal.school.saveExamTimetable({
        ...scope,
        config: { columns: scheduled.columns, rows: [slot({ [class6.classId]: [{ subjectSlug: 'maths', modeSlug: 'written' }] })] },
      });
      await principal.school.publishExamTimetable(scope);
      await expect(update([class6.classId])).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: "The published timetable includes Class 7. Withdraw the timetable to a draft and remove the class's column before removing the class.",
      });
      await principal.school.withdrawExamTimetable(scope);
      await principal.school.deleteExamTimetable(scope);
      await db.insert(examQuestionPaperTable).values({ ...scope, classId: class7.classId, subjectSlug: 'science', modeSlug: 'written' });
      await expect(update([class6.classId])).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Class 7 has question papers in this examination. Delete them before removing the class.',
      });
      expect(await participants()).toEqual([class6.classId, class7.classId].sort());
      expect(await planRows()).toHaveLength(3);
      expect(await db.select().from(examTimetableTable).where(eq(examTimetableTable.sessionId, scope.sessionId))).toHaveLength(0);
    });

    it('refuses zero classes, a stale review, an exam without a plan and an ended exam', async () => {
      await expectRpcCode(update([class6.classId]), 'BAD_REQUEST');
      await generate([class6.classId]);
      const preview = await principal.school.getExamPlanPreview(scope);
      await expectRpcCode(principal.school.updateExamClasses({ ...scope, configurationVersion: preview.configurationVersion, classIds: [] }), 'BAD_REQUEST');
      await expect(
        principal.school.updateExamClasses({ ...scope, configurationVersion: preview.configurationVersion, classIds: [class6.classId, emptyClassId] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await update([class6.classId, class7.classId]);
      // The review predates the change of participation.
      await expectRpcCode(
        principal.school.updateExamClasses({ ...scope, configurationVersion: preview.configurationVersion, classIds: [class6.classId] }),
        'CONFLICT',
      );
      await principal.school.transitionExam({ ...scope, status: 'active' });
      for (const [classId, studentId] of [[class6.classId, student6], [class7.classId, student7]] as const) {
        const workspace = await principal.school.getStudentExam({ ...scope, classId, studentId });
        await principal.school.saveStudentExam({
          ...scope,
          classId,
          studentId,
          approved: true,
          daysAttended: null,
          coScholastics: null,
          subjects: workspace.subjects.map(({ plan }) => ({ examPlanId: plan.id, marks: { written: 70 } })),
        });
      }
      await principal.school.transitionExam({ ...scope, status: 'completed' });
      await expect(update([class6.classId, class7.classId, emptyClassId])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(update([class6.classId])).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'This examination has ended, so the classes taking part can no longer change. Reopen it first.',
      });
    });

    it("refuses removing a class whose students have saved attendance, activities or remarks", async () => {
      await generate([class6.classId, class7.classId]);
      const refusal = {
        code: 'BAD_REQUEST',
        message: 'Class 7 has saved attendance, activities or remarks in this examination, so it cannot be removed.',
      };
      await db.insert(examStudentAssessmentTable).values({ ...scope, studentId: student7, daysAttended: null, approved: false });
      await expect(update([class6.classId])).rejects.toMatchObject(refusal);
      await db.delete(examStudentAssessmentTable).where(eq(examStudentAssessmentTable.studentId, student7));
      await db.insert(examStudentRemarkTable).values({ ...scope, studentId: student7, text: 'Well done.' });
      await expect(update([class6.classId])).rejects.toMatchObject(refusal);
      expect(await participants()).toEqual([class6.classId, class7.classId].sort());
      await db.delete(examStudentRemarkTable).where(eq(examStudentRemarkTable.studentId, student7));
      expect((await update([class6.classId])).removedClassIds).toEqual([class7.classId]);
    });

    it('refuses any change while the results are released to the Cadet Portal', async () => {
      await generate([class6.classId]);
      await principal.school.transitionExam({ ...scope, status: 'active' });
      const workspace = await principal.school.getStudentExam({ ...scope, classId: class6.classId, studentId: student6 });
      await principal.school.saveStudentExam({
        ...scope,
        classId: class6.classId,
        studentId: student6,
        approved: true,
        daysAttended: null,
        coScholastics: null,
        subjects: workspace.subjects.map(({ plan }) => ({ examPlanId: plan.id, marks: { written: 70 } })),
      });
      await principal.school.transitionExam({ ...scope, status: 'completed' });
      await principal.school.releaseExamToCadet(scope);
      await expect(update([class6.classId, class7.classId])).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'These results are released to the Cadet Portal. Withdraw them from the Cadet Portal before changing the examination plans.',
      });
      expect(await participants()).toEqual([class6.classId]);
    });

    it('is refused for a suspended school', async () => {
      await generate([class6.classId]);
      const preview = await principal.school.getExamPlanPreview(scope);
      await createTestClient(await createAdminSession()).systemAdmin.suspendSchool({ id: scope.schoolId, reason: 'Unpaid' });
      const error = await principal.school
        .updateExamClasses({ ...scope, configurationVersion: preview.configurationVersion, classIds: [class6.classId, class7.classId] })
        .catch((caught: unknown) => caught);
      expect(isSchoolSuspendedError(error)).toBe(true);
      expect(await participants()).toEqual([class6.classId]);
    });

    it('is limited to school exam administrators of the school', async () => {
      await generate([class6.classId]);
      const preview = await principal.school.getExamPlanPreview(scope);
      const input = { ...scope, configurationVersion: preview.configurationVersion, classIds: [class6.classId, class7.classId] };
      for (const role of ['teacher', 'accountant'] as const) {
        const client = createTestClient((await createSchoolStaffSession(scope.schoolId, [{ role, meta: role === 'teacher' ? { classIds: [] } : null }])).session);
        await expectRpcCode(client.school.updateExamClasses(input), 'FORBIDDEN');
      }
      const other = await createResultsSchool();
      await expectRpcCode(other.principal.school.updateExamClasses(input), 'FORBIDDEN');
      await expectRpcCode(createTestClient(await createRegularUserSession()).school.updateExamClasses(input), 'FORBIDDEN');
      await expectRpcCode(createTestClient(null).school.updateExamClasses(input), 'UNAUTHORIZED');
      const coordinator = createTestClient((await createSchoolStaffSession(scope.schoolId, [{ role: 'exam_coordinator' }])).session);
      expect((await coordinator.school.updateExamClasses(input)).addedClassIds).toEqual([class7.classId]);
    });
  });

  it('removes the class selection with the exam and keeps a class taking part after its last legacy plan is deleted', async () => {
    const plan = await principal.school.createExamPlan({ ...scope, classId: class6.classId, subjectSlug: 'maths' });
    expect(await participants()).toEqual([class6.classId]);
    await principal.school.deleteExamPlan({ schoolId: scope.schoolId, sessionId: scope.sessionId, classId: class6.classId, examPlanId: plan.id });
    expect(await participants()).toEqual([class6.classId]);
    expect((await principal.school.listExamClasses(scope)).items).toEqual([]);
    await principal.school.deleteExam(scope);
    expect(await participants()).toEqual([]);
  });

  it('generating the plan records exactly the chosen classes, even after a class kept taking part without plans', async () => {
    // Class 7 keeps taking part after its last single subject plan is deleted.
    const plan = await principal.school.createExamPlan({ ...scope, classId: class7.classId, subjectSlug: 'science' });
    await principal.school.deleteExamPlan({ schoolId: scope.schoolId, sessionId: scope.sessionId, classId: class7.classId, examPlanId: plan.id });
    expect(await participants()).toEqual([class7.classId]);
    // Generating without it leaves it out ...
    expect(await generate([class6.classId])).toEqual({ createdCount: 1 });
    expect(await participants()).toEqual([class6.classId]);
  });

  it('generating the plan keeps a chosen class already recorded as taking part', async () => {
    const plan = await principal.school.createExamPlan({ ...scope, classId: class7.classId, subjectSlug: 'science' });
    await principal.school.deleteExamPlan({ schoolId: scope.schoolId, sessionId: scope.sessionId, classId: class7.classId, examPlanId: plan.id });
    expect(await generate([class6.classId, class7.classId])).toEqual({ createdCount: 3 });
    expect(await participants()).toEqual([class6.classId, class7.classId].sort());
  });

  it('refuses deleting a class that takes part in an examination, with a clear reason', async () => {
    const plan = await principal.school.createExamPlan({ ...scope, classId: class7.classId, subjectSlug: 'science' });
    await principal.school.deleteExamPlan({ schoolId: scope.schoolId, sessionId: scope.sessionId, classId: class7.classId, examPlanId: plan.id });
    await expect(principal.school.deleteClass({ schoolId: scope.schoolId, classId: class7.classId })).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        "Class 7 takes part in an examination. Remove it from that examination's classes (examination Settings, Classes taking part) before deleting it.",
    });
    expect(await db.select({ id: classTable.id }).from(classTable).where(eq(classTable.id, class7.classId))).toHaveLength(1);
  });

  it('removes the class selection of an exam dropped through a session configuration replacement', async () => {
    const plan = await principal.school.createExamPlan({ ...scope, classId: class7.classId, subjectSlug: 'science' });
    await principal.school.deleteExamPlan({ schoolId: scope.schoolId, sessionId: scope.sessionId, classId: class7.classId, examPlanId: plan.id });
    expect(await participants()).toEqual([class7.classId]);
    await principal.school.updateSession({
      schoolId: scope.schoolId,
      sessionId: scope.sessionId,
      sessionConfig: { examConfig: {}, coScholasticAreas: {}, gradingScale: GRADING_SCALE, attendanceTracking: { enabled: false } },
    });
    expect(await participants()).toEqual([]);
  });
});
