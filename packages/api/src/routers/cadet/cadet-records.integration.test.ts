import { db } from '@campuspilot/db';
import { studentTable } from '@campuspilot/db/schema/student';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { examResultTable, examStudentAssessmentTable } from '@campuspilot/db/schema/exam';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { createRouterClient } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { connectCadetMcp, createCadetTestClient, signInCadet } from '../../../test/cadet';
import {
  createAdmissionWithLogin,
  createExamSession,
  createResultsSchool,
  createSubjectClass,
  enroll,
  runExam,
} from '../../../test/exam-results';
import { createFinanceIdempotencyKey } from '../../../test/finance/factories';
import { expectRpcCode, retryFinanceConflict } from '../../../test/finance/assertions';
import { createFinanceScenario } from '../../../test/finance/scenario';
import { createTestAdmission, createTestStudent, type TestClient } from '../../../test/fixtures';
import { createCadetOAuthContext } from '../../cadet/context';
import type { CadetCredentials } from '../../../test/cadet';
import { cadetRouter, type CadetRouterClient } from './cadet.router';

async function cadetClient(credentials: CadetCredentials): Promise<CadetRouterClient> {
  const { cookie, response } = await signInCadet(credentials);
  expect(response.status).toBe(200);
  return createCadetTestClient(new Headers({ cookie }));
}

/**
 * Two classmates, Meera and Ravi, across two sessions:
 * - 2025–26 in "Class 6" (subjects `maths` "Maths", `sanskrit`): Unit Test 1
 *   and Annual, both released.
 * - 2026–27 in "Class 7" (subjects `maths` "Mathematics", `science`): Unit
 *   Test 1 and Half-Yearly released, Annual completed but not released,
 *   Weekly started, Final not planned.
 * Class 6 and Class 7 deliberately reuse the slug `maths`.
 */
