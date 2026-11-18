import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examClassTable, examLifecycleTable, examPlanTable } from '@campuspilot/db/schema/exam';
import { schoolOnboardingTable } from '@campuspilot/db/schema/school-creation';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expectRpcCode } from '../../test/finance/assertions';
import {
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSession,
} from '../../test/fixtures';
import {
  DEFAULT_ONBOARDING_EXAM_NAMES,
  ONBOARDING_CLASSES,
  ONBOARDING_SCHOOL_NOT_EMPTY_REASON,
  ONBOARDING_STAGES,
  academicSessionStartYear,
  onboardingExamSlugs,
  onboardingSubjectSlugs,
  type CompleteSchoolOnboardingInput,
} from './school-onboarding.contract';

/** The guided setup of a self-created school (docs/school-creation.md, "Guided setup"). */

/** A newcomer's own school, created through self-service, with its owner's client. */
async function ownSchool() {
  const session = await createRegularUserSession();
  const client = createTestClient(session);
  const { schoolId } = await client.schoolCreation.createSchool({ name: 'Green Valley Public School', location: 'Sitapur' });
  return { client, schoolId, userId: session.user.id };
}

/** The guide's proposal as the screens send it unchanged. */
function proposal(schoolId: string): CompleteSchoolOnboardingInput {
  return {
    schoolId,
    sessionStartYear: 2026,
    examNames: [...DEFAULT_ONBOARDING_EXAM_NAMES],
    classSlugs: ONBOARDING_CLASSES.filter((entry) => entry.preselected).map((entry) => entry.slug),
    subjects: Object.fromEntries(ONBOARDING_STAGES.map((stage) => [stage.key, [...stage.subjects]])),
  };
}

async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (caught: unknown) => caught as { code?: string; data?: { reason?: string } },
  );
}

