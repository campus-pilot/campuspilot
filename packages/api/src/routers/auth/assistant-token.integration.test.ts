import {
  ASSISTANT_SERVICE_SECRET_HEADER,
  verifyAssistantToken,
} from '@campuspilot/auth/assistant-token';
import { describe, expect, it } from 'vitest';

import {
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
} from '../../../test/fixtures';

const serviceHeaders = () =>
  new Headers({ [ASSISTANT_SERVICE_SECRET_HEADER]: process.env.ASSISTANT_SERVICE_SECRET! });
const scope = (schoolId: string) => ({ schoolId, conversationId: 'asc_test', runId: 'asr_test' });

describe('auth.issueAssistantToken', () => {
  it('rejects anonymous callers', async () => {
    const school = await createTestSchool();
    await expect(
      createTestClient(null, serviceHeaders()).auth.issueAssistantToken(scope(school.id)),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('requires the assistant service secret', async () => {
    const school = await createTestSchool();
    const { session } = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    await expect(
      createTestClient(session).auth.issueAssistantToken(scope(school.id)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createTestClient(
        session,
        new Headers({ [ASSISTANT_SERVICE_SECRET_HEADER]: 'not-the-secret-not-the-secret-000' }),
      ).auth.issueAssistantToken(scope(school.id)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires the assistant permission in that school', async () => {
    const school = await createTestSchool();
    const otherSchool = await createTestSchool();
    const { session } = await createSchoolStaffSession(school.id, [{ role: 'teacher' }]);
    await expect(
      createTestClient(session, serviceHeaders()).auth.issueAssistantToken(scope(otherSchool.id)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('validates the scope before issuing', async () => {
    const school = await createTestSchool();
    const { session } = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    await expect(
      createTestClient(session, serviceHeaders()).auth.issueAssistantToken({
        ...scope(school.id),
        runId: '',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('issues a token bound to the user, school, conversation and run', async () => {
    const school = await createTestSchool();
    const { session, user } = await createSchoolStaffSession(school.id, [{ role: 'teacher' }]);
    const issued = await createTestClient(session, serviceHeaders()).auth.issueAssistantToken(
      scope(school.id),
    );
    const claims = await verifyAssistantToken(issued.token);
    expect(claims).toMatchObject({
      userId: user.id,
      schoolId: school.id,
      conversationId: 'asc_test',
      runId: 'asr_test',
    });
    expect(new Date(issued.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await verifyAssistantToken(`${issued.token}x`)).toBeNull();
  });
});