describe('cadet results, growth and remarks', () => {
  let principal: TestClient;
  let schoolId: string;
  let meera: CadetRouterClient;
  let ravi: CadetRouterClient;
  let current: { sessionId: string; classId: string; meera: string; ravi: string };
  let past: { sessionId: string; classId: string; meera: string; ravi: string };

  beforeAll(async () => {
    const created = await createResultsSchool();
    principal = created.principal;
    schoolId = created.school.id;
    const meeraLogin = await createAdmissionWithLogin(principal, schoolId, 'Meera Singh');
    const raviLogin = await createAdmissionWithLogin(principal, schoolId, 'Ravi Kumar');

    const pastSessionId = await createExamSession(schoolId, 2025, { ut1: 'Unit Test 1', annual: 'Annual' }, { active: true });
    const class6 = await createSubjectClass(schoolId, 'Class 6', { maths: 'Maths', sanskrit: 'Sanskrit' });
    past = {
      sessionId: pastSessionId,
      classId: class6.classId,
      meera: (await enroll({ schoolId, admissionId: meeraLogin.admission.id, sessionId: pastSessionId, ...class6, rollNo: 1 })).id,
      ravi: (await enroll({ schoolId, admissionId: raviLogin.admission.id, sessionId: pastSessionId, ...class6, rollNo: 2 })).id,
    };
    const pastScope = (examSlug: string) => ({ schoolId, sessionId: pastSessionId, examSlug });
    await runExam(principal, pastScope('ut1'), [
      { classId: past.classId, studentId: past.meera, subjects: { maths: 60, sanskrit: 70 } },
      { classId: past.classId, studentId: past.ravi, subjects: { maths: 40, sanskrit: 50 } },
    ], { complete: true });
    await runExam(principal, pastScope('annual'), [
      { classId: past.classId, studentId: past.meera, subjects: { maths: 70, sanskrit: 80 } },
      { classId: past.classId, studentId: past.ravi, subjects: { maths: 50, sanskrit: 60 } },
    ], { complete: true });
    await principal.school.saveStudentExamRemark({ ...pastScope('annual'), classId: past.classId, studentId: past.meera, text: 'Promoted with distinction.' });
    await principal.school.releaseExamToCadet(pastScope('ut1'));
    await principal.school.releaseExamToCadet(pastScope('annual'));

    const currentSessionId = await createExamSession(
      schoolId,
      2026,
      { ut1: 'Unit Test 1', hy: 'Half-Yearly', annual: 'Annual', weekly: 'Weekly', final: 'Final' },
      { active: true, coScholastic: true },
    );
    const class7 = await createSubjectClass(schoolId, 'Class 7', { maths: 'Mathematics', science: 'Science' });
    current = {
      sessionId: currentSessionId,
      classId: class7.classId,
      meera: (await enroll({ schoolId, admissionId: meeraLogin.admission.id, sessionId: currentSessionId, ...class7, rollNo: 1 })).id,
      ravi: (await enroll({ schoolId, admissionId: raviLogin.admission.id, sessionId: currentSessionId, ...class7, rollNo: 2 })).id,
    };
    const scope = (examSlug: string) => ({ schoolId, sessionId: currentSessionId, examSlug });
    const marks = (meeraMarks: Record<string, number>, raviMarks: Record<string, number>) => [
      { classId: current.classId, studentId: current.meera, subjects: meeraMarks, coScholastics: { art: 'A' } },
      { classId: current.classId, studentId: current.ravi, subjects: raviMarks, coScholastics: { art: 'B' } },
    ];
    await runExam(principal, scope('ut1'), marks({ maths: 70, science: 80 }, { maths: 50, science: 60 }), { complete: true });
    await runExam(principal, scope('hy'), marks({ maths: 90, science: 70 }, { maths: 60, science: 80 }), { complete: true });
    await runExam(principal, scope('annual'), marks({ maths: 99, science: 99 }, { maths: 10, science: 10 }), { complete: true });
    await runExam(principal, scope('weekly'), []);
    const remark = (examSlug: string, studentId: string, text: string) =>
      principal.school.saveStudentExamRemark({ ...scope(examSlug), classId: current.classId, studentId, text });
    await remark('hy', current.meera, 'Great half-year.');
    await remark('hy', current.ravi, 'Ravi needs practice.');
    await remark('annual', current.meera, 'Secret until release.');
    await principal.school.releaseExamToCadet(scope('ut1'));
    await principal.school.releaseExamToCadet(scope('hy'));

    meera = await cadetClient(meeraLogin.credentials);
    ravi = await cadetClient(raviLogin.credentials);
  }, 120_000);

  const recordOf = (studentId: string, classId: string) => `${studentId}.${classId}`;
  const examOf = (studentId: string, classId: string, slug: string) => `${recordOf(studentId, classId)}.${slug}`;
  const setAverages = (showClassAverages: boolean) => principal.school.updateCadetPortalSettings({ schoolId, showClassAverages });

  it('getProfile returns the student and their enrollments, newest first', async () => {
    const profile = await meera.getProfile();
    expect(profile).toMatchObject({ name: 'Meera Singh', enrollments: [
      { sessionLabel: '2026–27', classLabel: 'Class 7', rollNo: 1, sessionIsActive: true },
      { sessionLabel: '2025–26', classLabel: 'Class 6', rollNo: 1, sessionIsActive: false },
    ] });
    expect(profile.enrollments.map((row) => row.studentId)).toEqual([current.meera, past.meera]);
    // The server's current class, the same one listExams and getGrowth default to.
    expect(profile.current).toEqual({ recordId: recordOf(current.meera, current.classId), classLabel: 'Class 7', sectionLabel: expect.any(String), sessionLabel: '2026–27', rollNo: 1 });
  });

  it('listExams shows released scores only and an explicit awaiting state', async () => {
    const exams = await meera.listExams({});
    expect(exams.record).toMatchObject({ recordId: recordOf(current.meera, current.classId), classLabel: 'Class 7', sessionLabel: '2026–27' });
    expect(exams.items.map(({ examSlug, state, percentage, grade }) => ({ examSlug, state, percentage, grade }))).toEqual([
      { examSlug: 'ut1', state: 'released', percentage: 75, grade: 'B' },
      { examSlug: 'hy', state: 'released', percentage: 80, grade: 'A' },
      { examSlug: 'annual', state: 'awaiting_release', percentage: null, grade: null },
      { examSlug: 'weekly', state: 'in_progress', percentage: null, grade: null },
      { examSlug: 'final', state: 'upcoming', percentage: null, grade: null },
    ]);
    expect(exams.items[2]!.releasedAt).toBeNull();
    expect(exams.pagination).toMatchObject({ totalItems: 5, currentPage: 1 });
    const pastExams = await meera.listExams({ filters: { recordId: recordOf(past.meera, past.classId) } });
    expect(pastExams.items.map((exam) => [exam.examSlug, exam.percentage])).toEqual([['ut1', 65], ['annual', 75]]);
  });

  it('getExamResult returns marks, the previous exam of the same class, remark and activities without averages by default', async () => {
    await setAverages(false);
    const result = await meera.getExamResult({ examId: examOf(current.meera, current.classId, 'hy') });
    expect(result).toMatchObject({
      name: 'Half-Yearly',
      classLabel: 'Class 7',
      sessionLabel: '2026–27',
      overall: { obtained: 160, max: 200, percentage: 80, grade: 'A' },
      previousExam: { examId: examOf(current.meera, current.classId, 'ut1'), name: 'Unit Test 1', percentage: 75 },
      classAveragePercentage: null,
      coScholastics: [{ area: 'Art', grade: 'A' }],
      remark: { text: 'Great half-year.', authorName: expect.any(String) },
    });
    expect(result.subjects.map(({ name, obtained, max, grade, previousPercentage, classAveragePercentage }) => ({ name, obtained, max, grade, previousPercentage, classAveragePercentage }))).toEqual([
      { name: 'Mathematics', obtained: 90, max: 100, grade: 'A', previousPercentage: 70, classAveragePercentage: null },
      { name: 'Science', obtained: 70, max: 100, grade: 'B', previousPercentage: 80, classAveragePercentage: null },
    ]);
    expect(result.subjects[0]!.modes).toEqual([{ name: 'Written', obtained: 90, max: 100 }]);

    // The first exam of a class has no previous exam, even though Class 6 had one.
    expect((await meera.getExamResult({ examId: examOf(current.meera, current.classId, 'ut1') })).previousExam).toBeNull();
  });

  it('never shows class averages for a class of two, even when the school shares them', async () => {
    // Two students: the average plus your own mark would reveal the other mark.
    await setAverages(true);
    const result = await meera.getExamResult({ examId: examOf(current.meera, current.classId, 'hy') });
    expect(result.classAveragePercentage).toBeNull();
    expect(result.subjects.every((subject) => subject.classAveragePercentage === null)).toBe(true);
    const growth = await meera.getGrowth({});
    expect(growth.classAveragesShared).toBe(true);
    expect(growth.selected!.exams.every((exam) => exam.classAveragePercentage === null && exam.subjectAverages === null)).toBe(true);
    expect(growth.classes.every((record) => record.latest?.classAveragePercentage === null)).toBe(true);
    await setAverages(false);
  });

  it('getExam returns any state without paging, and NOT_FOUND for unknown or foreign ids', async () => {
    expect(await meera.getExam({ examId: examOf(current.meera, current.classId, 'annual') })).toMatchObject({
      examSlug: 'annual', state: 'awaiting_release', percentage: null,
    });
    expect(await meera.getExam({ examId: examOf(current.meera, current.classId, 'hy') })).toMatchObject({
      state: 'released', percentage: 80, grade: 'A',
    });
    await expectRpcCode(meera.getExam({ examId: examOf(current.ravi, current.classId, 'hy') }), 'NOT_FOUND');
    await expectRpcCode(meera.getExam({ examId: 'nope' }), 'NOT_FOUND');
  });

  it('hides and rejects unreleased examinations, including after a withdrawal', async () => {
    await expectRpcCode(meera.getExamResult({ examId: examOf(current.meera, current.classId, 'annual') }), 'NOT_FOUND');
    await expectRpcCode(meera.getExamResult({ examId: examOf(current.meera, current.classId, 'weekly') }), 'NOT_FOUND');
    await expectRpcCode(meera.getExamResult({ examId: 'not-an-exam' }), 'NOT_FOUND');
    const remarks = await meera.listRemarks({});
    expect(remarks.items.map((item) => item.text)).not.toContain('Secret until release.');
    expect((await meera.getGrowth({})).selected!.exams.map((exam) => exam.name)).toEqual(['Unit Test 1', 'Half-Yearly']);

    const scope = { schoolId, sessionId: current.sessionId, examSlug: 'hy' };
    await principal.school.withdrawExamFromCadet(scope);
    try {
      await expectRpcCode(meera.getExamResult({ examId: examOf(current.meera, current.classId, 'hy') }), 'NOT_FOUND');
      const exams = await meera.listExams({});
      expect(exams.items.find((exam) => exam.examSlug === 'hy')).toMatchObject({ state: 'awaiting_release', percentage: null });
    } finally {
      await principal.school.releaseExamToCadet(scope);
    }
  });

  it("never reaches another student's records", async () => {
    await expectRpcCode(ravi.getExamResult({ examId: examOf(current.meera, current.classId, 'hy') }), 'NOT_FOUND');
    await expectRpcCode(ravi.listExams({ filters: { recordId: recordOf(current.meera, current.classId) } }), 'NOT_FOUND');
    await expectRpcCode(ravi.getGrowth({ recordId: recordOf(past.meera, past.classId) }), 'NOT_FOUND');
    await expectRpcCode(ravi.listRemarks({ filters: { recordId: recordOf(current.meera, current.classId) } }), 'NOT_FOUND');
    const own = await ravi.getExamResult({ examId: examOf(current.ravi, current.classId, 'hy') });
    expect(own.overall!.percentage).toBe(70);
    expect(own.remark!.text).toBe('Ravi needs practice.');
    expect((await ravi.listRemarks({})).items.map((item) => item.text)).toEqual(['Ravi needs practice.']);
  });

  it('getGrowth lists every class and never mixes subjects across classes', async () => {
    const currentRecord = recordOf(current.meera, current.classId);
    const pastRecord = recordOf(past.meera, past.classId);
    const growth = await meera.getGrowth({});
    expect(growth.classes.map(({ recordId, classLabel, sessionLabel, latest }) => ({ recordId, classLabel, sessionLabel, latest: latest && { examName: latest.examName, percentage: latest.percentage } }))).toEqual([
      { recordId: currentRecord, classLabel: 'Class 7', sessionLabel: '2026–27', latest: { examName: 'Half-Yearly', percentage: 80 } },
      { recordId: pastRecord, classLabel: 'Class 6', sessionLabel: '2025–26', latest: { examName: 'Annual', percentage: 75 } },
    ]);
    expect(growth.selected!.recordId).toBe(currentRecord);
    expect(growth.selected!.subjects).toEqual([
      { subjectId: `${currentRecord}.maths`, name: 'Mathematics' },
      { subjectId: `${currentRecord}.science`, name: 'Science' },
    ]);
    expect(growth.selected!.exams.map((exam) => [exam.name, exam.percentage, exam.subjects])).toEqual([
      ['Unit Test 1', 75, { [`${currentRecord}.maths`]: 70, [`${currentRecord}.science`]: 80 }],
      ['Half-Yearly', 80, { [`${currentRecord}.maths`]: 90, [`${currentRecord}.science`]: 70 }],
    ]);

    const older = await meera.getGrowth({ recordId: pastRecord });
    expect(older.selected!.subjects.map((subject) => subject.name)).toEqual(['Maths', 'Sanskrit']);
    const pastIds = older.selected!.subjects.map((subject) => subject.subjectId);
    const currentIds = growth.selected!.subjects.map((subject) => subject.subjectId);
    // The shared slug `maths` is two different subjects.
    expect(pastIds.filter((id) => currentIds.includes(id))).toEqual([]);
    for (const exam of older.selected!.exams) expect(Object.keys(exam.subjects).every((id) => id.startsWith(`${pastRecord}.`))).toBe(true);
  });

  it('listRemarks returns released remarks, newest session first, optionally per class', async () => {
    const remarks = await meera.listRemarks({});
    expect(remarks.items.every((item) => typeof item.releasedAt === 'string' || item.releasedAt instanceof Date)).toBe(true);
    expect(remarks.items.map(({ examName, text }) => [examName, text])).toEqual([
      ['Half-Yearly', 'Great half-year.'],
      ['Annual', 'Promoted with distinction.'],
    ]);
    const pastOnly = await meera.listRemarks({ filters: { recordId: recordOf(past.meera, past.classId) } });
    expect(pastOnly.items.map((item) => item.text)).toEqual(['Promoted with distinction.']);
  });

  it('rejects anonymous callers and accepts a read-only MCP grant', async () => {
    const anonymous = createCadetTestClient(new Headers());
    await expectRpcCode(anonymous.listExams({}), 'UNAUTHORIZED');
    await expectRpcCode(anonymous.getGrowth({}), 'UNAUTHORIZED');
    await expectRpcCode(anonymous.getProfile(), 'UNAUTHORIZED');
    await expectRpcCode(meera.listExams({ limit: 50 }), 'BAD_REQUEST');

    const admission = await createAdmissionWithLogin(principal, schoolId, 'Asha Nair');
    const { claims } = await connectCadetMcp(admission.credentials);
    const context = await createCadetOAuthContext({
      headers: new Headers(),
      userId: claims.userId,
      oauthGrant: { clientId: claims.clientId, scopes: claims.scopes, grantId: 'grant' },
    });
    const mcp = createRouterClient(cadetRouter, { context: context! });
    // A student without an enrollment sees empty, not broken, results.
    expect(await mcp.listExams({})).toMatchObject({ items: [], record: null });
    expect(await mcp.getGrowth({})).toMatchObject({ classes: [], selected: null });
  });
});

