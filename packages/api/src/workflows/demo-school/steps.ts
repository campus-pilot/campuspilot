import { PutObjectCommand } from '@aws-sdk/client-s3';
import { auth, createAuth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { user } from '@campuspilot/db/schema/auth';
import {
  financeAdjustmentTable,
  financeBillTable,
  financePaymentTable,
} from '@campuspilot/db/schema/finance';
import type { DemoSchoolJobResult } from '@campuspilot/db/schema/demo-school-job';
import { examLifecycleTable } from '@campuspilot/db/schema/exam';
import { noticeTable } from '@campuspilot/db/schema/notice';
import type { FinanceSchemaConfig } from '@campuspilot/db/schema/jsonb/finance-config';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { studentTable } from '@campuspilot/db/schema/student';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { createRouterClient, type RouterClient } from '@orpc/server';
import { and, count, eq, inArray, isNotNull, sql, sum } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';

import type { Context } from '../../context';
import { assertPermission } from '../../permissions/authorization';
import { appRouter } from '../../routers';
import { ADMISSION_PHOTO_FIELD_NAME } from '../../routers/school/admission/admission.constants';
import { handleAdmissionPhotoUpload } from '../../routers/school/admission/admission.http';
import type { DocumentType } from '../../routers/school/document/document.dto';
import { SCHOOL_LOGO_FIELD_NAME } from '../../routers/system-admin/school/school.constants';
import { handleSchoolLogoUpload } from '../../routers/system-admin/school/school.http';
import { demoCredentialsS3Key } from './constants';
import { localTimeInstant } from './dates';
import { generateDemoPassword } from './identity';
import { renderAvatar, renderMonogramLogo } from './images';
import { assertUploadsKept, createDemoSchoolJobContext } from './job-context';
import {
  billedMonthIndexes,
  buildDemoPlan,
  paymentEvents,
  type DemoClass,
  type DemoExam,
  type DemoNotice,
  type DemoPlan,
  type DemoStaffMember,
  type DemoStudent,
} from './plan';
import { createRandom } from './prng';
import { demoSeed } from './seed';
import type { DemoJobSnapshot } from './job-store';

/**
 * Demo seed steps (plan §6). Each is a plain async function taking a
 * {@link SeedContext}, so integration tests call them without Restate, and
 * each is idempotent: it looks its work up by natural key (email, session
 * years, class slug, admission number, period key) or sends a
 * `demo:{jobId}:…` idempotency key, so a replayed or retried step changes
 * nothing. Steps return only IDs and counts, which is all that enters the
 * Restate journal.
 */

/** A deterministic, user-facing seed failure; workflows treat it as terminal. */
export class DemoSeedError extends Error {
  override name = 'DemoSeedError';
}

export type SeedContext = {
  jobId: string;
  schoolId: string;
  seed: string;
  plan: DemoPlan;
  /** The `system-job` context acting as the requesting admin (principal). */
  context: Context;
  rpc: RouterClient<typeof appRouter>;
};

/**
 * Builds a step's context. The router context is rebuilt for every step, so
 * the `system-job` guards (demo school, principal role) are re-checked each
 * time and a purged school stops the next step.
 */
export async function createSeedContext(job: DemoJobSnapshot, run: { seed: string; asOf: string }): Promise<SeedContext> {
  const context = await createDemoSchoolJobContext(job.jobId);
  return {
    jobId: job.jobId,
    schoolId: job.schoolId,
    seed: run.seed,
    plan: buildDemoPlan({ input: job.input, seed: run.seed, asOf: new Date(run.asOf), school: job.school }),
    context,
    rpc: createRouterClient(appRouter, { context }),
  };
}

function demoKey(ctx: SeedContext, ...parts: Array<string | number>) {
  return ['demo', ctx.jobId, ...parts].join(':');
}

function imageRequest(url: string, fieldName: string, bytes: Buffer, filename: string) {
  const form = new FormData();
  form.set(fieldName, new File([new Uint8Array(bytes)], filename, { type: 'image/png' }));
  return new Request(url, { method: 'POST', body: form });
}

/** Fails the step when an HTTP upload handler returned an error, else returns its JSON body. */
async function assertUploaded<T>(response: Response, subject: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (response.ok && body) return body;
  throw new DemoSeedError(`Uploading the ${subject} failed: ${body?.message ?? response.status}`);
}

// ---------------------------------------------------------------------------
// §6.1–6.2 School logo and staff

/** Uploads a generated monogram unless the admin supplied a logo. */
export async function seedSchoolLogo(ctx: SeedContext): Promise<{ generated: boolean }> {
  const [school] = await db.select({ logoS3Key: schoolTable.logoS3Key }).from(schoolTable).where(eq(schoolTable.id, ctx.schoolId)).limit(1);
  if (school?.logoS3Key) return { generated: false };
  const png = renderMonogramLogo(createRandom(ctx.seed, 'logo'), ctx.plan.schoolName);
  const response = await handleSchoolLogoUpload(
    imageRequest('http://worker.local/logo', SCHOOL_LOGO_FIELD_NAME, png, 'logo.png'),
    ctx.context,
    ctx.schoolId,
  );
  const uploaded = await assertUploaded<{ logoS3Key: string | null }>(response, 'school logo');
  await assertUploadsKept(ctx.jobId, ctx.schoolId, [uploaded.logoS3Key ?? '']);
  return { generated: true };
}

/**
 * Creates one demo staff account, its school membership and role, and marks
 * it `demo_school_id = schoolId`, all in one transaction. This is the
 * `inviteMember` write path (same OPA action, same Better Auth provisioning),
 * done here so the demo marker can never be missing from an account the seed
 * created. A replay recognises its own account only by that marker; any other
 * existing account with the address fails the step instead of being adopted.
 */
export async function seedStaffMember(ctx: SeedContext, member: DemoStaffMember): Promise<{ userId: string }> {
  await assertPermission(ctx.context, { action: SCHOOL_ACTIONS.INVITE_MEMBER, resource: { kind: 'school', schoolId: ctx.schoolId } });
  const existing = await db.query.user.findFirst({ columns: { id: true, demoSchoolId: true }, where: eq(user.email, member.email) });
  let userId: string;
  if (existing) {
    if (existing.demoSchoolId !== ctx.schoolId) {
      throw new DemoSeedError(`The account ${member.email} already exists and is not part of this demo school.`);
    }
    userId = existing.id;
  } else {
    userId = await db.transaction(async (transaction) => {
      const created = await createAuth(transaction).api.createUser({
        body: { email: member.email, name: member.name, data: { emailVerified: true } },
      });
      await transaction.update(user).set({ demoSchoolId: ctx.schoolId }).where(eq(user.id, created.user.id));
      await transaction.insert(schoolMemberTable).values({ schoolId: ctx.schoolId, userId: created.user.id });
      await transaction.insert(schoolUserRoleTable).values({
        schoolId: ctx.schoolId,
        userId: created.user.id,
        role: member.role,
        meta: member.role === 'teacher' ? { classIds: [] } : null,
      });
      return created.user.id;
    });
  }

  const [current] = await db.select({ profileImageS3Key: user.profileImageS3Key }).from(user).where(eq(user.id, userId)).limit(1);
  if (!current?.profileImageS3Key) {
    // There is no procedure for setting another user's image; this mirrors
    // the profile-image upload handler's key layout for a demo-only account.
    const key = `users/${userId}/profile-image/${randomUUID()}.png`;
    const png = renderAvatar(createRandom(ctx.seed, 'avatar', member.key), { style: 'adult', gender: member.gender });
    await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: png, ContentLength: png.byteLength, ContentType: 'image/png' }));
    await assertUploadsKept(ctx.jobId, ctx.schoolId, [key]);
    await db.update(user).set({ profileImageS3Key: key }).where(eq(user.id, userId));
  }
  return { userId };
}

