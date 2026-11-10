import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { user } from '@campuspilot/db/schema/auth';
import { demoSchoolJobTable } from '@campuspilot/db/schema/demo-school-job';
import { examLifecycleTable, examStudentRemarkTable } from '@campuspilot/db/schema/exam';
import { examResultPublicationTable } from '@campuspilot/db/schema/exam-result-publication';
import { financeBillRunTable, financeBillTable, financePaymentTable } from '@campuspilot/db/schema/finance';
import { noticeTable } from '@campuspilot/db/schema/notice';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { studentTable } from '@campuspilot/db/schema/student';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, asc, count, eq, isNotNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { retryFinanceConflict } from '../../../test/finance/assertions';
import { dispatchNow, drainSchool } from '../../../test/notifications';
import type { NotificationChannelAdapter } from '../../notifications/channels';
import { createAdminSession, createTestClient, createTestUser, type UserSession } from '../../../test/fixtures';
import { getCadetNotice, getCadetNoticeDocument, listCadetNotices } from '../../routers/cadet/cadet-notices.service';
import { noticePdfKey } from '../../routers/school/notice/notice.render';
import { loadDemoJob, startDemoJob, type DemoJobSnapshot } from './job-store';
import { buildDemoPlan } from './plan';
import { DemoSeedError, createSeedContext, seedStaffMember } from './steps';
import { runDemoSeedSteps } from './workflow';

/** Mid-December: the first term is completed, the second active, the annual ready. */
const AS_OF = '2026-12-20T06:30:00.000Z';
const SEED = 'integration-seed';

async function snapshotCounts(schoolId: string) {
  const [[admissions], [students], [bills], [payments], [demoUsers], [events], [remarks], [notices]] = await Promise.all([
    db.select({ value: count() }).from(admissionTable).where(eq(admissionTable.schoolId, schoolId)),
    db.select({ value: count() }).from(studentTable).where(eq(studentTable.schoolId, schoolId)),
    db.select({ value: count() }).from(financeBillTable).where(eq(financeBillTable.schoolId, schoolId)),
    db.select({ value: count() }).from(financePaymentTable).where(eq(financePaymentTable.schoolId, schoolId)),
    db.select({ value: count() }).from(user).where(eq(user.demoSchoolId, schoolId)),
    db.select({ value: count() }).from(notificationEventTable).where(eq(notificationEventTable.schoolId, schoolId)),
    db.select({ value: count() }).from(examStudentRemarkTable).where(eq(examStudentRemarkTable.schoolId, schoolId)),
    db.select({ value: count() }).from(noticeTable).where(eq(noticeTable.schoolId, schoolId)),
  ]);
  return { admissions: admissions!.value, students: students!.value, bills: bills!.value, payments: payments!.value, demoUsers: demoUsers!.value, notificationEvents: events!.value, remarks: remarks!.value, notices: notices!.value };
}

