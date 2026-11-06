import { PutObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { demoSchoolJobTable } from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createTestClient,
  createTestSchool,
  createTestUser,
  type TestClient,
  type UserSession,
} from '../../../../test/fixtures';
import { expectRpcCode } from '../../../../test/finance/assertions';
import { demoSchoolPurgeTable } from '@campuspilot/db/schema/demo-school-job';
import { ORPCError } from '@orpc/server';
import { assertUploadsKept, createDemoSchoolJobContext } from '../../../workflows/demo-school/job-context';
import {
  collectDemoSchoolObjectKeys,
  deleteDemoSchoolObjectBatch,
  demoSchoolPurgeScope,
  loadDemoSchoolPurgeScope,
} from '../../../workflows/demo-school/purge-workflow';
import { resubmitPendingDemoPurges } from './demo-school.purge';
import {
  cancelRestateInvocationAndWait,
  getRestateInvocationStatus,
  submitDemoSchoolPurgeWorkflow,
  submitDemoSchoolWorkflow,
} from './demo-school.restate';

vi.mock('./demo-school.restate', () => ({
  submitDemoSchoolWorkflow: vi.fn(async (jobId: string, attempt: number) => ({ invocationId: `inv_${jobId}_${attempt}` })),
  submitDemoSchoolPurgeWorkflow: vi.fn(async () => ({ invocationId: 'inv_purge' })),
  cancelRestateInvocationAndWait: vi.fn(async () => true),
  getRestateInvocationStatus: vi.fn(async () => 'running'),
}));

const validInput = {
  name: 'Router Test School',
  location: 'Sample City',
  sessionStartYear: 2026,
  sessionEndYear: 2027,
  classSlugs: ['nursery', 'class-1'],
};

