import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { createAuth } from '@campuspilot/auth/server';
import { staffPlaceholderEmail } from '@campuspilot/auth/staff-login';
import { db as defaultDb, type DatabaseTransaction } from '@campuspilot/db';
import { BILLING_PERIOD_DAYS } from '@campuspilot/db/feature-flags/catalogue';
import { phoneNumberSchema } from '@campuspilot/db/phone';
import { account, user } from '@campuspilot/db/schema/auth';
import { classTable } from '@campuspilot/db/schema/class';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { schoolSetupTable, type SchoolSetupError, type SchoolSetupResult } from '@campuspilot/db/schema/school-setup';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { startTrialPeriod } from '../billing/billing.service';
import { setSchoolFeature } from '../feature-flags/feature-flags.service';
import { createClassRecord } from '../routers/school/class/class.router';
import { generateExamPlanRecords } from '../routers/school/exam/exam-plan.router';
import { prepareExamPlan } from '../routers/school/exam/exam-plan-generation';
import { createSchoolSessionRecord } from '../routers/school/session/session.router';
import { onboardingExamSlugs } from '../school-onboarding/school-onboarding.contract';
import { subjectsConfig } from '../school-onboarding/school-onboarding.service';
import {
  KNOWN_CLASS_SLUGS,
  schoolSetupReadySchema,
  setupSlugs,
  type SchoolSetupDraft,
  type SchoolSetupRunStep,
} from './school-setup.contract';
import { selectDefaultDocumentTemplates, withDefaultDocumentTemplates, type DefaultTemplateUploads } from '../routers/school/document/document.default-templates';

/**
 * The work of the `SchoolSetup` workflow, one function per step. Each step
 * runs in one transaction that first locks the setup row and checks it is
 * still this attempt's running setup, does its writes, and records the step
 * as completed in the same transaction. So a step's writes and its
 * "completed" mark commit together: a replay after a crash finds the mark and
 * does nothing, and a failed step leaves nothing half-written. The steps use
 * the same record functions as the school's own procedures
 * (`createSchoolSessionRecord`, `createClassRecord`, the exam plan
 * generation, `setSchoolFeature`, `startTrialPeriod`), like the guided setup.
 */

/** A deterministic refusal whose message is safe to show the admin; the workflow makes it terminal. */
export class SchoolSetupStepError extends Error {
  override name = 'SchoolSetupStepError';
}

type SetupRow = typeof schoolSetupTable.$inferSelect;

/** The setup's running attempt, locked; refuses anything else so a stale run never writes. */
async function lockRunningSetup(transaction: DatabaseTransaction, setupId: string, attempt: number): Promise<SetupRow> {
  const [setup] = await transaction.select().from(schoolSetupTable).where(eq(schoolSetupTable.id, setupId)).for('update').limit(1);
  if (!setup) throw new SchoolSetupStepError('The school setup no longer exists.');
  if (setup.attempt !== attempt || setup.status !== 'running') throw new SchoolSetupStepError('This attempt is no longer the running one.');
  return setup;
}

function draftOf(setup: SetupRow): SchoolSetupDraft {
  const parsed = schoolSetupReadySchema.safeParse(setup.draft);
  if (!parsed.success) throw new SchoolSetupStepError('The saved setup is incomplete. Open it, fix the highlighted answers and start again.');
  return parsed.data;
}

function requireSchool(setup: SetupRow) {
  if (!setup.schoolId) throw new SchoolSetupStepError('The school has not been created yet.');
  return setup.schoolId;
}

function requireRequester(setup: SetupRow) {
  if (!setup.requestedBy) throw new SchoolSetupStepError('The admin who started this setup no longer exists.');
  return setup.requestedBy;
}

async function onlySessionOf(transaction: DatabaseTransaction, schoolId: string) {
  const [session] = await transaction
    .select({ id: schoolSessionTable.id, config: schoolSessionTable.sessionConfig })
    .from(schoolSessionTable)
    .where(eq(schoolSessionTable.schoolId, schoolId))
    .limit(1);
  if (!session) throw new SchoolSetupStepError('The session has not been created yet.');
  return session;
}

