import { db } from '@campuspilot/db';
import {
  assistantConversationTable,
  assistantModelRequestTable,
  assistantRunTable,
  schoolAssistantAccessRoleTable,
} from '@campuspilot/db/schema/assistant';
import type { Role } from '@campuspilot/db/schema/jsonb/role';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { getRedisClient } from '@campuspilot/redis/client';
import { verifyAssistantToken } from '@campuspilot/auth/assistant-token';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createHandlerContext, createSchoolStaffSession, createTestSchool, setTestSchoolFeature } from '../../test/fixtures';
import { expectFeatureDisabled } from '../../test/feature-flags';
import { resolveAssistantAccess } from './access';
import { istMonthOf } from './ist';
import { issueAssistantRunToken } from './token';

/**
 * The one assistant access decision (`resolveAssistantAccess`) against the
 * real tables, and the in-process token issue that relies on it.
 */

/**
 * Turns the assistant on for a school with the given settings. A school with
 * no role switched on gets the default roles with it (principal, manager,
 * exam coordinator, accountant; never the teacher these tests use).
 */
const enableAssistant = (schoolId: string, config: { monthlyLimitUsd: number | null; voice?: { enabled: boolean } }) =>
  setTestSchoolFeature(schoolId, 'assistant', true, { voice: { enabled: false }, ...config });

/** Switches the assistant off for the school; its settings and role list are kept. */
const disableAssistant = (schoolId: string) => setTestSchoolFeature(schoolId, 'assistant', false);

async function switchOn(schoolId: string, ...roles: Role[]) {
  await db.insert(schoolAssistantAccessRoleTable).values(roles.map((role) => ({ schoolId, role })));
}

async function switchOff(schoolId: string, ...roles: Role[]) {
  await db
    .delete(schoolAssistantAccessRoleTable)
    .where(and(eq(schoolAssistantAccessRoleTable.schoolId, schoolId), inArray(schoolAssistantAccessRoleTable.role, roles)));
}

const switchedOnRoles = async (schoolId: string) =>
  (await db.select().from(schoolAssistantAccessRoleTable).where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId)))
    .map((row) => row.role)
    .sort();

/** A teacher of the school, with the API context of their session. */
async function teacherOf(schoolId: string) {
  const staff = await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [] } }]);
  return { ...staff, context: createHandlerContext(staff.session) };
}

/** Saves a model request of `costUsd` for the school (this month unless `at` says when), as the worker does. */
async function spend(schoolId: string, userId: string, costUsd: string, at?: Date) {
  const [conversation] = await db
    .insert(assistantConversationTable)
    .values({ schoolId, userId, provider: 'gemini', model: 'm' })
    .returning();
  const [run] = await db
    .insert(assistantRunTable)
    .values({ conversationId: conversation!.id, schoolId, userId, clientRequestId: randomUUID(), surface: 'panel', sequence: 1 })
    .returning();
  await db.insert(assistantModelRequestTable).values({
    source: 'chat',
    runId: run!.id,
    schoolId,
    userId,
    requestKey: `${run!.id}:model:0`,
    provider: 'gemini',
    requestedModel: 'm',
    answeredModel: 'm',
    usageComplete: true,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    inputUsdPerMtok: '1',
    outputUsdPerMtok: '1',
    cacheReadUsdPerMtok: '0',
    cacheWriteUsdPerMtok: '0',
    costUsd,
    ...(at ? { createdAt: at } : {}),
  });
}

