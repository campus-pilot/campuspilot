import { db } from '@campuspilot/db';
import { createRouterClient } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import {
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSchoolMember,
  createTestSession,
} from '../../test/fixtures';
import { retryFinanceConflict } from '../../test/finance/assertions';
import { createFinanceIdempotencyKey } from '../../test/finance/factories';
import { createFinanceScenario } from '../../test/finance/scenario';
import type { Context } from '../context';
import type { McpModule } from '../mcp-metadata';
import { appRouter } from '../routers/index';
import { assistantToolDecision } from './tool-policy';

type StaffSession = Awaited<ReturnType<typeof createSchoolStaffSession>>['session'];

/** A client acting as the assistant for this signed-in user, in one school's conversation, as the MCP gate builds it. */
function assistantClientFor(schoolId: string, session: StaffSession) {
  const context: Context = {
    db,
    headers: new Headers(),
    session: session as Context['session'],
    principal: {
      authMethod: 'assistant',
      assistantRun: { conversationId: 'asc_test', runId: 'asr_test', schoolId },
    },
  };
  return createRouterClient(appRouter, { context });
}

/** A client acting as the assistant for a new user with one role in one school. */
async function assistantClient(
  schoolId: string,
  role: 'principal' | 'teacher' | 'accountant' | 'exam_coordinator' = 'principal',
) {
  const { session } = await createSchoolStaffSession(schoolId, [{ role }]);
  return assistantClientFor(schoolId, session);
}

/** The assistant gate's own refusal, so a test cannot pass on OPA's refusal alone. */
const OWN_SCHOOL_ONLY = { code: 'FORBIDDEN', message: 'This assistant conversation can only act in its own school.' };

describe('assistant tool policy', () => {
  it('allows school modules, money included, and excludes platform, account and unreviewed tools', () => {
    const meta = (module: McpModule) => ({ exposure: 'core', access: 'read', destructive: false, module }) as const;
    for (const module of ['students', 'billing', 'dashboard', 'documents'] as const) {
      expect(assistantToolDecision(meta(module))).toEqual({ allowed: true, requiresApproval: false });
    }
    for (const module of ['platform', 'system', 'account', 'notices', 'notifications'] as const) {
      expect(assistantToolDecision(meta(module)).allowed).toBe(false);
    }
    expect(
      assistantToolDecision({ exposure: 'hidden', access: 'read', destructive: false, module: 'billing' })
        .allowed,
    ).toBe(false);
  });

  it('requires approval for every write, billing writes included', () => {
    for (const module of ['admissions', 'billing'] as const) {
      expect(assistantToolDecision({ exposure: 'core', access: 'write', destructive: false, module })).toEqual({
        allowed: true,
        requiresApproval: true,
      });
    }
  });
});