/** The seeded notices exactly as stored, oldest first, for comparing before and after a replay. */
function noticeRows(schoolId: string) {
  return db.select().from(noticeTable).where(eq(noticeTable.schoolId, schoolId)).orderBy(asc(noticeTable.createdAt), asc(noticeTable.id));
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
    expect(result.counts).toMatchObject({ staff: 5, classes: 2, students: plannedStudents, templates: 8 });
    expect(result.counts.bills).toBeGreaterThan(plannedStudents * 8);
    expect(BigInt(result.amounts.collectedMinor)).toBeGreaterThan(0n);

    const client = createTestClient(admin);
    const session = (await client.school.listSessions({ schoolId: job.schoolId })).items[0]!;
    const exams = await client.school.listExams({ schoolId: job.schoolId, sessionId: session.id });
    expect(exams.items.map((exam) => [exam.slug, exam.status, exam.cadetReleasedAt !== null])).toEqual([
      ['periodic-test-1', 'completed', true],
      ['first-term-examination', 'completed', false],
      ['second-term-examination', 'active', false],
      ['annual-examination', 'ready', false],
    ]);
    // The release is stamped with asOf (the demo's creation), not the worker's clock.
    const periodic = plan.exams.find((exam) => exam.slug === 'periodic-test-1')!;
    expect(new Date(exams.items[0]!.cadetReleasedAt!).toISOString()).toBe(periodic.cadetReleasedAt);
    expect(await client.school.getCadetPortalSettings({ schoolId: job.schoolId })).toMatchObject({ showClassAverages: true });

    // Every registered student of a completed exam has a teacher remark, released or not.
    const enrolled = await db.select({ id: studentTable.id }).from(studentTable).where(eq(studentTable.schoolId, job.schoolId));
    const remarks = await db.select().from(examStudentRemarkTable).where(eq(examStudentRemarkTable.schoolId, job.schoolId));
    for (const slug of ['periodic-test-1', 'first-term-examination']) {
      expect(remarks.filter((row) => row.examSlug === slug)).toHaveLength(enrolled.length);
    }
    expect(remarks.every((row) => !row.text.includes('{firstName}'))).toBe(true);

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

    // Seed steps call the real posting and release procedures, so every bill,
    // payment and billing run emitted its notification event, and every
    // released exam one per registered student (inbox items once fanned out).
    const counts = await snapshotCounts(job.schoolId);
    const [runs] = await db.select({ value: count() }).from(financeBillRunTable).where(eq(financeBillRunTable.schoolId, job.schoolId));
    const releases = await db.select().from(examResultPublicationTable).where(eq(examResultPublicationTable.schoolId, job.schoolId));
    const [released] = await db.select({ value: count() }).from(examLifecycleTable).where(and(eq(examLifecycleTable.schoolId, job.schoolId), isNotNull(examLifecycleTable.cadetReleasedAt)));
    expect(releases.length).toBe(released!.value);
    expect(releases.length).toBeGreaterThan(0);
    const releaseRecipients = releases.reduce((total, release) => total + release.admissionIds.length, 0);
    // Notices: the planned handful, written and published through the real
    // procedures and then back-dated from asOf like every other demo date.
    const listedNotices = await client.school.listNotices({ schoolId: job.schoolId, sessionId: session.id });
    const classes = await client.school.listClasses({ schoolId: job.schoolId, sessionId: session.id });
    const classIdOf = (slug: string) => classes.find((item) => item.slug === slug)!.id;
    expect(listedNotices.items).toHaveLength(plan.notices.length);
    for (const planned of plan.notices) {
      const stored = listedNotices.items.find((item) => item.title === planned.title);
      expect(stored, planned.key).toMatchObject({
        status: planned.status,
        bodyMode: planned.bodyMode,
        toStaff: planned.toStaff,
        cadetScope: planned.cadetScope,
        createdBy: admin.user.id,
        publishedBy: planned.status === 'published' ? admin.user.id : null,
      });
      expect([...stored!.classIds].sort(), planned.key).toEqual(planned.classSlugs.map(classIdOf).sort());
      expect(new Date(stored!.createdAt).toISOString(), planned.key).toBe(planned.createdAt);
      expect(stored!.publishedAt ? new Date(stored!.publishedAt).toISOString() : null, planned.key).toBe(planned.publishedAt);
      expect(new Date(stored!.createdAt).getTime(), planned.key).toBeLessThan(new Date(AS_OF).getTime());
    }
    const registered = await db.select({ id: admissionTable.id }).from(admissionTable).where(and(eq(admissionTable.schoolId, job.schoolId), eq(admissionTable.registered, true)));
    const noticeByKey = async (key: string) => {
      const planned = plan.notices.find((item) => item.key === key)!;
      return client.school.getNotice({ schoolId: job.schoolId, noticeId: listedNotices.items.find((item) => item.title === planned.title)!.id });
    };
    const [staffMeeting, timings, sportsDay, homework] = await Promise.all([noticeByKey('staff-meeting'), noticeByKey('school-timings'), noticeByKey('sports-day'), noticeByKey('holiday-homework')]);
    // Notified audiences are the real ones at publication: every member, every registered student (leavers are already unregistered).
    expect(staffMeeting).toMatchObject({ publishedStaffCount: 6, publishedCadetCount: 0 });
    expect(timings).toMatchObject({ publishedStaffCount: 0, publishedCadetCount: registered.length });
    expect(sportsDay).toMatchObject({ publishedStaffCount: 6, publishedCadetCount: registered.length, templateRevisionId: null });
    expect(homework).toMatchObject({ status: 'draft', publishedStaffCount: null, publishedCadetCount: null, templateRevisionId: null });
    // Templates were seeded first, so a plain notice pinned the school's selected Notice design.
    const noticeTemplate = await client.school.getActiveDocumentTemplate({ schoolId: job.schoolId, documentType: 'notice' });
    expect(staffMeeting.templateRevisionId).toBe(noticeTemplate!.artifact.id);
    // The printed "issued on" date is the back-dated publication day (16 days before 20 December), not the day the seed ran.
    const printed = await client.school.previewNotice({ schoolId: job.schoolId, source: { kind: 'saved', noticeId: staffMeeting.id } });
    expect(printed.html).toContain('4 December 2026');
    expect(printed.html).toContain('on 6 December 2026 at 2:30 PM');
    // A student of the demo sees the notices addressed to students, newest first, and never the staff-only one or a draft.
    const cadet = { schoolId: job.schoolId, admissionId: registered[0]!.id };
    const visible = await listCadetNotices(db, cadet, { limit: 20 });
    expect(visible.items.map((item) => item.title)).toEqual(['Annual Sports Day invitation', 'Science exhibition: models and group lists', 'Revised school timings']);
    const designed = await getCadetNotice(db, cadet, sportsDay.id);
    expect(designed.bodyMode).toBe('template');
    expect(designed.text).toContain('18 December 2026');
    const designedPage = await getCadetNoticeDocument(db, cadet, sportsDay.id);
    expect(designedPage.html).toContain('Integration Valley School');
    expect(designedPage.html).toContain('18 December 2026');
    expect(designedPage.html).toContain('1 January 2027');
    expect(designedPage.html).not.toContain('{date:');
    // Downloading renders the PDF once and caches it under the school's own prefix.
    await client.school.getNoticeDownload({ schoolId: job.schoolId, noticeId: sportsDay.id });
    await expect(getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: noticePdfKey(job.schoolId, sportsDay.id) }))).resolves.toMatchObject({ ContentType: 'application/pdf' });

    // One event per student of each published notice, plus one staff event when it addresses staff.
    const noticeEvents = (await noticeRows(job.schoolId))
      .filter((row) => row.status === 'published')
      .reduce((total, row) => total + (row.publishedCadetCount ?? 0) + (row.toStaff ? 1 : 0), 0);
    expect(noticeEvents).toBe(registered.length * 3 + 3);
    expect(counts.notificationEvents).toBe(counts.bills + counts.payments + runs!.value + releaseRecipients + noticeEvents);
    // A demo never sends outside the inbox, even with both channels switched on.
    const send = vi.fn(async () => ({ kind: 'sent' as const, providerMessageId: 'never' }));
    const available = (channel: 'web_push' | 'whatsapp'): NotificationChannelAdapter => ({ channel, available: true, decide: () => [{ status: 'owed', destination: 'x' }], send });
    const [paymentEvent] = await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, job.schoolId), eq(notificationEventTable.type, 'payment.received'))).limit(1);
    const adapters = { web_push: available('web_push'), whatsapp: available('whatsapp') };
    await dispatchNow(paymentEvent!.id, adapters);
    await drainSchool(job.schoolId, { adapters });
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
    const noticesBefore = await noticeRows(job.schoolId);
    await runDemoSeedSteps({ job, attempt: 1, run, step });
    expect(await snapshotCounts(job.schoolId)).toEqual(before);
    // No second copy, no second publication (no new events above), same back-dated times.
    expect(await noticeRows(job.schoolId)).toEqual(noticesBefore);
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