/** Copies the request's logo into the school's own logo prefix, as the logo upload route names it. */
async function copyRequestLogo(requestId: string, schoolId: string, transaction: DatabaseTransaction) {
  const [request] = await transaction
    .select({ key: schoolRegistrationRequestTable.logoS3Key })
    .from(schoolRegistrationRequestTable)
    .where(eq(schoolRegistrationRequestTable.id, requestId))
    .limit(1);
  if (!request?.key) return null;
  const extension = request.key.split('.').pop() ?? 'png';
  const key = `schools/${schoolId}/logo/${randomUUID()}.${extension}`;
  await getS3Client().send(new CopyObjectCommand({ Bucket: env.S3_BUCKET, CopySource: `${env.S3_BUCKET}/${request.key}`, Key: key }));
  return key;
}

/**
 * Creates the school. Like every new school it starts with the default
 * document templates selected; their objects are recorded in `uploads`, which
 * the step's runner removes when the step's transaction fails.
 */
async function stepSchool(transaction: DatabaseTransaction, setup: SetupRow, draft: SchoolSetupDraft, uploads: DefaultTemplateUploads) {
  const [taken] = await transaction.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.slug, draft.school.slug)).limit(1);
  if (taken) throw new SchoolSetupStepError(`Another school already uses the address "${draft.school.slug}". Change it on the School step.`);
  const [school] = await transaction
    .insert(schoolTable)
    .values({
      slug: draft.school.slug,
      name: draft.school.name.trim(),
      location: draft.school.location.trim(),
      registrationNo: draft.school.registrationNo.trim() || null,
      tier: draft.plan.standingTier,
    })
    .returning({ id: schoolTable.id });
  if (!school) throw new Error('The school was not inserted.');
  // The object is written before commit; if the transaction then fails it is
  // left unreferenced under the (never committed) school's prefix.
  const logoS3Key = draft.school.useRequestLogo ? await copyRequestLogo(setup.requestId, school.id, transaction) : null;
  if (logoS3Key) await transaction.update(schoolTable).set({ logoS3Key }).where(eq(schoolTable.id, school.id));
  await selectDefaultDocumentTemplates(transaction, uploads, { schoolId: school.id, createdBy: requireRequester(setup) });
  await transaction.update(schoolSetupTable).set({ schoolId: school.id }).where(eq(schoolSetupTable.id, setup.id));
}

async function stepPlan(transaction: DatabaseTransaction, setup: SetupRow, draft: SchoolSetupDraft, now: Date) {
  const schoolId = requireSchool(setup);
  const requestedBy = requireRequester(setup);
  await transaction.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, schoolId)).for('update');
  const { trial } = draft.plan;
  if (trial.enabled) {
    const endsAt = new Date(now.getTime() + trial.periods * BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    await startTrialPeriod(transaction, { schoolId, tier: trial.tier, endsAt, createdBy: requestedBy });
  }
  for (const [feature, enabled] of Object.entries(draft.features.adjustments)) {
    if (typeof enabled !== 'boolean') continue;
    const config =
      feature === 'assistant' && enabled ? { monthlyLimitUsd: draft.features.assistantMonthlyLimitUsd, voice: { enabled: false } } : null;
    await setSchoolFeature(transaction, { schoolId, feature, enabled, config, updatedBy: requestedBy } as Parameters<typeof setSchoolFeature>[1]);
  }
}

async function stepSession(transaction: DatabaseTransaction, setup: SetupRow, draft: SchoolSetupDraft) {
  const schoolId = requireSchool(setup);
  const examNames = draft.session.examNames.map((name) => name.trim());
  const examSlugs = onboardingExamSlugs(examNames);
  await createSchoolSessionRecord(transaction, {
    schoolId,
    sessionStartYear: draft.session.startYear,
    sessionEndYear: draft.session.startYear + 1,
    sessionConfig: sessionConfigSchema.parse({
      examConfig: Object.fromEntries(examNames.map((name, index) => [examSlugs[index]!, { name, order: index + 1 }])),
    }),
  });
}

async function stepClasses(transaction: DatabaseTransaction, setup: SetupRow, draft: SchoolSetupDraft) {
  const schoolId = requireSchool(setup);
  const classSlugs = setupSlugs(
    draft.classes.map((entry) => entry.name),
    'class',
    KNOWN_CLASS_SLUGS,
  );
  for (const [index, entry] of draft.classes.entries()) {
    const sectionSlugs = setupSlugs(entry.sections, 'section');
    await createClassRecord(transaction, {
      schoolId,
      slug: classSlugs[index]!,
      label: entry.name.trim(),
      config: subjectsConfig(entry.subjects),
      sections: entry.sections.map((label, sectionIndex) => ({ slug: sectionSlugs[sectionIndex]!, label })),
    });
  }
}