describe('systemAdmin demo school procedures', () => {
  let admin: UserSession;
  let adminClient: TestClient;
  let regularClient: TestClient;

  beforeAll(async () => {
    admin = await createAdminSession();
    adminClient = createTestClient(admin);
    regularClient = createTestClient(await createRegularUserSession());
  });

  beforeEach(() => {
    vi.mocked(submitDemoSchoolWorkflow).mockClear();
    vi.mocked(submitDemoSchoolPurgeWorkflow).mockClear();
    vi.mocked(cancelRestateInvocationAndWait).mockClear();
    vi.mocked(getRestateInvocationStatus).mockReset().mockResolvedValue('running');
  });

  it('rejects anonymous callers and users without the demo grants', async () => {
    const anonymous = createTestClient(null);
    await expectRpcCode(anonymous.systemAdmin.listDemoClassCatalogue({}), 'UNAUTHORIZED');
    await expectRpcCode(regularClient.systemAdmin.listDemoClassCatalogue({}), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.createDemoSchool(validInput), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.getDemoSchoolJob({ jobId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.getDemoCredentialsDownload({ schoolId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.purgeDemoSchool({ schoolId: 'x', confirmation: 'x' }), 'FORBIDDEN');
  });

  it('lists the class catalogue in display order', async () => {
    const catalogue = await adminClient.systemAdmin.listDemoClassCatalogue({});
    expect(catalogue.pagination).toMatchObject({ totalItems: 13, pageSize: 20, currentPage: 1 });
    expect(catalogue.items[0]).toEqual({ slug: 'nursery', label: 'Nursery', displayOrder: 1 });
    expect(catalogue.items.at(-1)?.slug).toBe('class-10');
  });

  it('validates input before writing anything', async () => {
    await expectRpcCode(adminClient.systemAdmin.createDemoSchool({ ...validInput, classSlugs: [] }), 'BAD_REQUEST');
    await expectRpcCode(adminClient.systemAdmin.createDemoSchool({ ...validInput, classSlugs: ['class-99'] }), 'BAD_REQUEST');
    await expectRpcCode(adminClient.systemAdmin.createDemoSchool({ ...validInput, sessionEndYear: 2029 }), 'BAD_REQUEST');
    await expectRpcCode(adminClient.systemAdmin.createDemoSchool({ ...validInput, cycleStartMonth: 13 }), 'BAD_REQUEST');
    await expectRpcCode(adminClient.systemAdmin.createDemoSchool({ ...validInput, slug: 'Not A Slug' }), 'BAD_REQUEST');
  });

  it('creates the demo school, the principal role and a queued job in one transaction', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool(validInput);
    expect(created.school).toMatchObject({ isDemo: true, slug: 'router-test-school', name: validInput.name });
    expect(created.school.registrationNo).toMatch(/^[1-9]\d{11}$/);
    expect(created.job).toMatchObject({ status: 'queued', attempt: 1, completedSteps: [], summary: null });
    const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, created.school.id));
    expect(school).toMatchObject({ isDemo: true, demoCreatedBy: admin.user.id });
    const roles = await db.select().from(schoolUserRoleTable).where(and(eq(schoolUserRoleTable.schoolId, created.school.id), eq(schoolUserRoleTable.userId, admin.user.id)));
    expect(roles.map((row) => row.role)).toEqual(['principal']);

    const second = await adminClient.systemAdmin.createDemoSchool({ ...validInput, registrationNo: 'REG-KEEP-1' });
    expect(second.school.slug).toBe('router-test-school-2');
    expect(second.school.registrationNo).toBe('REG-KEEP-1');

    const fetched = await adminClient.systemAdmin.getDemoSchoolJob({ jobId: created.job.id });
    expect(fetched.id).toBe(created.job.id);
    expect((await adminClient.systemAdmin.getSchoolDemoJob({ schoolId: created.school.id })).id).toBe(created.job.id);
    await expectRpcCode(adminClient.systemAdmin.getDemoSchoolJob({ jobId: 'dsj_missing' }), 'NOT_FOUND');
  });

  it('starts a queued job idempotently and retries only failed jobs', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Start Test School' });
    await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    // The second start finds the first run alive and reuses it.
    expect(vi.mocked(submitDemoSchoolWorkflow).mock.calls).toEqual([[created.job.id, 1]]);
    const [row] = await db.select().from(demoSchoolJobTable).where(eq(demoSchoolJobTable.id, created.job.id));
    expect(row!.invocationId).toBe(`inv_${created.job.id}_1`);

    // A run that ended without finishing the job is replaced by a new attempt.
    vi.mocked(getRestateInvocationStatus).mockResolvedValueOnce('completed');
    const restarted = await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    expect(restarted).toMatchObject({ status: 'queued', attempt: 2 });
    expect(vi.mocked(submitDemoSchoolWorkflow)).toHaveBeenLastCalledWith(created.job.id, 2);

    await expectRpcCode(adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    await db.update(demoSchoolJobTable).set({ status: 'failed', error: { step: 'finance', message: 'x' } }).where(eq(demoSchoolJobTable.id, created.job.id));
    await expectRpcCode(adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    const retried = await adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id });
    expect(retried).toMatchObject({ status: 'queued', attempt: 3, error: null });
    expect(vi.mocked(submitDemoSchoolWorkflow)).toHaveBeenLastCalledWith(created.job.id, 3);
  });

  it('offers credentials only for a demo school whose seed succeeded', async () => {
    const real = await createTestSchool();
    await expectRpcCode(adminClient.systemAdmin.getDemoCredentialsDownload({ schoolId: real.id }), 'BAD_REQUEST');
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Credentials Test School' });
    await expectRpcCode(adminClient.systemAdmin.getDemoCredentialsDownload({ schoolId: created.school.id }), 'NOT_FOUND');
    await expectRpcCode(adminClient.systemAdmin.getDemoCredentialsDownload({ schoolId: 'sch_missing' }), 'NOT_FOUND');
  });

  it('refuses to purge a real school or without the exact slug', async () => {
    const real = await createTestSchool();
    await expectRpcCode(adminClient.systemAdmin.purgeDemoSchool({ schoolId: real.id, confirmation: real.slug }), 'BAD_REQUEST');
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Wrong Confirmation School' });
    await expectRpcCode(adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: 'nope' }), 'BAD_REQUEST');
    await expectRpcCode(adminClient.systemAdmin.purgeDemoSchool({ schoolId: 'sch_missing', confirmation: 'x' }), 'NOT_FOUND');
    expect(await db.select().from(schoolTable).where(eq(schoolTable.id, created.school.id))).toHaveLength(1);
  });

  it('purges a demo school, its demo users and files but keeps the admin', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Purge Test School' });
    await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    const demoUser = await createTestUser({ email: `manager.${created.school.slug}@campuspilot.in` });
    const profileKey = `users/${demoUser.id}/profile-image/test.png`;
    const orphanKey = `schools/${created.school.id}/orphan/file.txt`;
    // A key outside the demo's prefixes (e.g. another school's object) must survive.
    const foreignKey = `schools/sch_${'f'.repeat(21)}/logo/keep.png`;
    await db.update(user).set({ demoSchoolId: created.school.id, profileImageS3Key: profileKey }).where(eq(user.id, demoUser.id));
    await db.update(schoolTable).set({ logoS3Key: foreignKey }).where(eq(schoolTable.id, created.school.id));
    for (const key of [profileKey, orphanKey, foreignKey]) {
      await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: 'x' }));
    }

    const result = await adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: created.school.slug });
    expect(result).toMatchObject({ schoolId: created.school.id, fileCleanupScheduled: true });
    expect(result.deletedRows).toMatchObject({ user: 1, demo_school_job: 1, school_member: 1 });
    expect(vi.mocked(cancelRestateInvocationAndWait).mock.calls.map(([invocationId]) => invocationId)).toEqual([`inv_${created.job.id}_1`]);
    expect(vi.mocked(submitDemoSchoolPurgeWorkflow)).toHaveBeenCalledWith(created.school.id, 1);
    expect(await db.select().from(schoolTable).where(eq(schoolTable.id, created.school.id))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, demoUser.id))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, admin.user.id))).toHaveLength(1);

    // The workflow reads only the committed manifest and keeps foreign keys out.
    const [manifest] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    expect(manifest).toMatchObject({ status: 'scheduled', demoUserIds: [demoUser.id] });
    expect(manifest!.objectKeys).toEqual(expect.arrayContaining([profileKey, foreignKey]));
    const scope = (await loadDemoSchoolPurgeScope(created.school.id))!;
    expect(scope.prefixes).toEqual([`schools/${created.school.id}/`, `users/${demoUser.id}/`]);
    expect(scope.keys).toContain(profileKey);
    expect(scope.keys).not.toContain(foreignKey);
    const keys = await collectDemoSchoolObjectKeys(scope);
    expect(keys).toEqual(expect.arrayContaining([profileKey, orphanKey]));
    expect(keys).not.toContain(foreignKey);
    await deleteDemoSchoolObjectBatch(keys);
    expect(await collectDemoSchoolObjectKeys({ ...scope, keys: [] })).toEqual([]);
    expect(await collectDemoSchoolObjectKeys({ keys: [], prefixes: [`schools/sch_${'f'.repeat(21)}/`] })).toEqual([foreignKey]);
  });

  it('refuses cleanup scopes for existing schools or malformed IDs', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Scope Guard School' });
    await expect(loadDemoSchoolPurgeScope(created.school.id)).rejects.toThrow(/still exists/);
    expect(() => demoSchoolPurgeScope({ schoolId: '', objectKeys: [], demoUserIds: [] })).toThrow();
    expect(() => demoSchoolPurgeScope({ schoolId: `sch_${'a'.repeat(21)}`, objectKeys: [], demoUserIds: [''] })).toThrow();
    expect(demoSchoolPurgeScope({ schoolId: `sch_${'a'.repeat(21)}`, objectKeys: ['', 'schools/', `schools/sch_${'a'.repeat(21)}/`, `schools/sch_${'a'.repeat(21)}/../x`], demoUserIds: [] }).keys).toEqual([]);
  });

  it('resubmits purges whose cleanup Restate did not accept', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Outbox School' });
    vi.mocked(submitDemoSchoolPurgeWorkflow).mockRejectedValueOnce(new Error('Restate down'));
    const result = await adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: created.school.slug });
    expect(result.fileCleanupScheduled).toBe(false);
    const [pending] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    expect(pending).toMatchObject({ status: 'pending', submitAttempts: 1 });
    await resubmitPendingDemoPurges();
    const [scheduled] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    expect(scheduled).toMatchObject({ status: 'scheduled', submitAttempts: 2 });

    // A terminal cleanup failure goes back to pending under the next attempt.
    await db.update(demoSchoolPurgeTable).set({ status: 'failed', lastError: 'x' }).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    vi.mocked(submitDemoSchoolPurgeWorkflow).mockClear();
    await resubmitPendingDemoPurges();
    const [retried] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    expect(retried).toMatchObject({ status: 'scheduled', cleanupAttempt: 2 });
    expect(vi.mocked(submitDemoSchoolPurgeWorkflow)).toHaveBeenCalledWith(created.school.id, 2);
    // A completed cleanup is never overwritten by a late resubmission.
    await db.update(demoSchoolPurgeTable).set({ status: 'completed' }).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    await resubmitPendingDemoPurges();
    const [done] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    expect(done!.status).toBe('completed');
  });

  it('refuses start and retry once a purge was requested, and keeps finished jobs finished', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Fenced School' });
    await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    // A run that just succeeded is not reset even if Restate says it completed.
    await db.update(demoSchoolJobTable).set({ status: 'succeeded' }).where(eq(demoSchoolJobTable.id, created.job.id));
    vi.mocked(getRestateInvocationStatus).mockResolvedValueOnce('completed');
    expect(await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id })).toMatchObject({ status: 'succeeded', attempt: 1 });

    await db.update(demoSchoolJobTable).set({ status: 'failed', purgeRequestedAt: new Date() }).where(eq(demoSchoolJobTable.id, created.job.id));
    await expectRpcCode(adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    await expectRpcCode(adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    await expect(createDemoSchoolJobContext(created.job.id)).rejects.toThrow(/being purged/);
    const key = `schools/${created.school.id}/logo/fenced.png`;
    await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: 'x' }));
    await expect(assertUploadsKept(created.job.id, created.school.id, [key])).rejects.toThrow(/being purged/);
    expect(await collectDemoSchoolObjectKeys({ keys: [], prefixes: [`schools/${created.school.id}/`] })).toEqual([]);
  });

  it('passes a worker-unavailable error through unchanged', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Unavailable School' });
    vi.mocked(submitDemoSchoolWorkflow).mockRejectedValueOnce(new ORPCError('SERVICE_UNAVAILABLE', { message: 'The demo worker is unavailable right now. Try again in a moment.' }));
    await expectRpcCode(adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id }), 'SERVICE_UNAVAILABLE');
  });
});
