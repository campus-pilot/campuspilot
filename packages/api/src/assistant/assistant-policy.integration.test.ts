import { db } from '@campuspilot/db';
import { createRouterClient } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import { createSchoolStaffSession, createTestSchool, createTestSession } from '../../test/fixtures';
import type { Context } from '../context';
import { appRouter } from '../routers/index';
import { assistantToolDecision, assistantToolInputDecision } from './tool-policy';

/** A client acting as the assistant for a user in one school, as the MCP gate builds it. */
async function assistantClient(
  schoolId: string,
  role: 'principal' | 'teacher' | 'accountant' | 'exam_coordinator' = 'principal',
) {
  const { session } = await createSchoolStaffSession(schoolId, [{ role }]);
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

describe('assistant tool policy', () => {
  it('allows school modules and excludes money, platform and account tools', () => {
    const meta = (module: 'students' | 'billing' | 'dashboard' | 'platform' | 'account') =>
      ({ exposure: 'core', access: 'read', destructive: false, module }) as const;
    expect(assistantToolDecision(meta('students'))).toEqual({ allowed: true, requiresApproval: false });
    for (const module of ['billing', 'dashboard', 'platform', 'account'] as const) {
      expect(assistantToolDecision(meta(module)).allowed).toBe(false);
    }
    expect(
      assistantToolDecision({ exposure: 'hidden', access: 'read', destructive: false, module: 'students' })
        .allowed,
    ).toBe(false);
  });

  it('requires approval for every write', () => {
    expect(
      assistantToolDecision({ exposure: 'core', access: 'write', destructive: false, module: 'admissions' }),
    ).toEqual({ allowed: true, requiresApproval: true });
  });

  it('rejects finance document types in document inputs', () => {
    const documents = { exposure: 'core', access: 'read', destructive: false, module: 'documents' } as const;
    expect(assistantToolInputDecision(documents, { filters: { documentType: 'receipt' } }).allowed).toBe(false);
    expect(assistantToolInputDecision(documents, { source: { documentType: 'bill' } }).allowed).toBe(false);
    expect(assistantToolInputDecision(documents, { filters: { documentType: 'report_card' } }).allowed).toBe(true);
  });

  it('rejects finance documents asked for by domain in document inputs', () => {
    const documents = { exposure: 'core', access: 'read', destructive: false, module: 'documents' } as const;
    // `all` includes finance documents, so it is refused like `finance`.
    expect(assistantToolInputDecision(documents, { filters: { documentDomain: 'finance' } }).allowed).toBe(false);
    expect(assistantToolInputDecision(documents, { filters: { documentDomain: 'all' } }).allowed).toBe(false);
    expect(assistantToolInputDecision(documents, { filters: { documentDomain: 'academic' } })).toEqual({
      allowed: true,
      requiresApproval: false,
    });
    // No domain is the API's default, which lists academic documents only.
    expect(assistantToolInputDecision(documents, { filters: {} })).toEqual({
      allowed: true,
      requiresApproval: false,
    });
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
    const client = await assistantClient(school.id);
    const other = await createTestSchool();
    await expect(client.school.listSessions({ schoolId: other.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
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

  it('cannot call billing procedures', async () => {
    const school = await createTestSchool();
    const client = await assistantClient(school.id);
    await expect(client.school.listPayments({ schoolId: school.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
