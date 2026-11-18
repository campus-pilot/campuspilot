import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import type { ClassConfig } from '@campuspilot/db/schema/jsonb/class-config';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolOnboardingTable } from '@campuspilot/db/schema/school-creation';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';

import { rpcError } from '../errors';
import { createClassRecord } from '../routers/school/class/class.router';
import { generateExamPlanRecords } from '../routers/school/exam/exam-plan.router';
import { prepareExamPlan } from '../routers/school/exam/exam-plan-generation';
import { createSchoolSessionRecord } from '../routers/school/session/session.router';
import {
  ONBOARDING_CLASSES,
  ONBOARDING_SCHOOL_NOT_EMPTY_REASON,
  ONBOARDING_SUBJECT_EXAM_MODES,
  onboardingExamSlugs,
  onboardingSubjectSlugs,
  type CompleteSchoolOnboardingInput,
  type SchoolOnboardingState,
} from './school-onboarding.contract';

/**
 * The guided setup of a self-created school (docs/school-creation.md,
 * "Guided setup"). The guide's facts are its `school_onboarding` row; the
 * setup itself goes through the same functions as `school.createSession`,
 * `school.createClass` and `school.generateExamPlan`, so it is validated and
 * stored exactly as if the person had used those screens.
 */

/** Offers the guide to a school; called by the creation of a person's own school. */
export async function offerSchoolOnboarding(db: DatabaseExecutor, schoolId: string): Promise<void> {
  await db.insert(schoolOnboardingTable).values({ schoolId });
}

/** Where the school stands with its guide (see `SCHOOL_ONBOARDING_STATES`). */
export async function readSchoolOnboardingState(db: DatabaseExecutor, schoolId: string): Promise<SchoolOnboardingState> {
  const [row] = await db
    .select({ completedAt: schoolOnboardingTable.completedAt, skippedAt: schoolOnboardingTable.skippedAt })
    .from(schoolOnboardingTable)
    .where(eq(schoolOnboardingTable.schoolId, schoolId))
    .limit(1);
  return stateOf(row);
}

function stateOf(row: { completedAt: Date | null; skippedAt: Date | null } | undefined): SchoolOnboardingState {
  if (!row) return 'not_offered';
  if (row.completedAt) return 'completed';
  return row.skippedAt ? 'skipped' : 'pending';
}

/** The school's guide row, locked until the transaction ends, after locking the school itself. */
async function lockOnboarding(transaction: DatabaseExecutor, schoolId: string) {
  const [school] = await transaction
    .select({ id: schoolTable.id })
    .from(schoolTable)
    .where(eq(schoolTable.id, schoolId))
    .for('update')
    .limit(1);
  if (!school) throw rpcError.notFound('School');
  const [row] = await transaction
    .select()
    .from(schoolOnboardingTable)
    .where(eq(schoolOnboardingTable.schoolId, schoolId))
    .for('update')
    .limit(1);
  if (!row) throw rpcError.notFound('Guided setup');
  return row;
}

/** The subjects of one class, each with the single Written mode (`ONBOARDING_SUBJECT_EXAM_MODES`). */
function subjectsConfig(names: readonly string[]): ClassConfig {
  const slugs = onboardingSubjectSlugs(names);
  return {
    subjects: Object.fromEntries(
      names.map((name, index) => [slugs[index]!, { name, books: [], examModes: structuredClone(ONBOARDING_SUBJECT_EXAM_MODES) }]),
    ),
  };
}

/**
 * Sets the school up from the guide's answers, in the caller's transaction,
 * after the caller checked the permissions of each step (creating a session,
 * examinations, classes and exam plans):
 *
 * 1. locks the school and its guide row; a school without the guide is
 *    NOT_FOUND and a finished guide CONFLICT, so a second submission (a
 *    double tap, another tab) changes nothing;
 * 2. refuses a school that already has a session or a class (CONFLICT with
 *    `ONBOARDING_SCHOOL_NOT_EMPTY`): the guide only ever starts a school, it
 *    never adds to one set up another way;
 * 3. creates the session (`sessionStartYear` to the next year) with the
 *    examinations, which becomes active as the school's first;
 * 4. creates the chosen classes in catalogue order, each with section A and
 *    its stage's subjects;
 * 5. generates every examination's plan for all of those classes;
 * 6. records the guide as finished.
 *
 * Any refusal rolls all of it back. Setting a skipped guide's facts aside is
 * not needed: `skipped_at` stays as the record that it was put off once.
 */
export async function completeSchoolOnboarding(
  transaction: DatabaseTransaction,
  input: CompleteSchoolOnboardingInput,
  now: Date,
): Promise<{ sessionId: string; examSlugs: string[]; classCount: number; planCount: number }> {
  const { schoolId } = input;
  const onboarding = await lockOnboarding(transaction, schoolId);
  if (onboarding.completedAt) throw rpcError.conflict('This school has already been set up.');

  const [existingSession] = await transaction
    .select({ id: schoolSessionTable.id })
    .from(schoolSessionTable)
    .where(eq(schoolSessionTable.schoolId, schoolId))
    .limit(1);
  const [existingClass] = await transaction
    .select({ id: classTable.id })
    .from(classTable)
    .where(eq(classTable.schoolId, schoolId))
    .limit(1);
  if (existingSession || existingClass) {
    throw new ORPCError('CONFLICT', {
      message: 'This school already has a session or classes, so the guided setup can no longer run. Continue in the app.',
      data: { reason: ONBOARDING_SCHOOL_NOT_EMPTY_REASON },
    });
  }

  const examSlugs = onboardingExamSlugs(input.examNames);
  const session = await createSchoolSessionRecord(transaction, {
    schoolId,
    sessionStartYear: input.sessionStartYear,
    sessionEndYear: input.sessionStartYear + 1,
    sessionConfig: sessionConfigSchema.parse({
      examConfig: Object.fromEntries(input.examNames.map((name, index) => [examSlugs[index]!, { name, order: index + 1 }])),
    }),
  });

  const chosen = new Set(input.classSlugs);
  const classes = ONBOARDING_CLASSES.filter((entry) => chosen.has(entry.slug));
  for (const entry of classes) {
    await createClassRecord(transaction, {
      schoolId,
      slug: entry.slug,
      label: entry.label,
      config: subjectsConfig(input.subjects[entry.stage] ?? []),
      sections: [{ slug: 'a', label: 'A' }],
    });
  }

  let planCount = 0;
  for (const examSlug of examSlugs) {
    const scope = { schoolId, sessionId: session.id, examSlug };
    const { preview } = await prepareExamPlan(transaction, scope);
    const generated = await generateExamPlanRecords(transaction, { ...scope, configurationVersion: preview.configurationVersion });
    planCount += generated.createdCount;
  }

  await transaction
    .update(schoolOnboardingTable)
    .set({ completedAt: now })
    .where(eq(schoolOnboardingTable.schoolId, schoolId));
  return { sessionId: session.id, examSlugs, classCount: classes.length, planCount };
}

/**
 * Sets the guide aside (Set up later): it stops opening on its own, and the
 * school is set up from the app's own screens. A finished guide is CONFLICT;
 * setting it aside twice keeps the first time.
 */
export async function skipSchoolOnboarding(transaction: DatabaseExecutor, schoolId: string, now: Date): Promise<void> {
  const onboarding = await lockOnboarding(transaction, schoolId);
  if (onboarding.completedAt) throw rpcError.conflict('This school has already been set up.');
  if (onboarding.skippedAt) return;
  await transaction.update(schoolOnboardingTable).set({ skippedAt: now }).where(eq(schoolOnboardingTable.schoolId, schoolId));
}
