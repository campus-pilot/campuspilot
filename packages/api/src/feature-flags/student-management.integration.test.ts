import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../test/feature-flags';
import {
  createRegularUserSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  setTestSchoolFeature,
} from '../../test/fixtures';
import { createAdmissionWithLogin, createExamSession, createResultsSchool, createSubjectClass, enroll, runExam } from '../../test/exam-results';
import { expectRpcCode } from '../../test/finance/assertions';
import { getSchoolFeatureFlags, isSchoolFeatureEnabled } from './feature-flags.service';

const admissionInput = (schoolId: string) => ({
  schoolId,
  name: 'Student SM-1',
  admissionNo: 'SM-1',
  address: 'Test address',
  phoneNo: '9999999999',
  whatsappSameAsPhone: true,
  email: 'sm-1@example.com',
  dob: '2015-01-01',
  fatherName: 'Test Father',
  motherName: 'Test Mother',
});

/**
 * A school without student management whose principal is signed in, with an
 * active session. `plus` (the default) is a school on the Plus tier, which
 * does not include it; `switchedOff` is a Pro school, whose tier does, with
 * student management switched off for it by an administrator.
 */
async function staffOnlySchool(how: 'plus' | 'switchedOff' = 'plus') {
  const school = await createTestSchool({ tier: how === 'plus' ? 'plus' : 'pro' });
  const session = await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true });
  const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
  if (how === 'switchedOff') await setTestSchoolFeature(school.id, 'studentManagement', false);
  return { school, session, client: createTestClient(principal.session) };
}

