import { PutObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { demoSchoolJobTable, demoSchoolPurgeTable } from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRouterClient } from '@orpc/server';

import { appRouter, type AppRouterClient } from '../../index';
import {
  createAdminSession,
  createHandlerContext,
  createRegularUserSession,
  createTestClient,
  createTestSchool,
  createTestUser,
  type TestClient,
  type UserSession,
} from '../../../../test/fixtures';
import { expectRpcCode } from '../../../../test/finance/assertions';
import { assertUploadsKept, createDemoSchoolJobContext } from '../../../workflows/demo-school/job-context';
import {
  collectDemoSchoolObjectKeys,
  demoSchoolPurgeScope,
  loadDemoSchoolPurgeScope,
  runDemoSchoolPurgeStages,
} from '../../../workflows/demo-school/purge-workflow';
import {
  cancelRestateInvocation,
  getRestateInvocation,
  listLiveDemoSeedInvocations,
} from '../../../workflows/demo-school/restate-admin';
import { sweepDemoSchoolOutbox } from './demo-school.outbox';
import { sendDemoSchoolPurge, sendDemoSchoolStart } from './demo-school.restate';

vi.mock('./demo-school.restate', () => ({
  sendDemoSchoolStart: vi.fn(async (jobId: string, attempt: number) => ({ invocationId: `inv_${jobId.slice(4)}${attempt}` })),
  sendDemoSchoolPurge: vi.fn(async (schoolId: string, attempt: number) => ({ invocationId: `inv_${schoolId.slice(4)}${attempt}` })),
}));
vi.mock('../../../workflows/demo-school/restate-admin', () => ({
  getRestateInvocation: vi.fn(async () => ({ status: 'running', createdAt: Date.now() })),
  cancelRestateInvocation: vi.fn(async () => undefined),
  listLiveDemoSeedInvocations: vi.fn(async () => []),
}));

/** Runs every purge stage inline, as the workflow would. */
function runPurgeInline(schoolId: string, attempt: number, stopSeedRuns = vi.fn(async () => undefined)) {
  return runDemoSchoolPurgeStages({ schoolId, attempt, step: (_name, action) => action(), stopSeedRuns });
}

async function jobRow(jobId: string) {
  const [row] = await db.select().from(demoSchoolJobTable).where(eq(demoSchoolJobTable.id, jobId));
  return row!;
}