describe('resolveAssistantAccess', () => {
  it('refuses everything while the feature is off, even for a role the school switched on', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await switchOn(school.id, 'teacher');
    const decision = await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id });
    expect(decision).toMatchObject({ featureEnabled: false, allowed: false, refusal: { code: 'feature_disabled' } });

    // A disabled flag keeps its settings and still refuses.
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    await disableAssistant(school.id);
    expect((await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).refusal?.code).toBe('feature_disabled');
  });

  it('allows a role once it is switched on in the school’s role list, and refuses it once it is switched off', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({
      featureEnabled: true,
      member: true,
      allowedRoles: [],
      allowed: false,
      refusal: { code: 'role_not_enabled' },
    });

    await switchOn(school.id, 'teacher');
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({
      allowedRoles: ['teacher'],
      allowed: true,
      refusal: null,
    });

    await switchOff(school.id, 'teacher');
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({
      allowedRoles: [],
      allowed: false,
      refusal: { code: 'role_not_enabled' },
    });
  });

  it('reports the school’s voice switch as its own fact, which never grants use by itself', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: null, voice: { enabled: true } });
    // Voice is on, but the teacher's role is not switched on: no use, and the voice fact is still reported.
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({ allowed: false, voiceEnabled: true, refusal: { code: 'role_not_enabled' } });

    await switchOn(school.id, 'teacher');
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({ allowed: true, voiceEnabled: true });

    await enableAssistant(school.id, { monthlyLimitUsd: null });
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({ allowed: true, voiceEnabled: false });

    // A switched-off assistant has no voice, whatever its kept settings say.
    await enableAssistant(school.id, { monthlyLimitUsd: null, voice: { enabled: true } });
    await disableAssistant(school.id);
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({ allowed: false, voiceEnabled: false });
  });

  it('decides from the school’s one role list alone: the default roles on enabling, and whatever is saved after', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const accountant = await createSchoolStaffSession(school.id, [{ role: 'accountant' }]);
    // Enabling the assistant for a school with no role switched on switches the default roles on.
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    expect(await switchedOnRoles(school.id)).toEqual(['accountant', 'exam_coordinator', 'manager', 'principal']);
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).toMatchObject({ allowedRoles: ['principal'], allowed: true });
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: accountant.user.id })).toMatchObject({ allowedRoles: ['accountant'], allowed: true });
    expect((await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).refusal?.code).toBe('role_not_enabled');

    // There is no second "eligible" list: a role switched on grants use, a role switched off does not.
    await switchOn(school.id, 'teacher');
    await switchOff(school.id, 'principal');
    expect((await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).allowed).toBe(true);
    expect((await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).refusal?.code).toBe('role_not_enabled');
  });

  it('keeps the school’s role list across switching the assistant off and on, and writes the defaults only for an empty list', async () => {
    const school = await createTestSchool();
    await switchOn(school.id, 'teacher');
    // A list that exists is kept as it is: no default role is added to it.
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    expect(await switchedOnRoles(school.id)).toEqual(['teacher']);
    await disableAssistant(school.id);
    expect(await switchedOnRoles(school.id)).toEqual(['teacher']);
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    expect(await switchedOnRoles(school.id)).toEqual(['teacher']);

    // Saving the settings of an assistant that is already on never touches the list, even an empty one.
    await switchOff(school.id, 'teacher');
    await enableAssistant(school.id, { monthlyLimitUsd: 5 });
    expect(await switchedOnRoles(school.id)).toEqual([]);

    // Switching it on again for a school whose every role was switched off writes the defaults again.
    await disableAssistant(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: 5 });
    expect(await switchedOnRoles(school.id)).toEqual(['accountant', 'exam_coordinator', 'manager', 'principal']);
  });

  it('refuses someone who is not a member of the school', async () => {
    const school = await createTestSchool();
    const other = await createTestSchool();
    const outsider = await teacherOf(other.id);
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    await switchOn(school.id, 'teacher');
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: outsider.user.id })).toMatchObject({
      member: false,
      refusal: { code: 'not_member' },
    });
  });

  it('refuses once the school’s saved spend this IST month reaches its limit, and not before', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: 1 });
    await switchOn(school.id, 'teacher');
    const redis = getRedisClient();
    const cacheKey = `assistant:spend:${school.id}:${istMonthOf(new Date()).month}`;

    await spend(school.id, teacher.user.id, '0.99999999');
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({
      allowed: true,
      limitReached: false,
      limit: { known: true, monthlyLimitUsd: 1 },
    });
    // The spend is cached for limit checks (10 minutes); a new request is
    // seen once the cache entry is gone.
    expect(await redis.get(cacheKey)).toBe('0.99999999');
    await spend(school.id, teacher.user.id, '0.00000001');
    expect((await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).allowed).toBe(true);
    await redis.del(cacheKey);
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({
      allowed: false,
      limitReached: true,
      refusal: { code: 'limit_reached' },
    });
  });

  it('counts spend by IST month: 18:29 UTC on the last day is still that month, 18:31 UTC is the next', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: 1 });
    await switchOn(school.id, 'teacher');
    const redis = getRedisClient();
    await redis.del(`assistant:spend:${school.id}:2033-01`, `assistant:spend:${school.id}:2033-02`);
    // 23:59 IST on 31 January, and 00:01 IST on 1 February.
    await spend(school.id, teacher.user.id, '1', new Date('2033-01-31T18:29:00Z'));
    await spend(school.id, teacher.user.id, '0.5', new Date('2033-01-31T18:31:00Z'));

    const inJanuary = await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id, now: new Date('2033-01-31T18:29:30Z') });
    expect(inJanuary).toMatchObject({ limitReached: true, refusal: { code: 'limit_reached' } });
    const inFebruary = await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id, now: new Date('2033-01-31T18:31:30Z') });
    expect(inFebruary).toMatchObject({ limitReached: false, allowed: true });
    expect(await redis.get(`assistant:spend:${school.id}:2033-01`)).toBe('1.00000000');
    expect(await redis.get(`assistant:spend:${school.id}:2033-02`)).toBe('0.50000000');
  });

  it('refuses with config_invalid when the stored settings no longer match their schema', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await db.insert(schoolFeatureFlagTable).values({ schoolId: school.id, feature: 'assistant', enabled: true, config: { stale: true } });
    expect((await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).refusal?.code).toBe('config_invalid');
  });
});

