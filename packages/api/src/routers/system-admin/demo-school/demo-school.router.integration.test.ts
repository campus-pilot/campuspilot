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
import { collectDemoSchoolObjectKeys, deleteDemoSchoolObjectBatch, type DemoSchoolPurgeInput } from '../../../workflows/demo-school/purge-workflow';
import { cancelRestateInvocation, submitDemoSchoolPurgeWorkflow, submitDemoSchoolWorkflow } from './demo-school.restate';

vi.mock('./demo-school.restate', () => ({
  submitDemoSchoolWorkflow: vi.fn(async (jobId: string, attempt: number) => ({ invocationId: `inv_${jobId}_${attempt}` })),
  submitDemoSchoolPurgeWorkflow: vi.fn(async () => ({ invocationId: 'inv_purge' })),
  cancelRestateInvocation: vi.fn(async () => undefined),
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
    vi.mocked(cancelRestateInvocation).mockClear();
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
    expect(vi.mocked(submitDemoSchoolWorkflow).mock.calls).toEqual([[created.job.id, 1], [created.job.id, 1]]);
    const [row] = await db.select().from(demoSchoolJobTable).where(eq(demoSchoolJobTable.id, created.job.id));
    expect(row!.invocationId).toBe(`inv_${created.job.id}_1`);

    await expectRpcCode(adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    await db.update(demoSchoolJobTable).set({ status: 'failed', error: { step: 'finance', message: 'x' } }).where(eq(demoSchoolJobTable.id, created.job.id));
    await expectRpcCode(adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    const retried = await adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id });
    expect(retried).toMatchObject({ status: 'queued', attempt: 2, error: null });
    expect(vi.mocked(submitDemoSchoolWorkflow)).toHaveBeenLastCalledWith(created.job.id, 2);
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
    await db.update(user).set({ demoSchoolId: created.school.id, profileImageS3Key: profileKey }).where(eq(user.id, demoUser.id));
    for (const key of [profileKey, orphanKey]) {
      await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: 'x' }));
    }

    const result = await adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: created.school.slug });
    expect(result).toMatchObject({ schoolId: created.school.id, fileCleanupScheduled: true });
    expect(result.deletedRows).toMatchObject({ user: 1, demo_school_job: 1, school_member: 1 });
    expect(vi.mocked(cancelRestateInvocation).mock.calls.map(([invocationId]) => invocationId)).toEqual([`inv_${created.job.id}_1`]);
    expect(await db.select().from(schoolTable).where(eq(schoolTable.id, created.school.id))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, demoUser.id))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, admin.user.id))).toHaveLength(1);

    // The S3 workflow input covers the recorded keys and both prefixes.
    const purgeInput = vi.mocked(submitDemoSchoolPurgeWorkflow).mock.calls[0]![0] as DemoSchoolPurgeInput;
    expect(purgeInput.keys).toContain(profileKey);
    expect(purgeInput.prefixes).toEqual([`schools/${created.school.id}/`, `users/${demoUser.id}/`]);
    const keys = await collectDemoSchoolObjectKeys(purgeInput);
    expect(keys).toEqual(expect.arrayContaining([profileKey, orphanKey]));
    await deleteDemoSchoolObjectBatch(keys);
    expect(await collectDemoSchoolObjectKeys({ ...purgeInput, keys: [] })).toEqual([]);
  });
});