// ---------------------------------------------------------------------------
// §6.3 Session

export async function seedSession(ctx: SeedContext): Promise<{ sessionId: string }> {
  const { plan, schoolId } = ctx;
  const sessions = await ctx.rpc.school.listSessions({ schoolId });
  let session = sessions.items.find((item) => item.sessionStartYear === plan.startYear && item.sessionEndYear === plan.endYear);
  const seedSession = demoSeed.session;
  session ??= await ctx.rpc.school.createSession({
    schoolId,
    sessionStartYear: plan.startYear,
    sessionEndYear: plan.endYear,
    sessionConfig: {
      examConfig: Object.fromEntries(seedSession.exams.map((exam) => [exam.slug, { name: exam.name, order: exam.order }])),
      gradingScale: seedSession.gradingScale,
      coScholasticAreas: seedSession.coScholasticAreas,
      attendanceTracking: seedSession.attendanceTracking,
    },
  });
  if (!session.isActive) await ctx.rpc.school.activateSession({ schoolId, sessionId: session.id });
  await ctx.rpc.school.updateAdmissionSettings({ schoolId, settings: { documentTypes: seedSession.admissionDocumentTypes } });
  await ctx.rpc.school.updateCadetPortalSettings({ schoolId, showClassAverages: seedSession.cadetPortal.showClassAverages });
  return { sessionId: session.id };
}

// ---------------------------------------------------------------------------
// §6.4 Classes

async function findStaffUserId(ctx: SeedContext, key: string) {
  const member = ctx.plan.staff.find((item) => item.key === key)!;
  const found = await db.query.user.findFirst({
    columns: { id: true },
    where: and(eq(user.email, member.email), eq(user.demoSchoolId, ctx.schoolId)),
  });
  if (!found) throw new DemoSeedError(`Staff account ${member.email} is missing; the staff step must run first.`);
  return found.id;
}

/** Creates one class with section A and assigns its class teacher. */
export async function seedClass(ctx: SeedContext, sessionId: string, demoClass: DemoClass): Promise<{ classId: string; sectionId: string }> {
  const { schoolId } = ctx;
  const classes = await ctx.rpc.school.listClasses({ schoolId, sessionId });
  const classroom =
    classes.find((item) => item.slug === demoClass.seed.slug) ??
    (await ctx.rpc.school.createClass({
      schoolId,
      slug: demoClass.seed.slug,
      label: demoClass.seed.label,
      config: demoClass.config,
      sections: [{ slug: 'a', label: 'A' }],
    }));
  const [section] = await ctx.rpc.school.listSections({ schoolId, classId: classroom.id });
  if (!section) throw new DemoSeedError(`Class ${demoClass.seed.label} has no section.`);
  const teacherId = await findStaffUserId(ctx, demoClass.teacherKey);
  await ctx.rpc.school.updateMemberRoles({
    schoolId,
    userId: teacherId,
    roles: [{ role: 'teacher', meta: { classIds: [classroom.id] } }],
  });
  return { classId: classroom.id, sectionId: section.id };
}

// ---------------------------------------------------------------------------
// §6.5 Admissions and enrolment

async function admissionIdsByNumber(schoolId: string, admissionNos: string[]) {
  if (admissionNos.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: admissionTable.id, admissionNo: admissionTable.admissionNo })
    .from(admissionTable)
    .where(and(eq(admissionTable.schoolId, schoolId), inArray(admissionTable.admissionNo, admissionNos)));
  return new Map(rows.map((row) => [row.admissionNo, row.id]));
}

