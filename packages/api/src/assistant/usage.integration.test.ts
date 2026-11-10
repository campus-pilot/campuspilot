import { db } from '@campuspilot/db';
import {
  assistantConversationTable,
  assistantModelRequestTable,
  assistantRunTable,
} from '@campuspilot/db/schema/assistant';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { setSchoolFeature } from '../feature-flags/feature-flags.service';
import { expectFeatureDisabled, expectPermissionDenied } from '../../test/feature-flags';
import {
  createAdminSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
} from '../../test/fixtures';

/**
 * Usage reads over saved model requests. Each test uses its own far-away
 * range of dates, so the shared database and the one-hour Redis cache of
 * other tests never overlap with it.
 */

async function enable(schoolId: string) {
  await setSchoolFeature(db, {
    schoolId,
    feature: 'assistant',
    enabled: true,
    config: { monthlyLimitUsd: null, eligibleRoles: ['principal'] },
    updatedBy: null,
  });
}

/** Saves one model request as the worker would, at a given instant. */
async function request(options: {
  schoolId: string;
  userId: string;
  at: string;
  costUsd: string;
  model?: string;
  inputUsdPerMtok?: string;
  inputTokens?: number;
  usageComplete?: boolean;
}) {
  const [conversation] = await db
    .insert(assistantConversationTable)
    .values({ schoolId: options.schoolId, userId: options.userId, provider: 'gemini', model: 'm' })
    .returning();
  const [run] = await db
    .insert(assistantRunTable)
    .values({
      conversationId: conversation!.id,
      schoolId: options.schoolId,
      userId: options.userId,
      clientRequestId: randomUUID(),
      surface: 'panel',
      sequence: 1,
    })
    .returning();
  await db.insert(assistantModelRequestTable).values({
    runId: run!.id,
    schoolId: options.schoolId,
    userId: options.userId,
    requestKey: `${run!.id}:model:0`,
    provider: 'gemini',
    requestedModel: options.model ?? 'gemini-3.8-flash',
    answeredModel: options.model ?? 'gemini-3.8-flash',
    usageComplete: options.usageComplete ?? true,
    inputTokens: options.inputTokens ?? 1000,
    outputTokens: 100,
    cacheReadInputTokens: 10,
    cacheCreationInputTokens: 0,
    inputUsdPerMtok: options.inputUsdPerMtok ?? '0.75',
    outputUsdPerMtok: '3.75',
    cacheReadUsdPerMtok: '0.075',
    cacheWriteUsdPerMtok: '0',
    costUsd: options.costUsd,
    createdAt: new Date(options.at),
  });
}