async function stepExamPlans(transaction: DatabaseTransaction, setup: SetupRow) {
  const schoolId = requireSchool(setup);
  const session = await onlySessionOf(transaction, schoolId);
  for (const examSlug of Object.keys(session.config?.examConfig ?? {})) {
    const scope = { schoolId, sessionId: session.id, examSlug };
    // Prepared under the generation's locks; the classes step committed the configuration it reads.
    const prepared = await prepareExamPlan(transaction, scope, true);
    await generateExamPlanRecords(transaction, { ...scope, configurationVersion: prepared.preview.configurationVersion }, prepared);
  }
}

/** Adds a role to a person in the school, making them a member first when needed; repeats change nothing. */
async function grantRole(transaction: DatabaseTransaction, schoolId: string, userId: string, role: 'manager' | 'principal') {
  await transaction.insert(schoolMemberTable).values({ schoolId, userId }).onConflictDoNothing();
  const [existing] = await transaction
    .select({ role: schoolUserRoleTable.role })
    .from(schoolUserRoleTable)
    .where(and(eq(schoolUserRoleTable.schoolId, schoolId), eq(schoolUserRoleTable.userId, userId), eq(schoolUserRoleTable.role, role)))
    .limit(1);
  if (!existing) await transaction.insert(schoolUserRoleTable).values({ schoolId, userId, role });
}

/**
 * The principal: an existing account with the phone number, else with the
 * email, else a new one. A new account gets no password here: passwords
 * never pass through the worker or its journal, so the admin issues one from
 * the result screen (`school.issueMemberPassword`), shown once.
 */
async function findOrCreatePrincipal(transaction: DatabaseTransaction, draftPrincipal: SchoolSetupDraft['people']['principal']) {
  // Typed in any common format in the wizard; looked up and stored in E.164.
  const principal = { ...draftPrincipal, phone: draftPrincipal.phone ? phoneNumberSchema.parse(draftPrincipal.phone) : '', email: draftPrincipal.email.trim() };
  const byPhone = principal.phone
    ? await transaction.query.user.findFirst({ columns: { id: true }, where: eq(user.phoneNumber, principal.phone) })
    : undefined;
  const byEmail = !byPhone && principal.email
    ? await transaction.query.user.findFirst({ columns: { id: true }, where: eq(sql`lower(${user.email})`, principal.email.toLowerCase()) })
    : undefined;
  const found = byPhone ?? byEmail;
  if (found) return { userId: found.id };
  const auth = createAuth(transaction);
  const created = await auth.api.createUser({
    body: {
      email: principal.email || staffPlaceholderEmail(),
      name: principal.name.trim(),
      data: {
        // An administrator's entry is the attestation, as a school invitation is.
        emailVerified: Boolean(principal.email),
        emailIsPlaceholder: !principal.email,
        ...(principal.phone ? { phoneNumber: principal.phone, phoneNumberVerified: true } : {}),
      },
    },
  });
  return { userId: created.user.id };
}

async function stepPeople(transaction: DatabaseTransaction, setup: SetupRow, draft: SchoolSetupDraft) {
  const schoolId = requireSchool(setup);
  const requestedBy = requireRequester(setup);
  if (draft.people.addMeAsManager) await grantRole(transaction, schoolId, requestedBy, 'manager');
  const principal = await findOrCreatePrincipal(transaction, draft.people.principal);
  await grantRole(transaction, schoolId, principal.userId, 'principal');
  await transaction.update(schoolTable).set({ ownerUserId: principal.userId }).where(eq(schoolTable.id, schoolId));
}

/**
 * Runs one workflow step exactly once (see the module comment): a step
 * already completed, by this attempt or an earlier one, does nothing.
 */