/**
 * Class 8A has five students and Class 8B two, both sitting one exam with
 * their own plans. Asha (8A) is later moved to 8B; Zoya joins a class created
 * after the plans were generated.
 */
describe('cadet class averages, moved students and scoping', () => {
  let principal: TestClient;
  let schoolId: string;
  let sessionId: string;
  let classA: { classId: string; sectionId: string };
  let classB: { classId: string; sectionId: string };
  let asha: CadetRouterClient;
  let ashaStudentId: string;
  let zoya: CadetRouterClient;
  let zoyaStudentId: string;
  let zoyaClassId: string;
  let pastRecordId: string;
  const classAAdmissionIds: string[] = [];
  const classAStudentIds: string[] = [];

  beforeAll(async () => {
    const created = await createResultsSchool();
    principal = created.principal;
    schoolId = created.school.id;
    const logins = [];
    for (const index of [0, 1, 2, 3, 4]) logins.push(await createAdmissionWithLogin(principal, schoolId, `Student A${index}`));

    // 2025–26: the same five students in Class 7, two released exams.
    const pastSessionId = await createExamSession(schoolId, 2025, { p1: 'Past 1', p2: 'Past 2' }, { active: true });
    const classPast = await createSubjectClass(schoolId, 'Class 7', { maths: 'Mathematics' });
    const past: Array<{ classId: string; studentId: string; subjects: Record<string, number> }> = [];
    for (const [index, login] of logins.entries()) {
      const studentId = (await enroll({ schoolId, admissionId: login.admission.id, sessionId: pastSessionId, ...classPast, rollNo: index + 1 })).id;
      past.push({ classId: classPast.classId, studentId, subjects: { maths: 40 + index * 10 } });
      if (index === 0) pastRecordId = `${studentId}.${classPast.classId}`;
    }
    for (const slug of ['p1', 'p2']) {
      const pastScope = { schoolId, sessionId: pastSessionId, examSlug: slug };
      await runExam(principal, pastScope, past, { complete: true });
      await principal.school.releaseExamToCadet(pastScope);
    }

    // 2026–27: Class 8 (five) and Class 9 (two) sit one exam with attendance and activities.
    sessionId = await createExamSession(schoolId, 2026, { t1: 'Term 1' }, { active: true, attendance: true, coScholastic: true });
    classA = await createSubjectClass(schoolId, 'Class 8', { maths: 'Mathematics' });
    classB = await createSubjectClass(schoolId, 'Class 9', { maths: 'Mathematics' });
    const enrolled: Array<{ classId: string; studentId: string; subjects: Record<string, number>; daysAttended: number; coScholastics: Record<string, string> }> = [];
    const aMarks = [90, 80, 70, 60, 50];
    for (const [index, mark] of aMarks.entries()) {
      const login = logins[index]!;
      const studentId = (await enroll({ schoolId, admissionId: login.admission.id, sessionId, ...classA, rollNo: index + 1 })).id;
      classAAdmissionIds.push(login.admission.id);
      classAStudentIds.push(studentId);
      if (index === 0) {
        asha = await cadetClient(login.credentials);
        ashaStudentId = studentId;
      }
      enrolled.push({ classId: classA.classId, studentId, subjects: { maths: mark }, daysAttended: 40, coScholastics: { art: 'A' } });
    }
    for (const index of [0, 1]) {
      const login = await createAdmissionWithLogin(principal, schoolId, `Student B${index}`);
      const studentId = (await enroll({ schoolId, admissionId: login.admission.id, sessionId, ...classB, rollNo: index + 1 })).id;
      enrolled.push({ classId: classB.classId, studentId, subjects: { maths: 10 }, daysAttended: 45, coScholastics: { art: 'B' } });
    }
    const scope = { schoolId, sessionId, examSlug: 't1' };
    await runExam(principal, scope, enrolled, { complete: true, workingDays: 50 });
    await principal.school.saveStudentExamRemark({ ...scope, classId: classA.classId, studentId: ashaStudentId, text: 'Well done.' });
    await principal.school.releaseExamToCadet(scope);
    await principal.school.updateCadetPortalSettings({ schoolId, showClassAverages: true });

    // A class created after plan generation has no plan in the released exam.
    const late = await createSubjectClass(schoolId, 'Class 10', { maths: 'Mathematics' });
    zoyaClassId = late.classId;
    const zoyaLogin = await createAdmissionWithLogin(principal, schoolId, 'Zoya Late');
    zoyaStudentId = (await enroll({ schoolId, admissionId: zoyaLogin.admission.id, sessionId, ...late, rollNo: 1 })).id;
    zoya = await cadetClient(zoyaLogin.credentials);
  }, 120_000);

  const examId = (studentId: string, classId: string) => `${studentId}.${classId}.t1`;

  it("averages only the student's own class plans, from five students up", async () => {
    const result = await asha.getExamResult({ examId: examId(ashaStudentId, classA.classId) });
    // Class 9's marks (10, 10) sit the same exam in their own plans and are not mixed in.
    expect(result.classAveragePercentage).toBe(70);
    expect(result.subjects[0]!.classAveragePercentage).toBe(70);
    const growth = await asha.getGrowth({ recordId: `${ashaStudentId}.${classA.classId}` });
    expect(growth.selected!.exams[0]).toMatchObject({ percentage: 90, classAveragePercentage: 70 });
  });

  it('keeps a moved student\'s results under the class they sat the exam in', async () => {
    await db.update(studentTable).set({ classId: classB.classId, sectionId: classB.sectionId, rollNo: 99 }).where(eq(studentTable.id, ashaStudentId));
    try {
      const growth = await asha.getGrowth({});
      expect(growth.classes.slice(0, 2).map(({ recordId, classLabel, sectionLabel }) => ({ recordId, classLabel, sectionLabel }))).toEqual([
        { recordId: `${ashaStudentId}.${classB.classId}`, classLabel: 'Class 9', sectionLabel: 'Section A' },
        // The results-only record: no longer placed there, so no section.
        { recordId: `${ashaStudentId}.${classA.classId}`, classLabel: 'Class 8', sectionLabel: null },
      ]);
      // The current class sat the exam too, but she has no marks in its plans.
      const current = await asha.listExams({});
      expect(current.items).toMatchObject([{ examSlug: 't1', state: 'released', percentage: null }]);
      const sat = await asha.getExamResult({ examId: examId(ashaStudentId, classA.classId) });
      expect(sat).toMatchObject({ classLabel: 'Class 8', sectionLabel: null, overall: { percentage: 90 }, remark: { text: 'Well done.' } });
      expect(sat.attendance).toEqual({ daysAttended: 40, totalWorkingDays: 50 });
      // The remark, attendance and activities belong to the class holding her results only.
      const other = await asha.getExamResult({ examId: examId(ashaStudentId, classB.classId) });
      expect(other).toMatchObject({ overall: null, remark: null, attendance: null, coScholastics: [] });
      const remarks = await asha.listRemarks({});
      expect(remarks.items.map((item) => [item.recordId, item.text])).toEqual([[`${ashaStudentId}.${classA.classId}`, 'Well done.']]);
    } finally {
      await db.update(studentTable).set({ classId: classA.classId, sectionId: classA.sectionId, rollNo: 1 }).where(eq(studentTable.id, ashaStudentId));
    }
  });

  it('shows attendance and activities only as the report card would', async () => {
    const id = examId(ashaStudentId, classA.classId);
    expect(await asha.getExamResult({ examId: id })).toMatchObject({
      attendance: { daysAttended: 40, totalWorkingDays: 50 },
      coScholastics: [{ area: 'Art', grade: 'A' }],
    });
    const assessmentWhere = and(eq(examStudentAssessmentTable.studentId, ashaStudentId), eq(examStudentAssessmentTable.examSlug, 't1'));
    await db.update(examStudentAssessmentTable).set({ approved: false }).where(assessmentWhere);
    try {
      expect(await asha.getExamResult({ examId: id })).toMatchObject({ attendance: null, coScholastics: [] });
    } finally {
      await db.update(examStudentAssessmentTable).set({ approved: true }).where(assessmentWhere);
    }
    const [session] = await db.select().from(schoolSessionTable).where(eq(schoolSessionTable.id, sessionId));
    const config = session!.sessionConfig!;
    await db.update(schoolSessionTable).set({ sessionConfig: { ...config, attendanceTracking: { enabled: false } } }).where(eq(schoolSessionTable.id, sessionId));
    try {
      // Tracking off hides attendance; approved activity grades stay.
      expect(await asha.getExamResult({ examId: id })).toMatchObject({ attendance: null, coScholastics: [{ area: 'Art', grade: 'A' }] });
    } finally {
      await db.update(schoolSessionTable).set({ sessionConfig: config }).where(eq(schoolSessionTable.id, sessionId));
    }
  });

  it('averages only approved results of registered students and counts only those toward the minimum', async () => {
    const id = examId(ashaStudentId, classA.classId);
    const lastRow = eq(examResultTable.studentId, classAStudentIds[4]!);
    await db.update(examResultTable).set({ approved: false }).where(lastRow);
    try {
      expect((await asha.getExamResult({ examId: id })).classAveragePercentage).toBeNull();
    } finally {
      await db.update(examResultTable).set({ approved: true }).where(lastRow);
    }
    await db.update(admissionTable).set({ registered: false }).where(eq(admissionTable.id, classAAdmissionIds[4]!));
    try {
      expect((await asha.getExamResult({ examId: id })).classAveragePercentage).toBeNull();
    } finally {
      await db.update(admissionTable).set({ registered: true }).where(eq(admissionTable.id, classAAdmissionIds[4]!));
    }
    expect((await asha.getExamResult({ examId: id })).classAveragePercentage).toBe(70);
  });

  it('computes growth averages for every exam of the selected class and the latest exam of the others', async () => {
    const growth = await asha.getGrowth({});
    expect(growth.selected!.recordId).toBe(`${ashaStudentId}.${classA.classId}`);
    expect(growth.selected!.exams.map((exam) => exam.classAveragePercentage)).toEqual([70]);
    // Past class: 40..80 → latest average 60, shown in "class by class".
    expect(growth.classes.find((item) => item.recordId === pastRecordId)!.latest).toMatchObject({ examName: 'Past 2', classAveragePercentage: 60 });
    const past = await asha.getGrowth({ recordId: pastRecordId });
    expect(past.selected!.exams.map((exam) => exam.classAveragePercentage)).toEqual([60, 60]);
  });

  it('omits a released exam that has no plan for the student\'s class', async () => {
    expect((await zoya.listExams({})).items).toEqual([]);
    await expectRpcCode(zoya.getExam({ examId: examId(zoyaStudentId, zoyaClassId) }), 'NOT_FOUND');
    await expectRpcCode(zoya.getExamResult({ examId: examId(zoyaStudentId, zoyaClassId) }), 'NOT_FOUND');
    // A record id of another class the student was never in is not hers either.
    await expectRpcCode(zoya.getExamResult({ examId: examId(zoyaStudentId, classA.classId) }), 'NOT_FOUND');
  });

  it("returns NOT_FOUND for another school's ids", async () => {
    const other = await createResultsSchool();
    const login = await createAdmissionWithLogin(other.principal, other.school.id, 'Other School Student');
    const outsider = await cadetClient(login.credentials);
    await expectRpcCode(outsider.getExamResult({ examId: examId(ashaStudentId, classA.classId) }), 'NOT_FOUND');
    await expectRpcCode(outsider.getExam({ examId: examId(ashaStudentId, classA.classId) }), 'NOT_FOUND');
    await expectRpcCode(outsider.getGrowth({ recordId: `${ashaStudentId}.${classA.classId}` }), 'NOT_FOUND');
    await expectRpcCode(outsider.listRemarks({ filters: { recordId: `${ashaStudentId}.${classA.classId}` } }), 'NOT_FOUND');
  });
});