describe('school.getAssistantUsage', () => {
  it('sums saved costs per IST day, listing every day of the range', async () => {
    const school = await createTestSchool();
    await enable(school.id);
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const userId = principal.user.id;
    // 18:29 UTC is 23:59 IST on the 1st; 18:31 UTC is already the 2nd in IST.
    await request({ schoolId: school.id, userId, at: '2031-03-01T18:29:00Z', costUsd: '0.10000000' });
    await request({ schoolId: school.id, userId, at: '2031-03-01T18:31:00Z', costUsd: '0.20000001' });
    await request({ schoolId: school.id, userId, at: '2031-03-02T00:00:00Z', costUsd: '0.00000001' });
    // Outside the range (IST 4 March) and another school: not counted.
    await request({ schoolId: school.id, userId, at: '2031-03-03T19:00:00Z', costUsd: '5' });

    const usage = await createTestClient(principal.session).school.getAssistantUsage({
      schoolId: school.id,
      from: '2031-03-01',
      to: '2031-03-03',
    });
    expect(usage.days.map((day) => [day.date, day.requests, day.costUsd])).toEqual([
      ['2031-03-01', 1, '0.1'],
      ['2031-03-02', 2, '0.20000002'],
      ['2031-03-03', 0, '0'],
    ]);
    expect(usage.total).toMatchObject({ requests: 3, costUsd: '0.30000002', inputTokens: 3000 });
    expect(usage.models).toEqual([
      expect.objectContaining({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        requests: 3,
        prices: [{ inputUsdPerMtok: '0.75', outputUsdPerMtok: '3.75', cacheReadUsdPerMtok: '0.075', cacheWriteUsdPerMtok: '0', requests: 3 }],
      }),
    ]);
  });

  it('adds token counts past the 32-bit range without overflow, and counts requests with incomplete usage', async () => {
    const school = await createTestSchool();
    await enable(school.id);
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const userId = principal.user.id;
    // Each row holds the largest integer the column takes; three of them pass 2³¹.
    for (const at of ['2031-07-01T06:00:00Z', '2031-07-01T07:00:00Z', '2031-07-01T08:00:00Z']) {
      await request({ schoolId: school.id, userId, at, costUsd: '1', inputTokens: 2_147_483_647 });
    }
    await request({ schoolId: school.id, userId, at: '2031-07-01T09:00:00Z', costUsd: '0', inputTokens: 0, usageComplete: false });

    const usage = await createTestClient(principal.session).school.getAssistantUsage({ schoolId: school.id, from: '2031-07-01', to: '2031-07-01' });
    expect(usage.total).toMatchObject({ requests: 4, incompleteRequests: 1, inputTokens: 3 * 2_147_483_647 });
    expect(usage.days[0]).toMatchObject({ inputTokens: 6_442_450_941, incompleteRequests: 1 });
    expect(usage.models[0]).toMatchObject({ inputTokens: 6_442_450_941, incompleteRequests: 1 });
  });

  it('is cached for an hour: a request saved after the first read is not seen yet', async () => {
    const school = await createTestSchool();
    await enable(school.id);
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const client = createTestClient(principal.session);
    const range = { schoolId: school.id, from: '2031-05-01', to: '2031-05-01' };
    await request({ schoolId: school.id, userId: principal.user.id, at: '2031-05-01T06:00:00Z', costUsd: '1' });
    expect((await client.school.getAssistantUsage(range)).total.costUsd).toBe('1');
    await request({ schoolId: school.id, userId: principal.user.id, at: '2031-05-01T07:00:00Z', costUsd: '1' });
    expect((await client.school.getAssistantUsage(range)).total.costUsd).toBe('1');
  });

  it('is for the principal and manager, behind the feature, with a validated range', async () => {
    const school = await createTestSchool();
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal' }])).session);
    const range = { schoolId: school.id, from: '2031-06-01', to: '2031-06-07' };
    await expectFeatureDisabled(principal.school.getAssistantUsage(range), 'assistant');
    await enable(school.id);
    await expect(principal.school.getAssistantUsage(range)).resolves.toMatchObject({ total: { requests: 0, costUsd: '0' } });
    const manager = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'manager' }])).session);
    await expect(manager.school.getAssistantUsage(range)).resolves.toMatchObject({ days: expect.any(Array) });
    const teacher = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session,
    );
    await expectPermissionDenied(teacher.school.getAssistantUsage(range));
    await expect(createTestClient(null).school.getAssistantUsage(range)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await expect(principal.school.getAssistantUsage({ ...range, from: '2031-06-08' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(principal.school.getAssistantUsage({ ...range, from: '2030-01-01' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(principal.school.getAssistantUsage({ ...range, to: '2031-02-30' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('systemAdmin assistant usage', () => {
  it('shows a school’s top users and the platform’s spend per model, price and school', async () => {
    const admin = createTestClient(await createAdminSession());
    const first = await createTestSchool({ name: 'First Usage School' });
    const second = await createTestSchool({ name: 'Second Usage School' });
    const staff = await createSchoolStaffSession(first.id, [{ role: 'principal' }]);
    const deletedUserId = `usr_deleted_${randomUUID()}`;
    await request({ schoolId: first.id, userId: staff.user.id, at: '2032-01-10T06:00:00Z', costUsd: '2' });
    await request({ schoolId: first.id, userId: deletedUserId, at: '2032-01-10T06:00:00Z', costUsd: '3' });
    // A price change mid-month shows as a second price row for the model.
    await request({ schoolId: second.id, userId: staff.user.id, at: '2032-01-11T06:00:00Z', costUsd: '1', inputUsdPerMtok: '1.5' });

    const school = await admin.systemAdmin.getSchoolAssistantUsage({ id: first.id, from: '2032-01-01', to: '2032-01-31' });
    expect(school.total.costUsd).toBe('5');
    expect(school.users).toEqual([
      { userId: deletedUserId, name: null, email: null, requests: 1, costUsd: '3' },
      expect.objectContaining({ userId: staff.user.id, requests: 1, costUsd: '2' }),
    ]);

    const platform = await admin.systemAdmin.getPlatformAssistantUsage({ from: '2032-01-01', to: '2032-01-31' });
    expect(platform.days).toHaveLength(31);
    expect(platform.total.costUsd).toBe('6');
    expect(platform.schools).toEqual([
      { schoolId: first.id, schoolName: 'First Usage School', requests: 2, costUsd: '5' },
      { schoolId: second.id, schoolName: 'Second Usage School', requests: 1, costUsd: '1' },
    ]);
    expect(platform.models).toHaveLength(1);
    expect(platform.models[0]!.prices.map((price) => [price.inputUsdPerMtok, price.requests]).sort()).toEqual([
      ['0.75', 2],
      ['1.5', 1],
    ]);

    await expect(admin.systemAdmin.getSchoolAssistantUsage({ id: 'sch_missing', from: '2032-01-01', to: '2032-01-31' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('is for platform administrators only', async () => {
    const school = await createTestSchool();
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal' }])).session);
    await expect(principal.systemAdmin.getPlatformAssistantUsage({ from: '2032-02-01', to: '2032-02-02' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      principal.systemAdmin.getSchoolAssistantUsage({ id: school.id, from: '2032-02-01', to: '2032-02-02' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