describe('assistant principal on procedures', () => {
  it('reads in its own school', async () => {
    const school = await createTestSchool();
    await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 });
    const client = await assistantClient(school.id);
    const sessions = await client.school.listSessions({ schoolId: school.id });
    expect(sessions.items).toHaveLength(1);
  });

  it('cannot act in another school, even where the user is a member', async () => {
    const school = await createTestSchool();
    const other = await createTestSchool();
    const { session, user } = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    await createTestSchoolMember({ schoolId: other.id, userId: user.id, roles: [{ role: 'principal' }] });
    // The user may read the other school in the app; only the assistant gate refuses.
    await expect(createTestClient(session).school.listSessions({ schoolId: other.id })).resolves.toBeDefined();
    const client = assistantClientFor(school.id, session);
    await expect(client.school.listSessions({ schoolId: other.id })).rejects.toMatchObject(OWN_SCHOOL_ONLY);
  });

  /**
   * The assistant has no permissions of its own: every call is decided for
   * the signed-in user's role, exactly as if they used the app. The same
   * call that a principal's assistant may make is refused for a teacher's.
   */
  it('is held to the role of the user it acts for', async () => {
    const school = await createTestSchool();
    const newClass = (slug: string) => ({
      schoolId: school.id,
      slug,
      label: `Class ${slug}`,
      sections: [{ slug: 'a', label: 'A' }],
    });

    for (const role of ['teacher', 'accountant', 'exam_coordinator'] as const) {
      const client = await assistantClient(school.id, role);
      await expect(client.school.createClass(newClass(`by-${role.replace('_', '-')}`))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      // What the role may read, its assistant may read.
      await expect(client.school.listClasses({ schoolId: school.id })).resolves.toEqual([]);
    }

    const principal = await assistantClient(school.id, 'principal');
    await expect(principal.school.createClass(newClass('by-principal'))).resolves.toMatchObject({
      slug: 'by-principal',
    });
    await expect(principal.school.listClasses({ schoolId: school.id })).resolves.toHaveLength(1);
  });

  it('lists only the conversation’s school, even for a member of several', async () => {
    const school = await createTestSchool({ name: 'Alpha Academy' });
    const other = await createTestSchool({ name: 'Beta School' });
    const { session, user } = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    await createTestSchoolMember({ schoolId: other.id, userId: user.id, roles: [{ role: 'principal' }] });

    // The same user sees both schools in the app, and only this one through the assistant.
    const own = await createTestClient(session).school.listMySchools();
    expect(own.map(({ id }) => id)).toEqual([school.id, other.id]);
    const client = assistantClientFor(school.id, session);
    await expect(client.school.listMySchools()).resolves.toEqual([expect.objectContaining({ id: school.id })]);
  });

  /**
   * Money tools are open to the assistant, but only as far as the user's role
   * goes: a teacher cannot read or record payments in the app, so neither can
   * a teacher's assistant, while an accountant's assistant can do both.
   */
  it('reads and records payments only as far as the user’s role allows', async () => {
    const scenario = await createFinanceScenario();
    const schoolId = scenario.school.id;
    const payment = {
      schoolId,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: '125000',
      currency: 'INR',
      method: 'cash' as const,
      receivedAt: '2040-05-02T10:00:00Z',
      effectiveAt: '2040-05-02T10:00:00Z',
      idempotencyKey: createFinanceIdempotencyKey('assistant-payment'),
    };
    const listInput = { schoolId, filters: { admissionId: scenario.admission.id } };

    const teacher = await assistantClient(schoolId, 'teacher');
    await expect(teacher.school.listPayments(listInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(teacher.school.recordPayment(payment)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The dashboard is open to every role; its money totals only to roles that may read them.
    const teacherDashboard = await teacher.school.getDashboard({ schoolId, sessionId: scenario.activeSession.id });
    expect(teacherDashboard.billing).toBeNull();

    const accountant = await assistantClient(schoolId, 'accountant');
    const recorded = await retryFinanceConflict(() => accountant.school.recordPayment(payment));
    expect(recorded).toMatchObject({ amountMinor: '125000', receiptNumber: expect.any(String) });
    const payments = await accountant.school.listPayments(listInput);
    expect(payments.items.map(({ id }) => id)).toEqual([recorded.id]);
    const accountantDashboard = await accountant.school.getDashboard({ schoolId, sessionId: scenario.activeSession.id });
    expect(accountantDashboard.billing).not.toBeNull();
  });

  it('cannot read or record money in another school, even where the user is its accountant', async () => {
    const scenario = await createFinanceScenario();
    const other = await createFinanceScenario();
    const { session, user } = await createSchoolStaffSession(scenario.school.id, [{ role: 'accountant' }]);
    await createTestSchoolMember({ schoolId: other.school.id, userId: user.id, roles: [{ role: 'accountant' }] });
    const otherPayments = { schoolId: other.school.id, filters: { admissionId: other.admission.id } };
    // The user may read the other school's payments in the app; only the assistant gate refuses.
    await expect(createTestClient(session).school.listPayments(otherPayments)).resolves.toMatchObject({ items: [] });

    const accountant = assistantClientFor(scenario.school.id, session);
    await expect(accountant.school.listPayments(otherPayments)).rejects.toMatchObject(OWN_SCHOOL_ONLY);
    await expect(
      accountant.school.recordPayment({
        schoolId: other.school.id,
        admissionId: other.admission.id,
        sessionId: other.activeSession.id,
        amountMinor: '100',
        currency: 'INR',
        method: 'cash',
        receivedAt: '2040-05-02T10:00:00Z',
        effectiveAt: '2040-05-02T10:00:00Z',
        idempotencyKey: createFinanceIdempotencyKey('assistant-other-school'),
      }),
    ).rejects.toMatchObject(OWN_SCHOOL_ONLY);
    await expect(createTestClient(session).school.listPayments(otherPayments)).resolves.toMatchObject({ items: [] });
  });

  /**
   * Finance documents are asked for like any other: by type or by domain.
   * Only the user's own finance document permission decides.
   */
  it('lists finance documents only for roles that may read them', async () => {
    const scenario = await createFinanceScenario();
    const schoolId = scenario.school.id;
    const teacher = await assistantClient(schoolId, 'teacher');
    await expect(
      teacher.school.listDocumentArtifacts({ schoolId, filters: { documentDomain: 'finance' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const accountant = await assistantClient(schoolId, 'accountant');
    await expect(
      accountant.school.listDocumentArtifacts({ schoolId, filters: { documentDomain: 'finance' } }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      accountant.school.listDocumentArtifacts({ schoolId, filters: { documentType: 'receipt' } }),
    ).resolves.toMatchObject({ items: [] });
  });
});