describe('cadet fees', () => {
  it('shows the own ledger, summary and bills and nothing of another admission', async () => {
    const scenario = await createFinanceScenario();
    const accountant = scenario.actors.accountant.client;
    const principal = scenario.actors.principal.client;
    const schoolId = scenario.school.id;
    const credentials = await principal.school.issueAdmissionCadetPassword({ schoolId, admissionId: scenario.admission.id });
    const student = await cadetClient(credentials);

    // A new student with no bills sees an empty account.
    expect(await student.getFeeSummary()).toEqual({ currencies: [] });
    expect((await student.listFeeLedger({})).items).toEqual([]);

    const bill = await retryFinanceConflict(() => accountant.school.createManualBill({
      schoolId,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      issueDate: '2040-05-01',
      reason: 'Cadet ledger test',
      idempotencyKey: createFinanceIdempotencyKey('cadet-bill'),
      lines: [{ title: 'Tuition', amountMinor: '400000' }, { title: 'Transport', amountMinor: '100000' }],
    }));
    await retryFinanceConflict(() => principal.school.recordAdjustment({
      schoolId, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, currency: 'INR', kind: 'discount',
      billId: bill.id, calculation: { kind: 'fixed', amountMinor: '50000' }, reasonCode: 'SIBLING', reasonNote: 'Sibling concession',
      effectiveAt: '2040-05-02T00:00:00Z', idempotencyKey: createFinanceIdempotencyKey('cadet-discount'),
    }));
    const payment = await retryFinanceConflict(() => accountant.school.recordPayment({
      schoolId, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, amountMinor: '300000', currency: 'INR',
      method: 'cash', receivedAt: '2040-05-03T10:00:00Z', effectiveAt: '2040-05-03T10:00:00Z', idempotencyKey: createFinanceIdempotencyKey('cadet-payment'),
    }));

    expect(await student.getFeeSummary()).toEqual({
      currencies: [{
        currency: 'INR', balanceMinor: '150000', dueMinor: '150000', creditMinor: '0', billedMinor: '500000',
        paidMinor: '300000', concessionsMinor: '50000', refundedMinor: '0',
      }],
    });
    const ledger = await student.listFeeLedger({});
    expect(ledger.items.map(({ type, direction, amountMinor, runningBalanceMinor, reference, billId, paymentMethod }) => ({ type, direction, amountMinor, runningBalanceMinor, reference, billId, paymentMethod }))).toEqual([
      { type: 'payment', direction: 'credit', amountMinor: '300000', runningBalanceMinor: '150000', reference: payment.receiptNumber, billId: null, paymentMethod: 'cash' },
      { type: 'discount', direction: 'credit', amountMinor: '50000', runningBalanceMinor: '450000', reference: null, billId: null, paymentMethod: null },
      // Manual bills post as manual debit adjustments; the bill link is what matters.
      { type: 'manual_debit_adjustment', direction: 'debit', amountMinor: '500000', runningBalanceMinor: '500000', reference: bill.billNumber, billId: bill.id, paymentMethod: null },
    ]);
    expect(ledger.items[0]).not.toHaveProperty('recordedBy');
    expect(ledger.pagination).toMatchObject({ totalItems: 3 });

    const detail = await student.getBill({ billId: bill.id });
    expect(detail).toMatchObject({
      billNumber: bill.billNumber, issueDate: '2040-05-01', sessionLabel: '2040–41', totalAmountMinor: '500000',
      concessionsMinor: '50000', addedMinor: '0', netAmountMinor: '450000', reversed: false,
      lines: [{ name: 'Tuition', amountMinor: '400000' }, { name: 'Transport', amountMinor: '100000' }],
      adjustments: [{ kind: 'discount', amountMinor: '50000', reversed: false }],
    });
    expect(detail.adjustments[0]).not.toHaveProperty('reasonNote');

    // Another admission's bill in the same school is not reachable.
    const other = await createTestAdmission({ schoolId, name: 'Other Student' });
    await createTestStudent({ schoolId, admissionId: other.id, sessionId: scenario.activeSession.id, classId: scenario.schoolClass.id, sectionId: scenario.section.id, rollNo: 2 });
    const otherBill = await retryFinanceConflict(() => accountant.school.createManualBill({
      schoolId, sessionId: scenario.activeSession.id, admissionId: other.id, issueDate: '2040-05-01', reason: 'Other',
      idempotencyKey: createFinanceIdempotencyKey('other-bill'), lines: [{ title: 'Tuition', amountMinor: '1000' }],
    }));
    await expectRpcCode(student.getBill({ billId: otherBill.id }), 'NOT_FOUND');
    expect((await student.listFeeLedger({})).items.map((item) => item.billId)).not.toContain(otherBill.id);
    await expectRpcCode(student.getBill({ billId: '' }), 'BAD_REQUEST');
    await expectRpcCode(createCadetTestClient(new Headers()).getFeeSummary(), 'UNAUTHORIZED');
    await expectRpcCode(createCadetTestClient(new Headers()).getBill({ billId: bill.id }), 'UNAUTHORIZED');
  });
});

