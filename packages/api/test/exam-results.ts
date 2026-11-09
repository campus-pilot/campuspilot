import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import type { ClassConfig } from '@campuspilot/db/schema/jsonb/class-config';
import type { SessionConfig } from '@campuspilot/db/schema/jsonb/session-config';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  type TestClient,
} from './fixtures';

/**
 * Builds schools with classes, enrolled students and examinations through
 * the real staff procedures, for tests of what the Cadet Portal shows.
 * Every subject has one `written` mode worth 100 marks, so a subject's mark
 * is also its percentage.
 */

export const GRADING_SCALE: SessionConfig['gradingScale'] = {
  a: { label: 'A', minScore: 80 },
  b: { label: 'B', minScore: 60 },
  c: { label: 'C', minScore: 0 },
};

export async function createResultsSchool(): Promise<{ school: { id: string; slug: string }; principal: TestClient }> {
  const school = await createTestSchool();
  const principal = createTestClient(
    (await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session,
  );
  return { school, principal };
}

/** A class whose subjects are `{ slug: name }`, each with one 100-mark written mode. */
export async function createSubjectClass(schoolId: string, label: string, subjects: Record<string, string>) {
  const { schoolClass, sections } = await createTestClass({ schoolId, label });
  const config: ClassConfig = {
    subjects: Object.fromEntries(
      Object.entries(subjects).map(([slug, name]) => [
        slug,
        { name, books: [], examModes: { written: { name: 'Written', percentage: 100 } } },
      ]),
    ),
  };
  await db.update(classTable).set({ config }).where(eq(classTable.id, schoolClass.id));
  return { classId: schoolClass.id, sectionId: sections[0]!.id };
}

/** A session with the given exams (slug → name, in order). Inactive unless `active`. */
export async function createExamSession(
  schoolId: string,
  startYear: number,
  exams: Record<string, string>,
  options: { active?: boolean; coScholastic?: boolean; attendance?: boolean } = {},
) {
  const session = await createTestSession({
    schoolId,
    sessionStartYear: startYear,
    sessionEndYear: startYear + 1,
    isActive: false,
  });
  const sessionConfig: SessionConfig = {
    examConfig: Object.fromEntries(Object.entries(exams).map(([slug, name], index) => [slug, { name, order: index + 1 }])),
    coScholasticAreas: options.coScholastic ? { art: { name: 'Art' } } : {},
    gradingScale: GRADING_SCALE,
    attendanceTracking: { enabled: options.attendance ?? false },
  };
  await db.update(schoolSessionTable).set({ sessionConfig }).where(eq(schoolSessionTable.id, session.id));
  if (options.active) await activateSession(schoolId, session.id);
  return session.id;
}

/** Makes `sessionId` the school's only active session (exam writes need it). */
export async function activateSession(schoolId: string, sessionId: string) {
  await db.update(schoolSessionTable).set({ isActive: false }).where(eq(schoolSessionTable.schoolId, schoolId));
  await db.update(schoolSessionTable).set({ isActive: true }).where(eq(schoolSessionTable.id, sessionId));
}

export async function createAdmissionWithLogin(principal: TestClient, schoolId: string, name: string) {
  const admission = await createTestAdmission({ schoolId, name, admissionNo: `CP-${randomUUID().slice(0, 8)}` });
  const credentials = await principal.school.issueAdmissionCadetPassword({ schoolId, admissionId: admission.id });
  return { admission, credentials };
}

export async function enroll(options: {
  schoolId: string;
  admissionId: string;
  sessionId: string;
  classId: string;
  sectionId: string;
  rollNo?: number;
}) {
  return createTestStudent({ ...options, rollNo: options.rollNo ?? null });
}

/**
 * Generates plans, starts the exam and saves approved marks for each student
 * (`studentId → subjectSlug → mark`). With `complete` the exam is completed.
 */
export async function runExam(
  client: TestClient,
  scope: { schoolId: string; sessionId: string; examSlug: string },
  marks: Array<{ classId: string; studentId: string; subjects: Record<string, number>; coScholastics?: Record<string, string>; daysAttended?: number }>,
  options: { complete?: boolean; workingDays?: number } = {},
) {
  const preview = await client.school.getExamPlanPreview(scope);
  await client.school.generateExamPlan({ ...scope, configurationVersion: preview.configurationVersion });
  await client.school.transitionExam({ ...scope, status: 'active' });
  if (options.workingDays !== undefined)
    await client.school.updateExamAssessmentSettings({ ...scope, totalWorkingDays: options.workingDays });
  for (const entry of marks) {
    const workspace = await client.school.getStudentExam({ ...scope, classId: entry.classId, studentId: entry.studentId });
    await client.school.saveStudentExam({
      ...scope,
      classId: entry.classId,
      studentId: entry.studentId,
      approved: true,
      daysAttended: entry.daysAttended ?? null,
      coScholastics: entry.coScholastics ?? null,
      subjects: workspace.subjects.map(({ plan }) => ({
        examPlanId: plan.id,
        marks: { written: entry.subjects[plan.subjectSlug] ?? 0 },
      })),
    });
  }
  if (options.complete) await client.school.transitionExam({ ...scope, status: 'completed' });
}