describe('student management feature', () => {
  it('is part of the Pro and Enterprise tiers and not of Plus, with no stored row either way', async () => {
    for (const tier of ['pro', 'enterprise'] as const) {
      const school = await createTestSchool({ tier });
      const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
      expect(await isSchoolFeatureEnabled(db, school.id, 'studentManagement')).toBe(true);
      await expect(createTestClient(principal.session).school.listAdmissions({ schoolId: school.id })).resolves.toMatchObject({ items: [] });
    }
    const plus = await createTestSchool({ tier: 'plus' });
    const principal = await createSchoolStaffSession(plus.id, [{ role: 'principal', meta: null }]);
    expect(await isSchoolFeatureEnabled(db, plus.id, 'studentManagement')).toBe(false);
    await expectFeatureDisabled(createTestClient(principal.session).school.listAdmissions({ schoolId: plus.id }), 'studentManagement');
    // Switched on for that one Plus school, it has it.
    await setTestSchoolFeature(plus.id, 'studentManagement', true);
    await expect(createTestClient(principal.session).school.listAdmissions({ schoolId: plus.id })).resolves.toMatchObject({ items: [] });
  });

  it('is equally off for a school whose tier includes it and where an administrator switched it off', async () => {
    const { school, client } = await staffOnlySchool('switchedOff');
    await expectFeatureDisabled(client.school.listAdmissions({ schoolId: school.id }), 'studentManagement');
    // Notices are part of the same tier and need it: inactive with it, their switch untouched.
    expect(await getSchoolFeatureFlags(db, school.id)).toMatchObject({
      studentManagement: { included: true, adjustment: false, enabled: false, active: false },
      notices: { included: true, adjustment: null, enabled: true, active: false },
    });
    // Returned to its tier, the school has both again.
    await setTestSchoolFeature(school.id, 'studentManagement', null);
    await expect(client.school.listAdmissions({ schoolId: school.id })).resolves.toMatchObject({ items: [] });
    expect((await getSchoolFeatureFlags(db, school.id)).notices.active).toBe(true);
  });

  it('refuses admissions, students, fees and student documents without it, and writes nothing', async () => {
    const { school, session, client } = await staffOnlySchool();

    await expectFeatureDisabled(client.school.listAdmissions({ schoolId: school.id }), 'studentManagement');
    await expectFeatureDisabled(client.school.createAdmission(admissionInput(school.id)), 'studentManagement');
    expect(await db.select().from(admissionTable).where(eq(admissionTable.schoolId, school.id))).toEqual([]);
    await expectFeatureDisabled(client.school.listStudents({ schoolId: school.id, sessionId: session.id }), 'studentManagement');
    await expectFeatureDisabled(client.school.getSessionFinance({ schoolId: school.id, sessionId: session.id }), 'studentManagement');
    await expectFeatureDisabled(client.school.listDocumentArtifacts({ schoolId: school.id, filters: {} }), 'studentManagement');
    await expectFeatureDisabled(
      client.school.getActiveDocumentTemplate({ schoolId: school.id, documentType: 'report_card' }),
      'studentManagement',
    );
  });

  it('keeps staff, classes and examinations working without it', async () => {
    const { school, session, client } = await staffOnlySchool();
    await expect(client.school.listMembers({ schoolId: school.id })).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(client.school.listClasses({ schoolId: school.id, sessionId: session.id })).resolves.toEqual([]);
    await expect(client.school.listExams({ schoolId: school.id, sessionId: session.id })).resolves.toBeDefined();
  });

  it('checks the permission first, so a caller without access learns nothing about the school', async () => {
    const { school } = await staffOnlySchool();
    const outsider = createTestClient(await createRegularUserSession());
    await expectPermissionDenied(outsider.school.listAdmissions({ schoolId: school.id }));
  });

  it('leaves the dashboard without admissions and billing and without their jobs, and keeps classrooms without student counts', async () => {
    const { school, session, client } = await staffOnlySchool();
    const { schoolClass } = await createTestClass({ schoolId: school.id, label: 'Class 4' });
    // A student the school enrolled before the feature was switched off is kept, and not counted.
    const admission = await createTestAdmission({ schoolId: school.id, name: 'Kept Student', admissionNo: 'SM-KEPT' });
    await createTestStudent({ schoolId: school.id, admissionId: admission.id, sessionId: session.id, classId: schoolClass.id, sectionId: null, rollNo: null });

    const dashboard = await client.school.getDashboard({ schoolId: school.id, sessionId: session.id });
    expect(dashboard).toMatchObject({
      admissions: null,
      billing: null,
      actions: { createAdmission: false, recordPayment: false, enterResults: false, createNotice: false },
    });
    expect(dashboard.examinations).not.toBeNull();
    expect(dashboard.classrooms).toMatchObject({
      classCount: 1,
      sectionCount: 1,
      studentCount: null,
      classes: [{ id: schoolClass.id, sectionCount: 1, studentCount: null }],
    });
    const classes = await client.school.listClasses({ schoolId: school.id, sessionId: session.id });
    expect(classes.map(({ id, studentCount }) => ({ id, studentCount }))).toEqual([{ id: schoolClass.id, studentCount: null }]);

    // With the feature the same school counts its students again.
    await setTestSchoolFeature(school.id, 'studentManagement', true);
    expect((await client.school.getDashboard({ schoolId: school.id, sessionId: session.id })).classrooms).toMatchObject({
      studentCount: 1,
      classes: [{ id: schoolClass.id, studentCount: 1 }],
    });
    expect((await client.school.listClasses({ schoolId: school.id, sessionId: session.id }))[0]?.studentCount).toBe(1);
  });

  it('refuses student-only session settings without it, and lets examinations be configured', async () => {
    const { school, session, client } = await staffOnlySchool();
    const scope = { schoolId: school.id, sessionId: session.id };
    // What the staff-only settings screen sends for a session that stored no configuration: its first
    // examination, and the hidden settings at their defaults.
    const firstExam = {
      examConfig: { term: { name: 'Term 1', order: 1 } },
      coScholasticAreas: {},
      gradingScale: {},
      attendanceTracking: { enabled: false },
    };
    await expect(client.school.updateSession({ ...scope, sessionConfig: firstExam })).resolves.toMatchObject({
      sessionConfig: { examConfig: { term: { name: 'Term 1', order: 1 } } },
    });

    await expectFeatureDisabled(
      client.school.updateSession({ ...scope, sessionConfig: { ...firstExam, attendanceTracking: { enabled: true } } }),
      'studentManagement',
    );
    await expectFeatureDisabled(
      client.school.updateSession({ ...scope, sessionConfig: { ...firstExam, gradingScale: { a: { label: 'A', minScore: 80 } } } }),
      'studentManagement',
    );
    await expectFeatureDisabled(
      client.school.updateSession({ ...scope, sessionConfig: { ...firstExam, coScholasticAreas: { art: { name: 'Art' } } } }),
      'studentManagement',
    );
    // Nothing of the refused changes was saved.
    expect((await client.school.getSession(scope)).sessionConfig).toMatchObject({
      attendanceTracking: { enabled: false },
      gradingScale: {},
      coScholasticAreas: {},
    });

    // A new session may carry examinations, and only the defaults of the student-only settings.
    await expectFeatureDisabled(
      client.school.createSession({
        schoolId: school.id,
        sessionStartYear: 2027,
        sessionEndYear: 2028,
        sessionConfig: { ...firstExam, attendanceTracking: { enabled: true } },
      }),
      'studentManagement',
    );
    await expect(
      client.school.createSession({ schoolId: school.id, sessionStartYear: 2027, sessionEndYear: 2028, sessionConfig: firstExam }),
    ).resolves.toMatchObject({ sessionStartYear: 2027 });

    // With the feature the same change is an ordinary save.
    await setTestSchoolFeature(school.id, 'studentManagement', true);
    await expect(
      client.school.updateSession({ ...scope, sessionConfig: { ...firstExam, attendanceTracking: { enabled: true } } }),
    ).resolves.toMatchObject({ sessionConfig: { attendanceTracking: { enabled: true } } });
  });

  it('takes notices and the Cadet Portal with it, keeping their switches, and gives them back', async () => {
    const { school, session, client } = await staffOnlySchool();
    await setTestSchoolFeature(school.id, 'notices', true);
    await setTestSchoolFeature(school.id, 'cadet', true);

    const features = await getSchoolFeatureFlags(db, school.id);
    expect(features.notices).toEqual({ included: false, adjustment: true, enabled: true, active: false, config: null });
    expect(features.cadet).toEqual({ included: false, adjustment: true, enabled: true, active: false, config: null });
    // Refused for the feature that was asked for, as every gate refuses.
    await expectFeatureDisabled(client.school.listNotices({ schoolId: school.id, sessionId: session.id }), 'notices');

    await setTestSchoolFeature(school.id, 'studentManagement', true);
    await expect(client.school.listNotices({ schoolId: school.id, sessionId: session.id })).resolves.toMatchObject({ items: [] });
    await expect(client.school.listAdmissions({ schoolId: school.id })).resolves.toMatchObject({ items: [] });
    expect((await getSchoolFeatureFlags(db, school.id)).cadet).toEqual({ included: false, adjustment: true, enabled: true, active: true, config: null });
  });

  it('is read by the school\'s staff as not active', async () => {
    const { school, client } = await staffOnlySchool();
    const { features } = await client.school.getFeatureFlags({ schoolId: school.id });
    expect(features.studentManagement).toEqual({ included: false, adjustment: null, enabled: false, active: false, config: null });
  });
});

