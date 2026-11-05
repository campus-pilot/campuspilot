import { db } from '@campuspilot/db';
import { createRouterClient } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import { createSchoolStaffSession, createTestSchool, createTestSession } from '../../test/fixtures';
import type { Context } from '../context';
import { appRouter } from '../routers/index';
import { assistantToolDecision, assistantToolInputDecision } from './tool-policy';

/** A client acting as the assistant for a user in one school, as the MCP gate builds it. */
async function assistantClient(schoolId: string) {
  const { session } = await createSchoolStaffSession(schoolId, [{ role: 'principal' }]);
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

  it('cannot call billing procedures', async () => {
    const school = await createTestSchool();
    const client = await assistantClient(school.id);
    await expect(client.school.listPayments({ schoolId: school.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
