import { GetObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { user } from '@campuspilot/db/schema/auth';
import { demoSchoolJobTable } from '@campuspilot/db/schema/demo-school-job';
import { financeBillRunTable, financeBillTable, financePaymentTable } from '@campuspilot/db/schema/finance';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { studentTable } from '@campuspilot/db/schema/student';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, count, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { retryFinanceConflict } from '../../../test/finance/assertions';
import { runNotificationDispatch } from '../../notifications/dispatch';
import type { NotificationChannelAdapter } from '../../notifications/channels';
import { createAdminSession, createTestClient, createTestUser, type UserSession } from '../../../test/fixtures';
import { loadDemoJob, startDemoJob, type DemoJobSnapshot } from './job-store';
import { buildDemoPlan } from './plan';
import { DemoSeedError, createSeedContext, seedStaffMember } from './steps';
import { runDemoSeedSteps } from './workflow';

/** Mid-December: the first term is completed, the second active, the annual ready. */
const AS_OF = '2026-12-20T06:30:00.000Z';
const SEED = 'integration-seed';

async function snapshotCounts(schoolId: string) {
  const [[admissions], [students], [bills], [payments], [demoUsers], [events]] = await Promise.all([
    db.select({ value: count() }).from(admissionTable).where(eq(admissionTable.schoolId, schoolId)),
    db.select({ value: count() }).from(studentTable).where(eq(studentTable.schoolId, schoolId)),
    db.select({ value: count() }).from(financeBillTable).where(eq(financeBillTable.schoolId, schoolId)),
    db.select({ value: count() }).from(financePaymentTable).where(eq(financePaymentTable.schoolId, schoolId)),
    db.select({ value: count() }).from(user).where(eq(user.demoSchoolId, schoolId)),
    db.select({ value: count() }).from(notificationEventTable).where(eq(notificationEventTable.schoolId, schoolId)),
  ]);
  return { admissions: admissions!.value, students: students!.value, bills: bills!.value, payments: payments!.value, demoUsers: demoUsers!.value, notificationEvents: events!.value };
}

async function readCredentials(key: string) {
  const object = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  const text = await object.Body!.transformToString();
  const [header, ...rows] = text.trim().split('\r\n').map((line) => line.split(','));
  return rows.map((row) => Object.fromEntries(header!.map((column, index) => [column, row[index]!])));
}

describe('demo school seed steps (2 classes, without Restate)', () => {
  let admin: UserSession;
  let job: DemoJobSnapshot;
  const run = { seed: SEED, asOf: AS_OF };
  // Like the workflow's bounded step retries, re-run a step after a finance
  // serialization conflict; every step is idempotent.
  const step = <T,>(_name: string, action: () => Promise<T>) => retryFinanceConflict(action);

  beforeAll(async () => {
    admin = await createAdminSession();
    const created = await createTestClient(admin).systemAdmin.createDemoSchool({
      name: 'Integration Valley School',
      location: 'Sample City',
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      classSlugs: ['ukg', 'class-1'],
    });
    await startDemoJob(created.job.id, 1, run);
    job = (await loadDemoJob(created.job.id))!;
  }, 120_000);

  it('seeds a coherent school that reconciles and records the job result', async () => {
    const result = await runDemoSeedSteps({ job, attempt: 1, run, step });
    const plan = buildDemoPlan({ input: job.input, seed: SEED, asOf: new Date(AS_OF), school: job.school });
    const plannedStudents = plan.classes.reduce((sum, item) => sum + item.students.length, 0);

    expect(plan.billingMonths.map((month) => month.periodKey)).toEqual([
      'monthly:2026-04', 'monthly:2026-05', 'monthly:2026-06', 'monthly:2026-07', 'monthly:2026-08',
      'monthly:2026-09', 'monthly:2026-10', 'monthly:2026-11', 'monthly:2026-12',
    ]);
    expect(result.counts).toMatchObject({ staff: 5, classes: 2, students: plannedStudents, templates: 7 });
    expect(result.counts.bills).toBeGreaterThan(plannedStudents * 8);
    expect(BigInt(result.amounts.collectedMinor)).toBeGreaterThan(0n);

    const client = createTestClient(admin);
    const session = (await client.school.listSessions({ schoolId: job.schoolId })).items[0]!;
    const exams = await client.school.listExams({ schoolId: job.schoolId, sessionId: session.id });
    expect(exams.items.map((exam) => [exam.slug, exam.status])).toEqual([
      ['first-term-examination', 'completed'],
      ['second-term-examination', 'active'],
      ['annual-examination', 'ready'],
    ]);

    // Every admission reconciles (the seed also checks this) and nothing is dated after asOf.
    const admissions = await db.select({ id: admissionTable.id }).from(admissionTable).where(eq(admissionTable.schoolId, job.schoolId));
    for (const { id } of admissions) {
      const reconciliation = await client.school.reconcileAdmissionProjection({ schoolId: job.schoolId, admissionId: id, currency: 'INR' });
      expect(reconciliation.matches).toBe(true);
    }
    const payments = await db.select({ receivedAt: financePaymentTable.receivedAt }).from(financePaymentTable).where(eq(financePaymentTable.schoolId, job.schoolId));
    expect(payments.every(({ receivedAt }) => receivedAt.getTime() < new Date(AS_OF).getTime())).toBe(true);

    // The admin is principal of the demo only; demo staff are marked as demo users.
    const memberships = await db.select().from(schoolUserRoleTable).where(eq(schoolUserRoleTable.userId, admin.user.id));
    expect(memberships.filter((row) => row.schoolId === job.schoolId).map((row) => row.role)).toEqual(['principal']);
    const [adminRow] = await db.select({ demoSchoolId: user.demoSchoolId }).from(user).where(eq(user.id, admin.user.id));
    expect(adminRow!.demoSchoolId).toBeNull();
    const staff = await db.select({ email: user.email, image: user.profileImageS3Key }).from(user).where(eq(user.demoSchoolId, job.schoolId));
    expect(staff.map((row) => row.email).sort()).toEqual(
      [
        `accountant.${job.school.slug}@campuspilot.in`,
        `exam-coordinator.${job.school.slug}@campuspilot.in`,
        `manager.${job.school.slug}@campuspilot.in`,
        `teacher1.${job.school.slug}@campuspilot.in`,
        `teacher2.${job.school.slug}@campuspilot.in`,
      ].sort(),
    );
    expect(staff.every((row) => row.image)).toBe(true);

    // Leavers are unregistered after finance.
    const leavers = plan.classes.flatMap((item) => item.students).filter((student) => student.lastBilledMonthIndex !== null);
    const unregistered = await db.select({ value: count() }).from(admissionTable).where(and(eq(admissionTable.schoolId, job.schoolId), eq(admissionTable.registered, false)));
    expect(unregistered[0]!.value).toBe(leavers.length);

    // The CSV logins work, and the job row holds the key but no passwords.
    const [jobRow] = await db.select().from(demoSchoolJobTable).where(eq(demoSchoolJobTable.id, job.jobId));
    expect(jobRow!.status).toBe('succeeded');
    const credentials = await readCredentials(jobRow!.result!.credentialsS3Key!);
    expect(credentials[0]).toMatchObject({ role: 'Principal', email: admin.user.email, password: '(your own login)' });
    expect(credentials.slice(1).map((row) => row.email)).toEqual(plan.staff.map((member) => member.email));
    expect(JSON.stringify(jobRow)).not.toContain(credentials[1]!.password);
    for (const row of credentials.slice(1)) {
      const response = await auth.api.signInEmail({ body: { email: row.email!, password: row.password! }, asResponse: true });
      expect(response.ok, row.email).toBe(true);
    }

    const downloaded = await client.systemAdmin.getDemoCredentialsDownload({ schoolId: job.schoolId });
    expect(downloaded.fileName).toBe(`${job.school.slug}-credentials.csv`);

    // Seed steps call the real posting procedures, so every bill, payment and
    // billing run emitted its notification event (inbox items once fanned out).
    const counts = await snapshotCounts(job.schoolId);
    const [runs] = await db.select({ value: count() }).from(financeBillRunTable).where(eq(financeBillRunTable.schoolId, job.schoolId));
    expect(counts.notificationEvents).toBe(counts.bills + counts.payments + runs!.value);
    // A demo never sends outside the inbox, even with both channels switched on.
    const send = vi.fn(async () => ({ kind: 'sent' as const, providerMessageId: 'never' }));
    const available = (channel: 'web_push' | 'whatsapp'): NotificationChannelAdapter => ({ channel, available: true, decide: () => [{ status: 'owed', destination: 'x' }], send });
    const [paymentEvent] = await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, job.schoolId), eq(notificationEventTable.type, 'payment.received'))).limit(1);
    await runNotificationDispatch({ eventId: paymentEvent!.id, step: (_name, action) => action(), sleep: async () => undefined, adapters: { web_push: available('web_push'), whatsapp: available('whatsapp') } });
    const [inbox] = await db.select().from(notificationTable).where(eq(notificationTable.eventId, paymentEvent!.id));
    expect(inbox).toMatchObject({ recipientKind: 'admission' });
    const deliveries = await db.select().from(notificationDeliveryTable).where(eq(notificationDeliveryTable.notificationId, inbox!.id));
    expect(deliveries.map((delivery) => [delivery.channel, delivery.status, delivery.skipReason]).sort()).toEqual([
      ['web_push', 'skipped', 'demo_school'],
      ['whatsapp', 'skipped', 'demo_school'],
    ]);
    expect(send).not.toHaveBeenCalled();
  }, 600_000);

  it('changes nothing when every step runs again', async () => {
    const before = await snapshotCounts(job.schoolId);
    await runDemoSeedSteps({ job, attempt: 1, run, step });
    expect(await snapshotCounts(job.schoolId)).toEqual(before);
    const memberCount = await db.select({ value: count() }).from(schoolMemberTable).where(eq(schoolMemberTable.schoolId, job.schoolId));
    expect(memberCount[0]!.value).toBe(6);
  }, 600_000);

  it('fails clearly instead of reusing an existing account', async () => {
    const created = await createTestClient(admin).systemAdmin.createDemoSchool({
      name: 'Taken Address School',
      location: 'Sample City',
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      classSlugs: ['nursery'],
    });
    await startDemoJob(created.job.id, 1, run);
    const other = (await loadDemoJob(created.job.id))!;
    await createTestUser({ email: `manager.${other.school.slug}@campuspilot.in` });
    const context = await createSeedContext(other, run);
    const manager = context.plan.staff.find((member) => member.key === 'manager')!;
    await expect(seedStaffMember(context, manager)).rejects.toBeInstanceOf(DemoSeedError);
  });
});