describe('school guided setup', () => {
  it('is offered to a school its owner created, and not to other schools', async () => {
    const { client, schoolId } = await ownSchool();
    expect(await client.school.getOnboarding({ schoolId })).toEqual({ state: 'pending' });

    const other = await createTestSchool();
    const { session } = await createSchoolStaffSession(other.id, [{ role: 'principal' }]);
    const principal = createTestClient(session);
    expect(await principal.school.getOnboarding({ schoolId: other.id })).toEqual({ state: 'not_offered' });
    await expectRpcCode(principal.school.completeOnboarding(proposal(other.id)), 'NOT_FOUND');
    await expectRpcCode(principal.school.skipOnboarding({ schoolId: other.id }), 'NOT_FOUND');
  });

  it('creates the session, examinations, classes, subjects and every plan in one go', async () => {
    const { client, schoolId } = await ownSchool();
    const input = proposal(schoolId);

    const result = await client.school.completeOnboarding(input);

    const sessions = await db.select().from(schoolSessionTable).where(eq(schoolSessionTable.schoolId, schoolId));
    expect(sessions).toMatchObject([{ id: result.sessionId, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true }]);
    const examSlugs = onboardingExamSlugs(input.examNames);
    expect(examSlugs).toEqual(['first_term', 'second_term', 'third_term', 'last_term']);
    expect(sessions[0]!.sessionConfig?.examConfig).toEqual({
      first_term: { name: 'First Term', order: 1 },
      second_term: { name: 'Second Term', order: 2 },
      third_term: { name: 'Third Term', order: 3 },
      last_term: { name: 'Last Term', order: 4 },
    });

    const classes = await db.select().from(classTable).where(eq(classTable.schoolId, schoolId)).orderBy(asc(classTable.displayOrder));
    expect(classes.map((entry) => entry.label)).toEqual([
      'Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
    ]);
    const classEight = classes.find((entry) => entry.slug === 'class-8')!;
    expect(Object.keys(classEight.config?.subjects ?? {})).toEqual(onboardingSubjectSlugs(ONBOARDING_STAGES[2].subjects));
    expect(classEight.config?.subjects['science']).toMatchObject({ name: 'Science', examModes: { written: { name: 'Written', percentage: 100 } } });
    const sections = await client.school.listSections({ schoolId, classId: classEight.id });
    expect(sections).toMatchObject([{ slug: 'a', label: 'A' }]);

    // One plan per class, subject and examination; every class takes part in every examination.
    const subjectsPerExam = ONBOARDING_CLASSES.filter((entry) => entry.preselected).reduce(
      (total, entry) => total + ONBOARDING_STAGES.find((stage) => stage.key === entry.stage)!.subjects.length,
      0,
    );
    expect(result).toMatchObject({ examSlugs, classCount: 13, planCount: subjectsPerExam * 4 });
    expect(await db.select().from(examPlanTable).where(eq(examPlanTable.schoolId, schoolId))).toHaveLength(subjectsPerExam * 4);
    expect(await db.select().from(examClassTable).where(eq(examClassTable.schoolId, schoolId))).toHaveLength(13 * 4);
    const lifecycles = await db.select().from(examLifecycleTable).where(eq(examLifecycleTable.schoolId, schoolId));
    expect(lifecycles.map((row) => row.status)).toEqual(['ready', 'ready', 'ready', 'ready']);

    // The question paper tab can open a paper of the first examination.
    const papers = await client.school.listQuestionPapers({ schoolId, sessionId: result.sessionId, examSlug: 'first_term' });
    expect(papers.classes).toHaveLength(13);

    expect(await client.school.getOnboarding({ schoolId })).toEqual({ state: 'completed' });
    await expectRpcCode(client.school.completeOnboarding(input), 'CONFLICT');
    await expectRpcCode(client.school.skipOnboarding({ schoolId }), 'CONFLICT');
  });

  it('takes the chosen classes, examinations and subjects, deriving slugs for any name', async () => {
    const { client, schoolId } = await ownSchool();
    await client.school.completeOnboarding({
      schoolId,
      sessionStartYear: 2025,
      examNames: ['Half Yearly', 'अर्धवार्षिक'],
      classSlugs: ['class-11', 'ukg'],
      subjects: { prePrimary: ['English', 'हिंदी'], seniorSecondary: ['Physics'], middle: [] },
    });
    const [session] = await db.select().from(schoolSessionTable).where(eq(schoolSessionTable.schoolId, schoolId));
    expect(session!.sessionConfig?.examConfig).toEqual({ half_yearly: { name: 'Half Yearly', order: 1 }, exam_2: { name: 'अर्धवार्षिक', order: 2 } });
    const classes = await db.select().from(classTable).where(eq(classTable.schoolId, schoolId)).orderBy(asc(classTable.displayOrder));
    // Catalogue order, whatever order they were sent in.
    expect(classes.map((entry) => entry.slug)).toEqual(['ukg', 'class-11']);
    expect(Object.keys(classes[0]!.config?.subjects ?? {})).toEqual(['english', 'subject-2']);
    expect(await db.select().from(examPlanTable).where(eq(examPlanTable.schoolId, schoolId))).toHaveLength(3 * 2);
  });

  it('refuses invalid answers before writing anything', async () => {
    const { client, schoolId } = await ownSchool();
    await expectRpcCode(client.school.completeOnboarding({ ...proposal(schoolId), examNames: ['Term 1', ' term  1 '] }), 'BAD_REQUEST');
    await expectRpcCode(client.school.completeOnboarding({ ...proposal(schoolId), examNames: [] }), 'BAD_REQUEST');
    await expectRpcCode(client.school.completeOnboarding({ ...proposal(schoolId), classSlugs: [] }), 'BAD_REQUEST');
    await expectRpcCode(client.school.completeOnboarding({ ...proposal(schoolId), classSlugs: ['class-13'] }), 'BAD_REQUEST');
    await expectRpcCode(
      client.school.completeOnboarding({ ...proposal(schoolId), subjects: { ...proposal(schoolId).subjects, primary: [] } }),
      'BAD_REQUEST',
    );
    await expectRpcCode(
      client.school.completeOnboarding({ ...proposal(schoolId), subjects: { ...proposal(schoolId).subjects, middle: ['Science', 'science'] } }),
      'BAD_REQUEST',
    );
    expect(await db.select().from(classTable).where(eq(classTable.schoolId, schoolId))).toHaveLength(0);
    expect(await client.school.getOnboarding({ schoolId })).toEqual({ state: 'pending' });
  });

  it('never adds to a school that already has a session', async () => {
    const { client, schoolId } = await ownSchool();
    await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true });
    const error = await errorOf(client.school.completeOnboarding(proposal(schoolId)));
    expect(error).toMatchObject({ code: 'CONFLICT', data: { reason: ONBOARDING_SCHOOL_NOT_EMPTY_REASON } });
    expect(await db.select().from(classTable).where(eq(classTable.schoolId, schoolId))).toHaveLength(0);
    expect(await client.school.getOnboarding({ schoolId })).toEqual({ state: 'pending' });
  });

  it('can be set aside and still finished later', async () => {
    const { client, schoolId } = await ownSchool();
    await client.school.skipOnboarding({ schoolId });
    await client.school.skipOnboarding({ schoolId });
    expect(await client.school.getOnboarding({ schoolId })).toEqual({ state: 'skipped' });
    const [row] = await db.select().from(schoolOnboardingTable).where(eq(schoolOnboardingTable.schoolId, schoolId));
    expect(row!.skippedAt).not.toBeNull();

    await client.school.completeOnboarding(proposal(schoolId));
    expect(await client.school.getOnboarding({ schoolId })).toEqual({ state: 'completed' });
  });

  it('runs once when submitted twice at the same time', async () => {
    const { client, schoolId } = await ownSchool();
    const results = await Promise.allSettled([1, 2].map(() => client.school.completeOnboarding(proposal(schoolId))));
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(await db.select().from(schoolSessionTable).where(eq(schoolSessionTable.schoolId, schoolId))).toHaveLength(1);
  });

  it('needs the permissions of every step, not only membership', async () => {
    const { schoolId } = await ownSchool();
    const { session } = await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [] } }]);
    const teacher = createTestClient(session);
    expect(await teacher.school.getOnboarding({ schoolId })).toEqual({ state: 'pending' });
    await expectRpcCode(teacher.school.completeOnboarding(proposal(schoolId)), 'FORBIDDEN');
    await expectRpcCode(teacher.school.skipOnboarding({ schoolId }), 'FORBIDDEN');
  });
});

describe('academicSessionStartYear', () => {
  it('starts the session in April, in India’s time zone', () => {
    expect(academicSessionStartYear(new Date('2026-11-18T10:00:00Z'))).toBe(2026);
    expect(academicSessionStartYear(new Date('2027-02-10T10:00:00Z'))).toBe(2026);
    // 31 March 20:00 UTC is already 1 April in India.
    expect(academicSessionStartYear(new Date('2027-03-31T20:00:00Z'))).toBe(2027);
  });
});