async function purgeRow(schoolId: string) {
  const [row] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, schoolId));
  return row!;
}

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
  /** In-process client without the JSON round trip, which an event stream cannot take. */
  let streamClient: AppRouterClient;

  beforeAll(async () => {
    admin = await createAdminSession();
    adminClient = createTestClient(admin);
    regularClient = createTestClient(await createRegularUserSession());
    streamClient = createRouterClient(appRouter, { context: async () => createHandlerContext(admin) });
  });

  beforeEach(() => {
    vi.mocked(sendDemoSchoolStart).mockClear();
    vi.mocked(sendDemoSchoolPurge).mockClear();
    vi.mocked(cancelRestateInvocation).mockClear();
    vi.mocked(listLiveDemoSeedInvocations).mockReset().mockResolvedValue([]);
    vi.mocked(getRestateInvocation).mockReset().mockResolvedValue({ status: 'running', createdAt: Date.now() });
  });

  it('rejects anonymous callers and users without the demo grants', async () => {
    const anonymous = createTestClient(null);
    await expectRpcCode(anonymous.systemAdmin.listDemoClassCatalogue({}), 'UNAUTHORIZED');
    await expectRpcCode(regularClient.systemAdmin.listDemoClassCatalogue({}), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.createDemoSchool(validInput), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.getDemoSchoolJob({ jobId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.watchDemoSchoolJob({ jobId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.getDemoCredentialsDownload({ schoolId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.purgeDemoSchool({ schoolId: 'x', confirmation: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.retryDemoSchoolPurge({ schoolId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.getDemoSchoolPurge({ schoolId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.watchDemoSchoolPurge({ schoolId: 'x' }), 'FORBIDDEN');
    await expectRpcCode(regularClient.systemAdmin.listDemoSchoolPurges({}), 'FORBIDDEN');
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
    expect(created.job).toMatchObject({ status: 'queued', attempt: 1, completedSteps: [], summary: null, startRequestedAt: null });
    const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, created.school.id));
    expect(school).toMatchObject({ isDemo: true, demoCreatedBy: admin.user.id });
    const roles = await db.select().from(schoolUserRoleTable).where(and(eq(schoolUserRoleTable.schoolId, created.school.id), eq(schoolUserRoleTable.userId, admin.user.id)));
    expect(roles.map((row) => row.role)).toEqual(['principal']);
    // A demo shows every product area: both features are on from creation
    // (a real school starts with none), recorded against the requesting admin.
    const flags = await db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, created.school.id));
    expect(flags.map((row) => [row.feature, row.enabled, row.updatedBy]).sort()).toEqual([
      ['cadet', true, admin.user.id],
      ['notices', true, admin.user.id],
    ]);
    expect((await adminClient.systemAdmin.getSchoolFeatureFlags({ id: created.school.id })).features).toEqual({
      cadet: { enabled: true, config: null },
      notices: { enabled: true, config: null },
      assistant: { enabled: false, config: null },
    });

    const second = await adminClient.systemAdmin.createDemoSchool({ ...validInput, registrationNo: 'REG-KEEP-1' });
    expect(second.school.slug).toBe('router-test-school-2');
    expect(second.school.registrationNo).toBe('REG-KEEP-1');

    const fetched = await adminClient.systemAdmin.getDemoSchoolJob({ jobId: created.job.id });
    expect(fetched.id).toBe(created.job.id);
    expect((await adminClient.systemAdmin.getSchoolDemoJob({ schoolId: created.school.id })).id).toBe(created.job.id);
    await expectRpcCode(adminClient.systemAdmin.getDemoSchoolJob({ jobId: 'dsj_missing' }), 'NOT_FOUND');
  });

  it('returns from start at once and hands the start over in the background', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Start Test School' });
    let release!: () => void;
    vi.mocked(sendDemoSchoolStart).mockImplementationOnce(async (jobId, attempt) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { invocationId: `inv_${jobId.slice(4)}${attempt}` };
    });
    // Restate has not answered yet, but the request already returned.
    const started = await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    expect(started).toMatchObject({ status: 'queued', submittedAt: null });
    expect(started.startRequestedAt).not.toBeNull();
    await vi.waitFor(() => expect(vi.mocked(sendDemoSchoolStart)).toHaveBeenCalledWith(created.job.id, 1));
    release();
    await vi.waitFor(async () => expect((await jobRow(created.job.id)).submittedAt).not.toBeNull());
    expect(await jobRow(created.job.id)).toMatchObject({ submitAttempts: 1, submitInvocationId: `inv_${created.job.id.slice(4)}1`, lastSubmitError: null });

    // An accepted start is not sent again.
    await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    await sweepDemoSchoolOutbox();
    expect(vi.mocked(sendDemoSchoolStart)).toHaveBeenCalledTimes(1);

    await expectRpcCode(adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    await db.update(demoSchoolJobTable).set({ status: 'failed', error: { step: 'finance', message: 'x' } }).where(eq(demoSchoolJobTable.id, created.job.id));
    await expectRpcCode(adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    const retried = await adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id });
    expect(retried).toMatchObject({ status: 'queued', attempt: 2, error: null, submittedAt: null });
    await vi.waitFor(() => expect(vi.mocked(sendDemoSchoolStart)).toHaveBeenLastCalledWith(created.job.id, 2));
  });

  it('keeps an unaccepted start in the outbox, re-sends it, and fails it visibly after the deadline', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Outbox Start School' });
    vi.mocked(sendDemoSchoolStart).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id });
    await vi.waitFor(async () => expect((await jobRow(created.job.id)).submitAttempts).toBe(1));
    expect(await jobRow(created.job.id)).toMatchObject({ submittedAt: null, lastSubmitError: 'Restate is unreachable.' });
    expect((await adminClient.systemAdmin.getDemoSchoolJob({ jobId: created.job.id })).lastSubmitError).toBe('Restate is unreachable.');

    await sweepDemoSchoolOutbox();
    expect(await jobRow(created.job.id)).toMatchObject({ submitAttempts: 2, lastSubmitError: null });
    expect((await jobRow(created.job.id)).submittedAt).not.toBeNull();

    const late = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Late Start School' });
    vi.mocked(sendDemoSchoolStart).mockRejectedValue(new Error('down'));
    await adminClient.systemAdmin.startDemoSchoolJob({ jobId: late.job.id });
    await vi.waitFor(async () => expect((await jobRow(late.job.id)).submitAttempts).toBe(1));
    await db.update(demoSchoolJobTable).set({ startRequestedAt: sql`now() - interval '11 minutes'` }).where(eq(demoSchoolJobTable.id, late.job.id));
    await sweepDemoSchoolOutbox();
    expect(await jobRow(late.job.id)).toMatchObject({ status: 'failed', error: { step: 'start' } });
    vi.mocked(sendDemoSchoolStart).mockReset().mockImplementation(async (jobId, attempt) => ({ invocationId: `inv_${jobId.slice(4)}${attempt}` }));
  });

  it('fails accepted runs that Restate paused or that ended early, fenced by the checked invocation', async () => {
    const paused = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Paused Run School' });
    const ended = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Ended Run School' });
    const alive = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Alive Run School' });
    const old = sql`now() - interval '5 minutes'`;
    await db.update(demoSchoolJobTable).set({ startRequestedAt: old, submittedAt: old, submitInvocationId: 'inv_pausedcontrol', status: 'running', invocationId: 'inv_pausedrun', currentStep: 'finance' }).where(eq(demoSchoolJobTable.id, paused.job.id));
    await db.update(demoSchoolJobTable).set({ startRequestedAt: old, submittedAt: old, submitInvocationId: 'inv_endedcontrol' }).where(eq(demoSchoolJobTable.id, ended.job.id));
    await db.update(demoSchoolJobTable).set({ startRequestedAt: old, submittedAt: old, submitInvocationId: 'inv_alivecontrol', status: 'running', invocationId: 'inv_aliverun' }).where(eq(demoSchoolJobTable.id, alive.job.id));
    vi.mocked(getRestateInvocation).mockImplementation(async (id) => {
      if (id === 'inv_pausedrun') return { status: 'paused', createdAt: 0 };
      if (id === 'inv_endedcontrol') return null;
      return { status: 'running', createdAt: 0 };
    });
    await sweepDemoSchoolOutbox();
    expect(await jobRow(paused.job.id)).toMatchObject({ status: 'failed', error: { step: 'finance' } });
    expect(vi.mocked(cancelRestateInvocation)).toHaveBeenCalledWith('inv_pausedrun');
    expect(await jobRow(ended.job.id)).toMatchObject({ status: 'failed', error: { step: 'start' } });
    expect(await jobRow(alive.job.id)).toMatchObject({ status: 'running' });
  });

  it('streams a job until it is final', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Watched School' });
    const stream = await streamClient.systemAdmin.watchDemoSchoolJob({ jobId: created.job.id });
    const seen: string[] = [];
    for await (const job of stream) {
      seen.push(`${job.status}:${job.currentStep ?? ''}`);
      if (seen.length === 1) await db.update(demoSchoolJobTable).set({ status: 'running', currentStep: 'staff' }).where(eq(demoSchoolJobTable.id, created.job.id));
      if (seen.length === 2) await db.update(demoSchoolJobTable).set({ status: 'failed', error: { step: 'staff', message: 'x' } }).where(eq(demoSchoolJobTable.id, created.job.id));
    }
    expect(seen).toEqual(['queued:', 'running:staff', 'failed:staff']);
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

  it('records a purge and returns at once, then the purge stages delete everything but the admin', async () => {
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

    const requested = await adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: created.school.slug });
    expect(requested).toMatchObject({ schoolId: created.school.id, schoolName: 'Purge Test School', status: 'pending', attempt: 1, stage: null });
    // Nothing is deleted by the request itself; the jobs are frozen at once.
    expect(await db.select().from(schoolTable).where(eq(schoolTable.id, created.school.id))).toHaveLength(1);
    expect((await jobRow(created.job.id)).purgeRequestedAt).not.toBeNull();
    await expect(createDemoSchoolJobContext(created.job.id)).rejects.toThrow(/being purged/);
    await vi.waitFor(async () => expect((await purgeRow(created.school.id)).status).toBe('scheduled'));
    expect(vi.mocked(sendDemoSchoolPurge)).toHaveBeenCalledWith(created.school.id, 1);
    // A repeated request returns the same purge.
    expect(await adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: created.school.slug })).toMatchObject({ attempt: 1 });

    vi.mocked(listLiveDemoSeedInvocations).mockResolvedValueOnce(['inv_liveseed']);
    const stopSeedRuns = vi.fn(async () => undefined);
    expect(await runPurgeInline(created.school.id, 1, stopSeedRuns)).toMatchObject({ status: 'completed' });
    expect(vi.mocked(listLiveDemoSeedInvocations)).toHaveBeenCalledWith([created.job.id]);
    expect(stopSeedRuns).toHaveBeenCalledWith(['inv_liveseed']);
    expect(await db.select().from(schoolTable).where(eq(schoolTable.id, created.school.id))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, demoUser.id))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, admin.user.id))).toHaveLength(1);
    const manifest = await purgeRow(created.school.id);
    expect(manifest).toMatchObject({ status: 'completed', stage: null, demoUserIds: [demoUser.id] });
    expect(manifest.dataDeletedAt).not.toBeNull();
    expect(manifest.objectKeys).toEqual(expect.arrayContaining([profileKey, foreignKey]));
    expect(await collectDemoSchoolObjectKeys({ keys: [], prefixes: [`schools/${created.school.id}/`, `users/${demoUser.id}/`] })).toEqual([]);
    expect(await collectDemoSchoolObjectKeys({ keys: [], prefixes: [`schools/sch_${'f'.repeat(21)}/`] })).toEqual([foreignKey]);

    // The stream reports the final state and ends; a replay of the stages is a no-op.
    const events = [];
    for await (const purge of await streamClient.systemAdmin.watchDemoSchoolPurge({ schoolId: created.school.id })) events.push(purge.status);
    expect(events).toEqual(['completed']);
    expect(await runPurgeInline(created.school.id, 1)).toEqual({ status: 'refused', deleted: 0 });
  });

  it('lists failed purges, retries them under a new attempt and resumes after the data purge', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Failed Purge School' });
    await adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: created.school.slug });
    await vi.waitFor(async () => expect((await purgeRow(created.school.id)).status).toBe('scheduled'));
    await expectRpcCode(adminClient.systemAdmin.retryDemoSchoolPurge({ schoolId: created.school.id }), 'BAD_REQUEST');
    // Attempt 1 stops while stopping the seed (nothing deleted yet) and fails terminally.
    await expect(runPurgeInline(created.school.id, 1, vi.fn(async () => { throw new Error('Restate unavailable'); }))).rejects.toThrow();
    expect(await purgeRow(created.school.id)).toMatchObject({ stage: 'stopping-seed', dataDeletedAt: null });
    await db.update(demoSchoolPurgeTable).set({ status: 'failed', lastError: 'S3 refused' }).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));

    const attention = await adminClient.systemAdmin.listDemoSchoolPurges({});
    expect(attention.items.find((item) => item.schoolId === created.school.id)).toMatchObject({ status: 'failed', error: 'S3 refused', automaticRetryPending: true, schoolSlug: created.school.slug });

    const retried = await adminClient.systemAdmin.retryDemoSchoolPurge({ schoolId: created.school.id });
    expect(retried).toMatchObject({ status: 'pending', attempt: 2, error: 'S3 refused' });
    await vi.waitFor(() => expect(vi.mocked(sendDemoSchoolPurge)).toHaveBeenLastCalledWith(created.school.id, 2));
    // A stale attempt does nothing; the current one resumes and completes.
    expect(await runPurgeInline(created.school.id, 1)).toEqual({ status: 'refused', deleted: 0 });
    expect(await runPurgeInline(created.school.id, 2)).toMatchObject({ status: 'completed' });
    expect((await adminClient.systemAdmin.listDemoSchoolPurges({})).items.some((item) => item.schoolId === created.school.id)).toBe(false);
  });

  it('retries failed purges automatically with backoff, up to the limit', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Auto Retry School' });
    await adminClient.systemAdmin.purgeDemoSchool({ schoolId: created.school.id, confirmation: created.school.slug });
    await vi.waitFor(async () => expect((await purgeRow(created.school.id)).status).toBe('scheduled'));
    await db.update(demoSchoolPurgeTable).set({ status: 'failed', lastError: 'x' }).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    // Within the backoff nothing happens.
    await sweepDemoSchoolOutbox();
    expect(await purgeRow(created.school.id)).toMatchObject({ status: 'failed', attempt: 1 });
    await db.update(demoSchoolPurgeTable).set({ scheduledAt: sql`now() - interval '3 minutes'` }).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    await sweepDemoSchoolOutbox();
    expect(await purgeRow(created.school.id)).toMatchObject({ status: 'scheduled', attempt: 2 });
    // At the limit it waits for an admin.
    await db.update(demoSchoolPurgeTable).set({ status: 'failed', attempt: 5, scheduledAt: sql`now() - interval '1 day'` }).where(eq(demoSchoolPurgeTable.schoolId, created.school.id));
    await sweepDemoSchoolOutbox();
    expect(await purgeRow(created.school.id)).toMatchObject({ status: 'failed', attempt: 5 });
    expect((await adminClient.systemAdmin.getDemoSchoolPurge({ schoolId: created.school.id })).automaticRetryPending).toBe(false);
  });

  it('refuses cleanup scopes for existing schools or malformed IDs', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Scope Guard School' });
    await expect(loadDemoSchoolPurgeScope(created.school.id)).rejects.toThrow(/still exists/);
    expect(() => demoSchoolPurgeScope({ schoolId: '', objectKeys: [], demoUserIds: [] })).toThrow();
    expect(() => demoSchoolPurgeScope({ schoolId: `sch_${'a'.repeat(21)}`, objectKeys: [], demoUserIds: [''] })).toThrow();
    expect(demoSchoolPurgeScope({ schoolId: `sch_${'a'.repeat(21)}`, objectKeys: ['', 'schools/', `schools/sch_${'a'.repeat(21)}/`, `schools/sch_${'a'.repeat(21)}/../x`], demoUserIds: [] }).keys).toEqual([]);
  });

  it('refuses start and retry once a purge was requested', async () => {
    const created = await adminClient.systemAdmin.createDemoSchool({ ...validInput, name: 'Fenced School' });
    await db.update(demoSchoolJobTable).set({ status: 'failed', purgeRequestedAt: new Date() }).where(eq(demoSchoolJobTable.id, created.job.id));
    await expectRpcCode(adminClient.systemAdmin.startDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    await expectRpcCode(adminClient.systemAdmin.retryDemoSchoolJob({ jobId: created.job.id }), 'BAD_REQUEST');
    await expect(createDemoSchoolJobContext(created.job.id)).rejects.toThrow(/being purged/);
    const key = `schools/${created.school.id}/logo/fenced.png`;
    await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: 'x' }));
    await expect(assertUploadsKept(created.job.id, created.school.id, [key])).rejects.toThrow(/being purged/);
    expect(await collectDemoSchoolObjectKeys({ keys: [], prefixes: [`schools/${created.school.id}/`] })).toEqual([]);
  });
});