describe('issueAssistantRunToken', () => {
  const scope = (schoolId: string) => ({ schoolId, conversationId: 'asc_conversation', runId: 'asr_run' });

  it('signs a token for exactly that user, school, conversation and run when the user may use the assistant', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    await switchOn(school.id, 'teacher');
    const { token } = await issueAssistantRunToken(teacher.context, scope(school.id));
    expect(await verifyAssistantToken(token)).toMatchObject({
      userId: teacher.user.id,
      schoolId: school.id,
      conversationId: 'asc_conversation',
      runId: 'asr_run',
    });
  });

  it('refuses while the feature is off', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await switchOn(school.id, 'teacher');
    await expectFeatureDisabled(issueAssistantRunToken(teacher.context, scope(school.id)), 'assistant');
  });

  it('refuses a role the school did not switch on, and a school at its limit', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: 0.5 });
    await expect(issueAssistantRunToken(teacher.context, scope(school.id))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      data: { reason: 'role_not_enabled' },
    });
    await switchOn(school.id, 'teacher');
    await spend(school.id, teacher.user.id, '0.5');
    await getRedisClient().del(`assistant:spend:${school.id}:${istMonthOf(new Date()).month}`);
    await expect(issueAssistantRunToken(teacher.context, scope(school.id))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      data: { reason: 'limit_reached' },
    });
  });

  it('refuses an impersonated session and anything but a browser session', async () => {
    const school = await createTestSchool();
    const teacher = await teacherOf(school.id);
    await enableAssistant(school.id, { monthlyLimitUsd: null });
    await switchOn(school.id, 'teacher');
    const impersonated = createHandlerContext({
      ...teacher.session,
      session: { ...teacher.session.session, impersonatedBy: 'admin-user' },
    } as typeof teacher.session);
    await expect(issueAssistantRunToken(impersonated, scope(school.id))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      issueAssistantRunToken({ ...teacher.context, principal: { authMethod: 'apiKey' } }, scope(school.id)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