/** Admits, enrols and photographs every planned student of one class. */
export async function seedClassStudents(
  ctx: SeedContext,
  input: { sessionId: string; classId: string; sectionId: string; demoClass: DemoClass },
): Promise<{ students: number; photos: number }> {
  const { schoolId } = ctx;
  let photos = 0;
  const known = await admissionIdsByNumber(schoolId, input.demoClass.students.map((student) => student.admissionNo));
  for (const student of input.demoClass.students) {
    let admissionId = known.get(student.admissionNo);
    if (!admissionId) {
      const admission = await ctx.rpc.school.createAdmission({
        schoolId,
        name: student.name,
        admissionNo: student.admissionNo,
        admissionClassId: input.classId,
        address: student.address,
        phoneNo: student.phoneNo,
        // Demo guardians "confirmed" their number, but no consent is ever
        // recorded: a demo must not be able to send WhatsApp messages to
        // whoever owns a fake number (D-12 enforcement is still to come).
        whatsappSameAsPhone: true,
        whatsappVerified: true,
        whatsappConsent: false,
        dob: student.dob,
        fatherName: student.fatherName,
        motherName: student.motherName,
      });
      admissionId = admission.id;
    }
    const enrolled = await ctx.rpc.school.listStudents({ schoolId, sessionId: input.sessionId, filters: { admissionId } });
    if (enrolled.items.length === 0) {
      await ctx.rpc.school.createStudent({ schoolId, sessionId: input.sessionId, admissionId, sectionId: input.sectionId, rollNo: student.rollNo });
    }
    if (student.hasPhoto) {
      const [row] = await db.select({ photoS3Key: admissionTable.photoS3Key }).from(admissionTable).where(eq(admissionTable.id, admissionId)).limit(1);
      if (!row?.photoS3Key) {
        const png = renderAvatar(createRandom(ctx.seed, 'photo', student.admissionNo), { style: 'child', gender: student.gender });
        const response = await handleAdmissionPhotoUpload(
          imageRequest('http://worker.local/photo', ADMISSION_PHOTO_FIELD_NAME, png, 'photo.png'),
          ctx.context,
          { schoolId, admissionId },
        );
        const uploaded = await assertUploaded<{ photoS3Key: string | null }>(response, 'student photo');
        await assertUploadsKept(ctx.jobId, ctx.schoolId, [uploaded.photoS3Key ?? '']);
      }
      photos += 1;
    }
  }
  return { students: input.demoClass.students.length, photos };
}

// ---------------------------------------------------------------------------
// §6.6 Examinations

async function enrolmentsFor(ctx: SeedContext, sessionId: string, students: DemoStudent[]) {
  const ids = await admissionIdsByNumber(ctx.schoolId, students.map((student) => student.admissionNo));
  const rows = await db
    .select({ id: studentTable.id, admissionId: studentTable.admissionId, classId: studentTable.classId, registered: admissionTable.registered })
    .from(studentTable)
    .innerJoin(admissionTable, eq(admissionTable.id, studentTable.admissionId))
    .where(and(eq(studentTable.schoolId, ctx.schoolId), eq(studentTable.sessionId, sessionId), inArray(studentTable.admissionId, [...ids.values()])));
  const byAdmission = new Map(rows.map((row) => [row.admissionId, row]));
  return students.map((student) => {
    const enrolment = byAdmission.get(ids.get(student.admissionNo) ?? '');
    if (!enrolment?.classId) throw new DemoSeedError(`Student ${student.admissionNo} is not enrolled yet.`);
    return { student, studentId: enrolment.id, classId: enrolment.classId, registered: enrolment.registered };
  });
}

function primaryMode(demoClass: DemoClass, subjectSlug: string) {
  const modes = Object.entries(demoClass.config.subjects[subjectSlug]!.examModes);
  return modes.map(([slug]) => slug);
}

/**
 * Generates the exam plan, working days and the all-classroom timetable, and
 * opens the exam when `asOf` has reached its window.
 */