export async function runSchoolSetupStep(setupId: string, attempt: number, step: SchoolSetupRunStep, now: Date, db = defaultDb): Promise<void> {
  await withDefaultDocumentTemplates((uploads) => db.transaction(async (transaction) => {
    const setup = await lockRunningSetup(transaction, setupId, attempt);
    if (setup.completedSteps.includes(step)) return;
    const draft = draftOf(setup);
    if (step === 'school') await stepSchool(transaction, setup, draft, uploads);
    if (step === 'plan') await stepPlan(transaction, setup, draft, now);
    if (step === 'session') await stepSession(transaction, setup, draft);
    if (step === 'classes') await stepClasses(transaction, setup, draft);
    if (step === 'exam-plans') await stepExamPlans(transaction, setup);
    if (step === 'people') await stepPeople(transaction, setup, draft);
    await transaction
      .update(schoolSetupTable)
      .set({ currentStep: step, completedSteps: sql`${schoolSetupTable.completedSteps} || ${JSON.stringify([step])}::jsonb` })
      .where(eq(schoolSetupTable.id, setupId));
  }));
}

/** The setup row the workflow starts from, or null when it is gone. */
export async function loadSchoolSetup(setupId: string, db = defaultDb) {
  const [setup] = await db.select().from(schoolSetupTable).where(eq(schoolSetupTable.id, setupId)).limit(1);
  return setup ?? null;
}

/** Marks the attempt running (from queued); null when it is no longer the queued or running attempt. */
export async function markSchoolSetupRunning(setupId: string, attempt: number, now: Date, db = defaultDb) {
  const [row] = await db
    .update(schoolSetupTable)
    .set({ status: 'running', startedAt: now })
    .where(and(eq(schoolSetupTable.id, setupId), eq(schoolSetupTable.attempt, attempt), sql`${schoolSetupTable.status} in ('queued', 'running')`))
    .returning({ id: schoolSetupTable.id });
  return Boolean(row);
}

/** Records the step the workflow is on, for the admin's progress view (fenced by attempt). */
export async function markSchoolSetupStep(setupId: string, attempt: number, step: SchoolSetupRunStep, db = defaultDb) {
  await db
    .update(schoolSetupTable)
    .set({ currentStep: step })
    .where(and(eq(schoolSetupTable.id, setupId), eq(schoolSetupTable.attempt, attempt), eq(schoolSetupTable.status, 'running')));
}

export async function markSchoolSetupSucceeded(setupId: string, attempt: number, result: SchoolSetupResult, now: Date, db = defaultDb) {
  await db
    .update(schoolSetupTable)
    .set({ status: 'succeeded', result, error: null, finishedAt: now })
    .where(and(eq(schoolSetupTable.id, setupId), eq(schoolSetupTable.attempt, attempt), eq(schoolSetupTable.status, 'running')));
}

export async function markSchoolSetupFailed(setupId: string, attempt: number, error: SchoolSetupError, now: Date, db = defaultDb) {
  await db
    .update(schoolSetupTable)
    .set({ status: 'failed', error, finishedAt: now })
    .where(and(eq(schoolSetupTable.id, setupId), eq(schoolSetupTable.attempt, attempt), sql`${schoolSetupTable.status} in ('queued', 'running')`));
}

/** What the finished setup created, read back from the database (so a retried attempt reports the same). */
export async function readSchoolSetupResult(setupId: string, db = defaultDb): Promise<SchoolSetupResult> {
  const setup = await loadSchoolSetup(setupId, db);
  if (!setup?.schoolId) throw new SchoolSetupStepError('The school was not created.');
  const schoolId = setup.schoolId;
  const [school] = await db.select({ ownerUserId: schoolTable.ownerUserId }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (!school?.ownerUserId) throw new SchoolSetupStepError('The school has no principal yet.');
  const ownerUserId = school.ownerUserId;
  const [session] = await db
    .select({ id: schoolSessionTable.id, config: schoolSessionTable.sessionConfig })
    .from(schoolSessionTable)
    .where(eq(schoolSessionTable.schoolId, schoolId))
    .limit(1);
  const [classes] = await db.select({ count: count() }).from(classTable).where(eq(classTable.schoolId, schoolId));
  const [password] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, ownerUserId), eq(account.providerId, 'credential'), isNotNull(account.password)))
    .limit(1);
  return {
    schoolId,
    sessionId: session?.id ?? '',
    classCount: classes?.count ?? 0,
    examCount: Object.keys(session?.config?.examConfig ?? {}).length,
    principalUserId: ownerUserId,
    principalHasPassword: Boolean(password),
  };
}