describe('examination lifecycle without student management', () => {
  /** A school with one enrolled student and a started examination that has no results yet. */
  async function startedExam() {
    const { school, principal } = await createResultsSchool({ features: ['cadet'] });
    const sessionId = await createExamSession(school.id, 2026, { term: 'Term 1' }, { active: true });
    const placement = await createSubjectClass(school.id, 'Class 7', { maths: 'Mathematics' });
    const { admission } = await createAdmissionWithLogin(principal, school.id, 'Asha Rao');
    const student = await enroll({ schoolId: school.id, admissionId: admission.id, sessionId, ...placement });
    const scope = { schoolId: school.id, sessionId, examSlug: 'term' };
    await runExam(principal, scope, []);
    return { school, principal, scope, classId: placement.classId, studentId: student.id };
  }

  it('completes an examination whose results can no longer be entered, where a school with the feature must finish them', async () => {
    const { school, principal, scope } = await startedExam();
    // With student management, completion waits for every registered student's approved results.
    await expectRpcCode(principal.school.transitionExam({ ...scope, status: 'completed' }), 'BAD_REQUEST');

    await setTestSchoolFeature(school.id, 'studentManagement', false);
    await expect(principal.school.transitionExam({ ...scope, status: 'completed' })).resolves.toMatchObject({ updatedCount: 1 });
    expect((await principal.school.getExamOverview(scope)).status).toBe('completed');
  });

  it('completes through the per-plan transition too', async () => {
    const { school, principal, scope, classId } = await startedExam();
    const [plan] = (await principal.school.listExamPlans(scope)).items;
    const planScope = { schoolId: school.id, sessionId: scope.sessionId, classId, examPlanId: plan!.id };
    await expectRpcCode(principal.school.transitionExamPlan({ ...planScope, status: 'completed' }), 'BAD_REQUEST');

    await setTestSchoolFeature(school.id, 'studentManagement', false);
    await expect(principal.school.transitionExamPlan({ ...planScope, status: 'completed' })).resolves.toMatchObject({ status: 'completed' });
    expect((await principal.school.getExamOverview(scope)).status).toBe('completed');
  });

  it('does not release results that were never reviewed once the feature is back', async () => {
    const { school, principal, scope, classId, studentId } = await startedExam();
    await setTestSchoolFeature(school.id, 'studentManagement', false);
    await principal.school.transitionExam({ ...scope, status: 'completed' });
    await setTestSchoolFeature(school.id, 'studentManagement', true);

    // Completed, but nobody has results: students must not be told they are released.
    await expect(principal.school.releaseExamToCadet(scope)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('Reopen the examination'),
    });
    expect((await principal.school.getExamOverview(scope)).cadetReleasedAt).toBeNull();

    // Reopen, finish the results, complete again: now it can be released.
    await principal.school.transitionExam({ ...scope, status: 'active' });
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
    await principal.school.transitionExam({ ...scope, status: 'completed' });
    await expect(principal.school.releaseExamToCadet(scope)).resolves.toMatchObject({ cadetReleasedAt: expect.any(String) });
  });
});