export async function seedExamSetup(ctx: SeedContext, sessionId: string, exam: DemoExam): Promise<{ status: string }> {
  const scope = { schoolId: ctx.schoolId, sessionId, examSlug: exam.slug };
  let overview = await ctx.rpc.school.getExamOverview(scope);
  if (overview.planCount === 0) {
    const preview = await ctx.rpc.school.getExamPlanPreview(scope);
    await ctx.rpc.school.generateExamPlan({ ...scope, configurationVersion: preview.configurationVersion });
    overview = await ctx.rpc.school.getExamOverview(scope);
  }
  // Working days are editable only while the exam is open (a replay may find it completed).
  if (overview.status !== 'completed') {
    await ctx.rpc.school.updateExamAssessmentSettings({ ...scope, totalWorkingDays: exam.totalWorkingDays });
  }
  if (!(await ctx.rpc.school.getExamTimetable(scope))) {
    const classes = await ctx.rpc.school.listClasses({ schoolId: ctx.schoolId, sessionId });
    const planned = ctx.plan.classes
      .map((demoClass) => ({ demoClass, classId: classes.find((item) => item.slug === demoClass.seed.slug)?.id }))
      .filter((item): item is { demoClass: DemoClass; classId: string } => item.classId !== undefined);
    const slots = demoSeed.session.exams.find((item) => item.slug === exam.slug)!.slots;
    await ctx.rpc.school.saveExamTimetable({
      ...scope,
      config: {
        columns: planned.map(({ classId }) => classId),
        rows: Array.from({ length: slots }, (_, index) => ({
          id: `${exam.slug}-slot-${index + 1}`,
          date: exam.days[Math.floor(index / 2)]!,
          startTime: index % 2 === 0 ? '09:00' : '11:30',
          endTime: index % 2 === 0 ? '11:00' : '13:30',
          cells: Object.fromEntries(
            planned.map(({ demoClass, classId }) => {
              const subjectSlug = Object.keys(demoClass.config.subjects)[index];
              return [classId, subjectSlug ? primaryMode(demoClass, subjectSlug).map((modeSlug) => ({ subjectSlug, modeSlug })) : null];
            }),
          ),
        })),
      },
    });
  }
  // Upcoming exams keep their timetable as a draft so the demo shows both
  // states; the others are published once, while the exam is still open
  // (completion freezes publication, and a replay never publishes again).
  const timetable = await ctx.rpc.school.getExamTimetable(scope);
  if (timetable && exam.state !== 'ready' && overview.status !== 'completed' && timetable.publicationCount === 0) {
    await ctx.rpc.school.publishExamTimetable(scope);
  }
  if (exam.state !== 'ready' && overview.status === 'ready') {
    await ctx.rpc.school.transitionExam({ ...scope, status: 'active' });
    overview = await ctx.rpc.school.getExamOverview(scope);
  }
  return { status: overview.status ?? 'ready' };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Enters approved marks, attendance and co-scholastic grades for one class:
 * everyone for a completed exam, the planned share for an active one. Marks
 * follow each student's ability plus noise so report cards look coherent.
 */
export async function seedExamClassResults(
  ctx: SeedContext,
  input: { sessionId: string; exam: DemoExam; demoClass: DemoClass },
): Promise<{ saved: number }> {
  const { exam, demoClass } = input;
  if (exam.state === 'ready') return { saved: 0 };
  const scope = { schoolId: ctx.schoolId, sessionId: input.sessionId, examSlug: exam.slug };
  // A replay may find the exam already completed and leavers unregistered;
  // results are entered only for an open exam and registered students.
  if ((await ctx.rpc.school.getExamOverview(scope)).status !== 'active') return { saved: 0 };
  const enrolments = (await enrolmentsFor(ctx, input.sessionId, demoClass.students)).filter((item) => item.registered);
  const selected = exam.state === 'completed'
    ? enrolments
    : enrolments.filter(({ student }) => createRandom(ctx.seed, 'entered', exam.slug, student.admissionNo).next() < exam.enteredShare);
  const grades = demoSeed.session.coScholasticGrades;
  let saved = 0;
  for (const { student, studentId, classId } of selected) {
    const workspace = await ctx.rpc.school.getStudentExam({ ...scope, classId, studentId });
    if (workspace.assessment?.approved && workspace.subjects.every(({ result }) => result?.approved)) continue;
    const random = createRandom(ctx.seed, 'marks', exam.slug, student.admissionNo);
    const workingDays = workspace.totalWorkingDays ?? exam.totalWorkingDays;
    const absent = Math.round(workingDays * clamp((1 - student.ability) * 0.18 + random.next() * 0.05, 0, 0.4));
    await ctx.rpc.school.saveStudentExam({
      ...scope,
      classId,
      studentId,
      approved: true,
      daysAttended: workingDays - absent,
      coScholastics: Object.fromEntries(
        Object.keys(demoSeed.session.coScholasticAreas).map((area) => [
          area,
          grades[clamp(Math.round((1 - student.ability) * (grades.length - 1) + (random.next() - 0.5) * 1.5), 0, grades.length - 1)]!,
        ]),
      ),
      subjects: workspace.subjects.map(({ plan }) => ({
        examPlanId: plan.id,
        marks: Object.fromEntries(
          Object.entries(plan.modeConfig).map(([slug, mode]) => [
            slug,
            Math.round(mode.maxMarks * clamp(student.ability + (random.next() - 0.5) * 0.25, 0.2, 1)),
          ]),
        ),
      })),
    });
    saved += 1;
  }
  return { saved };
}

/** Completes an exam whose window has passed, once every result is approved. */
export async function seedExamCompletion(ctx: SeedContext, sessionId: string, exam: DemoExam): Promise<{ status: string }> {
  const scope = { schoolId: ctx.schoolId, sessionId, examSlug: exam.slug };
  const overview = await ctx.rpc.school.getExamOverview(scope);
  if (exam.state === 'completed' && overview.status === 'active') {
    await ctx.rpc.school.transitionExam({ ...scope, status: 'completed' });
    return { status: 'completed' };
  }
  return { status: overview.status ?? 'ready' };
}

/** The remark band follows the same ability that drives the student's marks. */
function remarkText(ctx: SeedContext, exam: DemoExam, student: DemoStudent) {
  const remarks = demoSeed.session.remarks;
  const band = student.ability >= 0.8 ? remarks.high : student.ability >= 0.6 ? remarks.mid : remarks.low;
  const template = createRandom(ctx.seed, 'remark', exam.slug, student.admissionNo).pick(band);
  return template.replaceAll('{firstName}', student.name.split(' ')[0]!);
}

/**
 * Writes a teacher remark for every registered student of one class in a
 * completed exam. It runs before the exam is released (released remarks are
 * frozen) and skips a remark that already has the planned text, so a replay
 * changes nothing; a replay after the release finds the exam released and
 * stops.
 */
export async function seedExamRemarks(
  ctx: SeedContext,
  input: { sessionId: string; exam: DemoExam; demoClass: DemoClass },
): Promise<{ saved: number }> {
  const { exam, demoClass } = input;
  if (exam.state !== 'completed') return { saved: 0 };
  const scope = { schoolId: ctx.schoolId, sessionId: input.sessionId, examSlug: exam.slug };
  const overview = await ctx.rpc.school.getExamOverview(scope);
  if (overview.status !== 'completed' || overview.cadetReleasedAt) return { saved: 0 };
  const enrolments = (await enrolmentsFor(ctx, input.sessionId, demoClass.students)).filter((item) => item.registered);
  let saved = 0;
  for (const { student, studentId, classId } of enrolments) {
    const text = remarkText(ctx, exam, student);
    const existing = await ctx.rpc.school.getStudentExamRemark({ ...scope, classId, studentId });
    if (existing?.text === text) continue;
    await ctx.rpc.school.saveStudentExamRemark({ ...scope, classId, studentId, text });
    saved += 1;
  }
  return { saved };
}

/**
 * Releases a completed exam to the Cadet Portal when the plan says so.
 * Returns what actually happened: `released` (this run released it),
 * `already-released` (a replay found it released) or `skipped` (not planned,
 * or the exam is not completed). The release goes through the real,
 * permission-checked `releaseExamToCadet` (which stamps the current time),
 * then {@link backdateDemoExamRelease} moves the time to the plan's
 * `cadetReleasedAt`, derived from `asOf` like every other demo date. A replay
 * re-applies the back-dating, so a crash between the two calls heals.
 */
export async function seedExamRelease(
  ctx: SeedContext,
  sessionId: string,
  exam: DemoExam,
): Promise<{ outcome: 'released' | 'already-released' | 'skipped' }> {
  if (!exam.cadetReleasedAt) return { outcome: 'skipped' };
  const scope = { schoolId: ctx.schoolId, sessionId, examSlug: exam.slug };
  const overview = await ctx.rpc.school.getExamOverview(scope);
  if (overview.status !== 'completed' && !overview.cadetReleasedAt) return { outcome: 'skipped' };
  const outcome = overview.cadetReleasedAt ? 'already-released' : 'released';
  if (outcome === 'released') await ctx.rpc.school.releaseExamToCadet(scope);
  await backdateDemoExamRelease(scope, new Date(exam.cadetReleasedAt));
  return { outcome };
}

/**
 * Demo-only: sets a released exam's Cadet release time. Staff, the API and
 * MCP cannot back-date a release (the procedure always records "now"); only
 * this seed step can, and only for a demo school (`school.is_demo`), so it can
 * never rewrite a real school's history.
 */
async function backdateDemoExamRelease(scope: { schoolId: string; sessionId: string; examSlug: string }, releasedAt: Date) {
  const [school] = await db.select({ isDemo: schoolTable.isDemo }).from(schoolTable).where(eq(schoolTable.id, scope.schoolId)).limit(1);
  if (!school?.isDemo) throw new DemoSeedError('Only a demo school’s release times can be back-dated.');
  await db
    .update(examLifecycleTable)
    .set({ cadetReleasedAt: releasedAt })
    .where(
      and(
        eq(examLifecycleTable.schoolId, scope.schoolId),
        eq(examLifecycleTable.sessionId, scope.sessionId),
        eq(examLifecycleTable.examSlug, scope.examSlug),
        isNotNull(examLifecycleTable.cadetReleasedAt),
      ),
    );
}

// ---------------------------------------------------------------------------
// §6.7 Finance

function financeConfig(ctx: SeedContext): FinanceSchemaConfig {
  const finance = demoSeed.finance;
  return {
    currency: finance.currency,
    timeZone: finance.timeZone,
    recurring: finance.recurring,
    cycleStartMonth: ctx.plan.cycleStartMonth,
    elements: finance.elements,
  };
}

/** Session finance configuration, class overrides and student transport values. */
export async function seedFinanceConfiguration(ctx: SeedContext, sessionId: string): Promise<{ transport: number }> {
  const scope = { schoolId: ctx.schoolId, sessionId };
  const current = await ctx.rpc.school.getSessionFinance(scope);
  if (!current.financeConfig) {
    await ctx.rpc.school.updateSessionFinance({
      ...scope,
      financeConfig: financeConfig(ctx),
      classOverrides: Object.fromEntries(
        ctx.plan.classes.map(({ seed }) => [seed.slug, { tuition_fee: seed.tuitionMinor, smart_class_fee: seed.smartClassMinor }]),
      ),
    });
  }
  const students = ctx.plan.classes.flatMap((item) => item.students).filter((student) => student.transportMinor !== null);
  const ids = await admissionIdsByNumber(ctx.schoolId, students.map((student) => student.admissionNo));
  for (const student of students) {
    const admissionId = ids.get(student.admissionNo)!;
    const values = await ctx.rpc.school.getAdmissionFinanceValues({ ...scope, admissionId });
    if (Object.keys(values.values).length === 0) {
      await ctx.rpc.school.updateAdmissionFinanceValues({
        ...scope,
        admissionId,
        values: { [demoSeed.finance.transport.element]: student.transportMinor! },
      });
    }
  }
  return { transport: students.length };
}

function allStudents(plan: DemoPlan) {
  return plan.classes.flatMap((item) => item.students);
}

const REFERENCE_PREFIX = { cheque: 'CHQ-', bank_transfer: 'UTR', card: 'CARD-' } as const;

/**
 * Posts one month's regular billing run, then that month's payments (and, in
 * the first month, the seeded discounts). Students who left before this month
 * are excluded from the run, so leavers carry bills only up to leaving.
 */
export async function seedBillingMonth(ctx: SeedContext, sessionId: string, monthIndex: number): Promise<{ bills: number; payments: number; adjustments: number }> {
  const { plan, schoolId } = ctx;
  const month = plan.billingMonths[monthIndex]!;
  const scope = { schoolId, sessionId };
  const students = allStudents(plan);
  const ids = await admissionIdsByNumber(schoolId, students.map((student) => student.admissionNo));
  const billed = students.filter((student) => billedMonthIndexes(plan, student).includes(monthIndex));

  const runs = await ctx.rpc.school.listBillingRuns({ ...scope });
  let run = runs.items.find((item) => item.periodKey === month.periodKey && item.kind === 'regular');
  if (!run && billed.length > 0) {
    const draft = {
      ...scope,
      billingDate: month.billingDate,
      ...(billed.length === students.length ? {} : { admissionIds: billed.map((student) => ids.get(student.admissionNo)!) }),
      runValues: {
        session: plan.exams.some((exam) => exam.chargesFee && exam.feeMonthIndex === monthIndex)
          ? { [demoSeed.finance.examinationFeeElement]: String(demoSeed.finance.examinationFeeMinor) }
          : {},
        classes: {},
      },
    };
    const preview = await ctx.rpc.school.previewBillingRun(draft);
    if (!preview.readyToPost) {
      throw new DemoSeedError(`Billing for ${month.billingDate} is not ready: ${JSON.stringify(preview.issues).slice(0, 300)}`);
    }
    run = await ctx.rpc.school.postBillingRun({
      ...draft,
      kind: 'regular',
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: demoKey(ctx, 'bill', month.periodKey),
    });
  }

  let payments = 0;
  for (const student of students) {
    const admissionId = ids.get(student.admissionNo)!;
    for (const event of paymentEvents(plan, ctx.seed, student).filter((item) => item.monthIndex === monthIndex)) {
      const random = createRandom(ctx.seed, 'payment-time', student.admissionNo, event.sequence);
      const at = localTimeInstant(event.date, random.int(9, 15), random.int(0, 59), plan.timeZone);
      const prefix = event.method === 'cash' ? null : REFERENCE_PREFIX[event.method];
      const command = {
        ...scope,
        admissionId,
        currency: demoSeed.finance.currency,
        amountMinor: String(event.amountMinor),
        method: event.method,
        externalReference: prefix ? `${prefix}${String(random.int(100_000, 999_999))}${event.method === 'bank_transfer' ? String(random.int(100_000, 999_999)) : ''}` : null,
        payerName: student.fatherName,
        receivedAt: at,
        effectiveAt: at,
        note: 'Sample demo payment; no real money moved.',
        idempotencyKey: demoKey(ctx, 'pay', student.admissionNo, event.sequence),
      };
      if (event.withDiscount) {
        const discount = demoSeed.finance.discounts.paymentDiscount;
        await ctx.rpc.school.recordPaymentWithDiscount({
          ...command,
          discount: { amountMinor: String(discount.amountMinor), reasonCode: discount.code, reasonNote: discount.note },
        });
      } else {
        await ctx.rpc.school.recordPayment(command);
      }
      payments += 1;
    }
  }

  let adjustments = 0;
  if (monthIndex === 0) {
    for (const student of students.filter((item) => item.discount)) {
      const admissionId = ids.get(student.admissionNo)!;
      const reason = student.discount!;
      const effectiveAt = localTimeInstant(month.billingDate, 12, 0, plan.timeZone);
      if (reason.calculation.kind === 'fixed') {
        await ctx.rpc.school.recordAdjustment({
          ...scope,
          admissionId,
          currency: demoSeed.finance.currency,
          kind: 'discount',
          calculation: { kind: 'fixed', amountMinor: String(reason.calculation.amountMinor) },
          reasonCode: reason.code,
          reasonNote: reason.note,
          effectiveAt,
          idempotencyKey: demoKey(ctx, 'adjustment', student.admissionNo),
        });
      } else {
        // Percentages require a bill target: the student's first bill.
        const bills = await ctx.rpc.school.listAdmissionBills({ schoolId, filters: { admissionId, sessionId } });
        const first = bills.items.at(-1) ?? bills.items[0];
        if (!first) continue;
        await ctx.rpc.school.recordAdjustment({
          ...scope,
          admissionId,
          currency: demoSeed.finance.currency,
          kind: 'discount',
          billId: first.id,
          calculation: { kind: 'percentage', percentage: reason.calculation.percentage },
          reasonCode: reason.code,
          reasonNote: reason.note,
          effectiveAt,
          idempotencyKey: demoKey(ctx, 'adjustment', student.admissionNo),
        });
      }
      adjustments += 1;
    }
  }
  return { bills: run?.billCount ?? 0, payments, adjustments };
}

/** Verifies every admission's projection against its ledger; any mismatch fails the job. */
export async function verifyFinanceProjections(ctx: SeedContext): Promise<{ reconciled: number }> {
  const ids = await admissionIdsByNumber(ctx.schoolId, allStudents(ctx.plan).map((student) => student.admissionNo));
  for (const [admissionNo, admissionId] of ids) {
    const result = await ctx.rpc.school.reconcileAdmissionProjection({ schoolId: ctx.schoolId, admissionId, currency: demoSeed.finance.currency });
    if (!result.matches) throw new DemoSeedError(`The finance projection of admission ${admissionNo} does not reconcile.`);
  }
  return { reconciled: ids.size };
}

/** Unregisters the planned leavers after their bills and payments exist. */
export async function seedUnregistrations(ctx: SeedContext): Promise<{ unregistered: number }> {
  const leavers = allStudents(ctx.plan).filter((student) => student.lastBilledMonthIndex !== null);
  const ids = await admissionIdsByNumber(ctx.schoolId, leavers.map((student) => student.admissionNo));
  for (const student of leavers) {
    const admissionId = ids.get(student.admissionNo)!;
    const [row] = await db.select({ registered: admissionTable.registered }).from(admissionTable).where(eq(admissionTable.id, admissionId)).limit(1);
    if (row?.registered) {
      await ctx.rpc.school.unregisterAdmission({ schoolId: ctx.schoolId, admissionId, confirmationName: student.name });
    }
  }
  return { unregistered: leavers.length };
}

// ---------------------------------------------------------------------------
// §6.8 Templates

const DOCUMENT_TYPES: DocumentType[] = ['report_card', 'id_card', 'admit_card', 'timetable', 'bill', 'receipt', 'statement', 'notice'];

/** Selects each type's `<type>-default` marketplace design unless one is active. */
export async function seedTemplates(ctx: SeedContext): Promise<{ templates: number }> {
  for (const documentType of DOCUMENT_TYPES) {
    const active = await ctx.rpc.school.getActiveDocumentTemplate({ schoolId: ctx.schoolId, documentType });
    if (!active) {
      const selected = await ctx.rpc.school.selectMarketplaceTemplate({
        schoolId: ctx.schoolId,
        documentType,
        slug: `${documentType}-default`,
        expectedRevisionId: null,
      });
      const [artifact] = await db.select({ s3Key: artifactTable.s3Key }).from(artifactTable).where(eq(artifactTable.id, selected.artifact.id)).limit(1);
      await assertUploadsKept(ctx.jobId, ctx.schoolId, [artifact?.s3Key ?? '']);
    }
  }
  return { templates: DOCUMENT_TYPES.length };
}

// ---------------------------------------------------------------------------
// Notices

/** The demo's notice with this title in the session, if an earlier run wrote it. */
async function findDemoNotice(ctx: SeedContext, sessionId: string, title: string) {
  const scope = { schoolId: ctx.schoolId, sessionId };
  for (let page = 1; ; page += 1) {
    const listed = await ctx.rpc.school.listNotices({ ...scope, searchQuery: title.slice(0, 100), page });
    const match = listed.items.find((item) => item.title === title);
    if (match || page >= listed.pagination.totalPages) return match ?? null;
  }
}

/**
 * Writes one planned notice through the real, permission-checked notice
 * procedures as the demo's principal: `createNotice`, then `publishNotice`
 * when the plan publishes it (which renders it, pins the school's Notice
 * template revision and notifies the audience exactly like a staff
 * publication). Idempotent on the notice's title within the session: a
 * replay finds the notice and only finishes what is missing, so it never
 * writes a second copy or notifies twice (publishing an already published
 * notice is refused, and its event keys deduplicate besides).
 *
 * The procedures stamp the current time; {@link backdateDemoNotice} then
 * moves the notice to the plan's times, derived from `asOf` like every
 * other demo date, and is re-applied on a replay so a crash between the
 * calls heals. Returns what this run did.
 */
export async function seedNotice(
  ctx: SeedContext,
  input: { sessionId: string; classIdsBySlug: Record<string, string>; notice: DemoNotice },
): Promise<{ noticeId: string; outcome: 'created' | 'published' | 'unchanged' }> {
  const { sessionId, notice } = input;
  const classIds = notice.classSlugs.map((slug) => {
    const classId = input.classIdsBySlug[slug];
    if (!classId) throw new DemoSeedError(`The demo class ${slug} of the notice "${notice.title}" does not exist.`);
    return classId;
  });
  const existing = await findDemoNotice(ctx, sessionId, notice.title);
  const saved =
    existing ??
    (await ctx.rpc.school.createNotice({
      schoolId: ctx.schoolId,
      sessionId,
      title: notice.title,
      bodyMode: notice.bodyMode,
      body: notice.body,
      pageSize: notice.pageSize,
      toStaff: notice.toStaff,
      cadetScope: notice.cadetScope,
      classIds,
    }));
  const publish = notice.status === 'published' && saved.status === 'draft';
  if (publish) {
    // Publishing names the template revision that was reviewed; the demo's
    // principal "reviews" through the publish forecast, like the dialog.
    const forecast = await ctx.rpc.school.previewNoticePublish({ schoolId: ctx.schoolId, noticeId: saved.id });
    if (forecast.kind === 'ready') {
      await ctx.rpc.school.publishNotice({ schoolId: ctx.schoolId, noticeId: saved.id, expectedVersion: saved.version, expectedTemplateRevisionId: forecast.templateRevisionId });
    }
  }
  await backdateDemoNotice({ schoolId: ctx.schoolId, noticeId: saved.id }, notice);
  return { noticeId: saved.id, outcome: publish ? 'published' : existing ? 'unchanged' : 'created' };
}

/**
 * Demo-only: sets when a seeded notice was written and published. Staff,
 * the API and MCP cannot back-date a notice (the procedures always record
 * "now"); only this seed step can, and only for a demo school
 * (`school.is_demo`), so it can never rewrite a real school's history. The
 * publication time and the printed "issued on" date are changed together,
 * and only on a notice that is published: the date is a stored fact of the
 * publication (`notice.issued_on`), so the plan supplies both. Nothing has
 * read the notice's PDF yet (it is rendered on first download), so no cached
 * file can disagree with the new date.
 */
async function backdateDemoNotice(scope: { schoolId: string; noticeId: string }, notice: Pick<DemoNotice, 'createdAt' | 'publishedAt' | 'issuedOn'>) {
  const [school] = await db.select({ isDemo: schoolTable.isDemo }).from(schoolTable).where(eq(schoolTable.id, scope.schoolId)).limit(1);
  if (!school?.isDemo) throw new DemoSeedError('Only a demo school’s notices can be back-dated.');
  const mine = and(eq(noticeTable.id, scope.noticeId), eq(noticeTable.schoolId, scope.schoolId));
  const createdAt = new Date(notice.createdAt);
  await db.update(noticeTable).set({ createdAt, updatedAt: createdAt }).where(and(mine, eq(noticeTable.status, 'draft')));
  if (notice.publishedAt && notice.issuedOn) {
    const publishedAt = new Date(notice.publishedAt);
    await db
      .update(noticeTable)
      .set({ createdAt, publishedAt, issuedOn: notice.issuedOn, updatedAt: publishedAt })
      .where(and(mine, eq(noticeTable.status, 'published')));
  }
}

// ---------------------------------------------------------------------------
// §6.9 Credentials and finish

function csvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Generates a fresh password for every demo staff account, stores only its
 * hash through Better Auth's server-side adapter, and writes the credentials
 * CSV to private S3. Returns only the S3 key: passwords never reach the
 * Restate journal, the job row or logs. Re-running regenerates every password
 * and rewrites the CSV, so the file always matches the stored hashes.
 */
export async function seedCredentials(ctx: SeedContext): Promise<{ credentialsS3Key: string }> {
  const authContext = await auth.$context;
  const loginUrl = new URL('/auth/login', env.PUBLIC_APP_URL).toString();
  const classLabel = (slug: string | null) => ctx.plan.classes.find((item) => item.seed.slug === slug)?.seed.label ?? '';
  const admin = await db.query.user.findFirst({ columns: { name: true, email: true }, where: eq(user.id, ctx.context.session!.user.id) });
  const rows: string[][] = [
    ['school', 'role', 'class', 'name', 'email', 'password', 'login_url'],
    [ctx.plan.schoolName, 'Principal', '', admin?.name ?? '', admin?.email ?? '', '(your own login)', loginUrl],
  ];
  for (const member of ctx.plan.staff) {
    const userId = await findStaffUserId(ctx, member.key);
    const password = generateDemoPassword();
    const hash = await authContext.password.hash(password);
    const credential = await authContext.internalAdapter.findCredentialAccount(userId);
    if (credential) await authContext.internalAdapter.updatePassword(userId, hash);
    else await authContext.internalAdapter.linkAccount({ userId, providerId: 'credential', accountId: userId, password: hash });
    rows.push([ctx.plan.schoolName, member.roleLabel.split(',')[0]!, classLabel(member.classSlug), member.name, member.email, password, loginUrl]);
  }
  const body = `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
  const key = demoCredentialsS3Key(ctx.schoolId);
  await getS3Client().send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: 'text/csv; charset=utf-8', CacheControl: 'private, no-store' }),
  );
  await assertUploadsKept(ctx.jobId, ctx.schoolId, [key]);
  return { credentialsS3Key: key };
}

/** Marks onboarding complete and computes the job summary from the database. */
export async function finishDemoSchool(ctx: SeedContext, credentialsS3Key: string): Promise<DemoSchoolJobResult> {
  const { schoolId } = ctx;
  await ctx.rpc.systemAdmin.updateSchool({ id: schoolId, hasCompletedOnboarding: true });
  const [[staff], [admissions], [unregistered], [bills], [payments], [adjustments], [classes]] = await Promise.all([
    db.select({ value: count() }).from(user).where(eq(user.demoSchoolId, schoolId)),
    db.select({ value: count() }).from(admissionTable).where(eq(admissionTable.schoolId, schoolId)),
    db.select({ value: count() }).from(admissionTable).where(and(eq(admissionTable.schoolId, schoolId), eq(admissionTable.registered, false))),
    db.select({ value: count(), total: sum(financeBillTable.totalAmountMinor) }).from(financeBillTable).where(eq(financeBillTable.schoolId, schoolId)),
    db.select({ value: count(), total: sum(financePaymentTable.amountMinor) }).from(financePaymentTable).where(eq(financePaymentTable.schoolId, schoolId)),
    db.select({ value: count(), total: sum(financeAdjustmentTable.amountMinor) }).from(financeAdjustmentTable).where(eq(financeAdjustmentTable.schoolId, schoolId)),
    db.select({ value: sql<number>`count(distinct ${studentTable.classId})::int` }).from(studentTable).where(eq(studentTable.schoolId, schoolId)),
  ]);
  const billed = BigInt(bills?.total ?? '0');
  const collected = BigInt(payments?.total ?? '0');
  const credited = BigInt(adjustments?.total ?? '0');
  const outstanding = billed - collected - credited;
  return {
    credentialsS3Key,
    counts: {
      staff: staff?.value ?? 0,
      classes: classes?.value ?? 0,
      students: admissions?.value ?? 0,
      unregistered: unregistered?.value ?? 0,
      bills: bills?.value ?? 0,
      payments: payments?.value ?? 0,
      adjustments: adjustments?.value ?? 0,
      templates: DOCUMENT_TYPES.length,
    },
    amounts: {
      currency: demoSeed.finance.currency,
      billedMinor: billed.toString(),
      collectedMinor: collected.toString(),
      outstandingMinor: (outstanding > BigInt(0) ? outstanding : BigInt(0)).toString(),
    },
  };
}

/** Schools whose membership a demo admin holds, used by tests to check isolation. */
export async function principalSchoolIds(userId: string) {
  const rows = await db.select({ schoolId: schoolMemberTable.schoolId }).from(schoolMemberTable).where(eq(schoolMemberTable.userId, userId));
  return rows.map((row) => row.schoolId);
}
