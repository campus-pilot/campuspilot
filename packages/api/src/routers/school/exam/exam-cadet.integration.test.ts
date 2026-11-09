import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import {
  examLifecycleTable,
  examPlanTable,
  examResultTable,
  examStudentAssessmentTable,
  examStudentRemarkTable,
} from '@campuspilot/db/schema/exam';
import { studentTable } from '@campuspilot/db/schema/student';
import { schoolTable } from '@campuspilot/db/schema/school';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  activateSession,
  createAdmissionWithLogin,
  createExamSession,
  createResultsSchool,
  createSubjectClass,
  enroll,
  runExam,
} from '../../../../test/exam-results';
import { expectRpcCode } from '../../../../test/finance/assertions';
import { createSchoolStaffSession, createTestClient, type TestClient } from '../../../../test/fixtures';

type Scope = { schoolId: string; sessionId: string; examSlug: string };

describe('Cadet Portal release and teacher remarks (staff procedures)', () => {
  let scope: Scope;
  let classId: string;
  let studentId: string;
  let principal: TestClient;
  let principalUserId: string;
  let teacher: TestClient;
  let accountant: TestClient;

  beforeEach(async () => {
    const school = await createResultsSchool();
    const principalSession = await createSchoolStaffSession(school.school.id, [{ role: 'principal', meta: null }]);
    principal = createTestClient(principalSession.session);
    principalUserId = principalSession.user.id;
    teacher = createTestClient((await createSchoolStaffSession(school.school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session);
    accountant = createTestClient((await createSchoolStaffSession(school.school.id, [{ role: 'accountant', meta: null }])).session);
    const sessionId = await createExamSession(school.school.id, 2026, { term: 'Term 1' }, { active: true });
    const placement = await createSubjectClass(school.school.id, 'Class 7', { maths: 'Mathematics' });
    classId = placement.classId;
    const { admission } = await createAdmissionWithLogin(principal, school.school.id, 'Asha Rao');
    studentId = (await enroll({ schoolId: school.school.id, admissionId: admission.id, sessionId, ...placement })).id;
    scope = { schoolId: school.school.id, sessionId, examSlug: 'term' };
  });

  async function completeExam() {
    await runExam(principal, scope, [{ classId, studentId, subjects: { maths: 72 } }], { complete: true });
  }

  describe('releaseExamToCadet / withdrawExamFromCadet', () => {
    it('requires a completed examination and records who released it and when', async () => {
      await expectRpcCode(principal.school.releaseExamToCadet(scope), 'BAD_REQUEST');
      await runExam(principal, scope, [{ classId, studentId, subjects: { maths: 72 } }]);
      // Active (results still editable) is not enough.
      await expectRpcCode(principal.school.releaseExamToCadet(scope), 'BAD_REQUEST');
      await principal.school.transitionExam({ ...scope, status: 'completed' });
      expect((await principal.school.getExamOverview(scope)).cadetReleasedAt).toBeNull();

      const released = await principal.school.releaseExamToCadet(scope);
      expect(released.status).toBe('completed');
      expect(released.cadetReleasedAt).toEqual(expect.any(String));
      const [row] = await db.select().from(examLifecycleTable).where(and(eq(examLifecycleTable.sessionId, scope.sessionId), eq(examLifecycleTable.examSlug, 'term')));
      expect(row!.cadetReleasedBy).toBe(principalUserId);
      expect(row!.cadetReleasedAt).toBeInstanceOf(Date);
      await expectRpcCode(principal.school.releaseExamToCadet(scope), 'BAD_REQUEST');
    });

    it('refuses to reopen while released and allows it after withdrawing', async () => {
      await completeExam();
      await principal.school.releaseExamToCadet(scope);
      await expectRpcCode(principal.school.transitionExam({ ...scope, status: 'active' }), 'BAD_REQUEST');

      const withdrawn = await principal.school.withdrawExamFromCadet(scope);
      expect(withdrawn.cadetReleasedAt).toBeNull();
      const [row] = await db.select().from(examLifecycleTable).where(eq(examLifecycleTable.sessionId, scope.sessionId));
      expect(row!.cadetReleasedBy).toBeNull();
      await expectRpcCode(principal.school.withdrawExamFromCadet(scope), 'BAD_REQUEST');
      await principal.school.transitionExam({ ...scope, status: 'active' });
      expect((await principal.school.getExamOverview(scope)).status).toBe('active');
    });

    it('releases an examination of a historical session without changing its data', async () => {
      await completeExam();
      const next = await createExamSession(scope.schoolId, 2027, { term: 'Term 1' }, { active: true });
      expect(next).not.toBe(scope.sessionId);
      expect((await principal.school.releaseExamToCadet(scope)).cadetReleasedAt).not.toBeNull();
      await activateSession(scope.schoolId, scope.sessionId);
    });

    it('is limited to exam governance roles and signed-in callers', async () => {
      await completeExam();
      await expectRpcCode(teacher.school.releaseExamToCadet(scope), 'FORBIDDEN');
      await expectRpcCode(accountant.school.releaseExamToCadet(scope), 'FORBIDDEN');
      await expectRpcCode(createTestClient(null).school.releaseExamToCadet(scope), 'UNAUTHORIZED');
      await principal.school.releaseExamToCadet(scope);
      await expectRpcCode(teacher.school.withdrawExamFromCadet(scope), 'FORBIDDEN');
      const other = await createResultsSchool();
      await expectRpcCode(other.principal.school.withdrawExamFromCadet(scope), 'FORBIDDEN');
    });

    it('refuses legacy plan changes while released', async () => {
      await completeExam();
      await principal.school.releaseExamToCadet(scope);
      const [plan] = await db.select().from(examPlanTable).where(eq(examPlanTable.sessionId, scope.sessionId));
      const planScope = { schoolId: scope.schoolId, sessionId: scope.sessionId, classId, examPlanId: plan!.id };
      await db.update(classTable).set({
        config: { subjects: {
          maths: { name: 'Mathematics', books: [], examModes: { written: { name: 'Written', percentage: 100 } } },
          english: { name: 'English', books: [], examModes: { written: { name: 'Written', percentage: 100 } } },
        } },
      }).where(eq(classTable.id, classId));
      await expectRpcCode(principal.school.createExamPlan({ ...scope, classId, subjectSlug: 'english' }), 'BAD_REQUEST');
      await expectRpcCode(principal.school.deleteExamPlan(planScope), 'BAD_REQUEST');
      await expectRpcCode(principal.school.transitionExamPlan({ ...planScope, status: 'active' }), 'BAD_REQUEST');
      await expectRpcCode(principal.school.updateExamPlan({ ...planScope, totalMarks: 50 }), 'BAD_REQUEST');
      expect(await db.select().from(examPlanTable).where(eq(examPlanTable.sessionId, scope.sessionId))).toEqual([plan]);

      await principal.school.withdrawExamFromCadet(scope);
      expect(await principal.school.createExamPlan({ ...scope, classId, subjectSlug: 'english' })).toMatchObject({ subjectSlug: 'english' });
    });

    it('validates input and unknown exams', async () => {
      await expectRpcCode(principal.school.releaseExamToCadet({ ...scope, examSlug: '' }), 'BAD_REQUEST');
      await expectRpcCode(principal.school.releaseExamToCadet({ ...scope, examSlug: 'missing' }), 'NOT_FOUND');
    });
  });

  describe('saveStudentExamRemark / getStudentExamRemark', () => {
    const studentScope = () => ({ ...scope, classId, studentId });

    it('needs a started examination, then saves text with its author and timestamps', async () => {
      await expectRpcCode(principal.school.saveStudentExamRemark({ ...studentScope(), text: 'Too early' }), 'BAD_REQUEST');
      await runExam(principal, scope, [{ classId, studentId, subjects: { maths: 72 } }]);
      expect(await teacher.school.getStudentExamRemark(studentScope())).toBeNull();

      const saved = await teacher.school.saveStudentExamRemark({ ...studentScope(), text: '  Steady progress in maths.  ' });
      expect(saved).toMatchObject({ text: 'Steady progress in maths.', authorName: expect.any(String) });
      const [row] = await db.select().from(examStudentRemarkTable).where(eq(examStudentRemarkTable.studentId, studentId));
      expect(row).toMatchObject({ schoolId: scope.schoolId, examSlug: 'term', text: 'Steady progress in maths.' });
      expect(row!.authorId).toBe(saved!.authorId);

      // Saving the same text keeps the original author and time.
      const same = await principal.school.saveStudentExamRemark({ ...studentScope(), text: 'Steady progress in maths.' });
      expect(same).toEqual(saved);
      const changed = await principal.school.saveStudentExamRemark({ ...studentScope(), text: 'Keep it up.' });
      expect(changed!.authorId).not.toBe(saved!.authorId);
      expect(changed!.createdAt).toBe(saved!.createdAt);
      expect(await accountant.school.getStudentExamRemark(studentScope())).toMatchObject({ text: 'Keep it up.' });

      expect(await principal.school.saveStudentExamRemark({ ...studentScope(), text: '   ' })).toBeNull();
      expect(await db.select().from(examStudentRemarkTable).where(eq(examStudentRemarkTable.studentId, studentId))).toHaveLength(0);
    });

    it('stays editable after completion but is frozen while released to the Cadet Portal', async () => {
      await completeExam();
      await principal.school.saveStudentExamRemark({ ...studentScope(), text: 'Written after completion.' });
      await principal.school.releaseExamToCadet(scope);
      await expectRpcCode(principal.school.saveStudentExamRemark({ ...studentScope(), text: 'Changed' }), 'BAD_REQUEST');
      await principal.school.withdrawExamFromCadet(scope);
      expect(await principal.school.saveStudentExamRemark({ ...studentScope(), text: 'Changed' })).toMatchObject({ text: 'Changed' });
    });

    it('refuses to delete an enrollment with results, an assessment or a remark, keeping the row', async () => {
      const remove = () => principal.school.deleteStudent({ schoolId: scope.schoolId, sessionId: scope.sessionId, studentId });
      const exists = async () => (await db.select().from(studentTable).where(eq(studentTable.id, studentId))).length === 1;
      await runExam(principal, scope, [{ classId, studentId, subjects: { maths: 72 } }]);
      // Results (and the shared assessment saved with them).
      await expectRpcCode(remove(), 'CONFLICT');
      expect(await exists()).toBe(true);
      // An assessment alone.
      await db.delete(examResultTable).where(eq(examResultTable.studentId, studentId));
      expect(await db.select().from(examStudentAssessmentTable).where(eq(examStudentAssessmentTable.studentId, studentId))).toHaveLength(1);
      await expectRpcCode(remove(), 'CONFLICT');
      expect(await exists()).toBe(true);
      // A remark alone.
      await principal.school.saveStudentExamRemark({ ...studentScope(), text: 'Keep it up.' });
      await db.delete(examStudentAssessmentTable).where(eq(examStudentAssessmentTable.studentId, studentId));
      await expectRpcCode(remove(), 'CONFLICT');
      expect(await exists()).toBe(true);
    });

    it('enforces permissions, input limits and the student scope', async () => {
      await runExam(principal, scope, [{ classId, studentId, subjects: { maths: 72 } }]);
      await expectRpcCode(accountant.school.saveStudentExamRemark({ ...studentScope(), text: 'No' }), 'FORBIDDEN');
      await expectRpcCode(createTestClient(null).school.getStudentExamRemark(studentScope()), 'UNAUTHORIZED');
      const other = await createResultsSchool();
      await expectRpcCode(other.principal.school.getStudentExamRemark(studentScope()), 'FORBIDDEN');
      await expectRpcCode(principal.school.saveStudentExamRemark({ ...studentScope(), text: 'x'.repeat(1001) }), 'BAD_REQUEST');
      await expectRpcCode(principal.school.saveStudentExamRemark({ ...studentScope(), studentId: 'missing', text: 'Hi' }), 'NOT_FOUND');
      await expectRpcCode(principal.school.getStudentExamRemark({ ...studentScope(), studentId: 'missing' }), 'NOT_FOUND');
    });
  });
});

describe('Cadet Portal settings', () => {
  it('defaults to hiding class averages and lets school details editors change it', async () => {
    const { school, principal } = await createResultsSchool();
    const teacher = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session);
    expect(await principal.school.getCadetPortalSettings({ schoolId: school.id })).toEqual({ schoolId: school.id, showClassAverages: false });

    expect(await principal.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: true })).toEqual({
      schoolId: school.id,
      showClassAverages: true,
    });
    const [row] = await db.select({ value: schoolTable.cadetShowClassAverages }).from(schoolTable).where(eq(schoolTable.id, school.id));
    expect(row!.value).toBe(true);

    await expectRpcCode(teacher.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: false }), 'FORBIDDEN');
    await expectRpcCode(createTestClient(null).school.getCadetPortalSettings({ schoolId: school.id }), 'UNAUTHORIZED');
    const other = await createResultsSchool();
    await expectRpcCode(other.principal.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: false }), 'FORBIDDEN');
    // @ts-expect-error showClassAverages is required
    await expectRpcCode(principal.school.updateCadetPortalSettings({ schoolId: school.id }), 'BAD_REQUEST');
  });
});
