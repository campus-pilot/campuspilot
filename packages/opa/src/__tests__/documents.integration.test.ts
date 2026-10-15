import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isAuthorized,
  type AuthorizationInput,
  type RoleAssignment,
} from '../authorization';
import { OpaClient } from '../client';
import { SCHOOL_ACTIONS, type SchoolAction } from '../generated/school';
import { startOpaContainer, type RunningOpaContainer } from './opa-container';

describe('Document permissions against real OPA', () => {
  let running: RunningOpaContainer;
  let client: OpaClient;
  beforeAll(async () => {
    running = await startOpaContainer();
    client = new OpaClient(running.url);
  }, 45000);
  afterAll(async () => {
    await running?.stop();
  });
  const request = (
    action: SchoolAction,
    role: RoleAssignment['role'],
    schoolId = 's1',
  ): AuthorizationInput =>
    ({
      action,
      subject: {
        userId: 'u1',
        roleAssignments: [
          {
            role,
            scope: { kind: 'school', schoolId },
            meta: null,
          } as RoleAssignment,
        ],
      },
      resource: { kind: 'school', schoolId: 's1' },
    }) as AuthorizationInput;
  it('grants reads separately from mutations and rejects other tenants', async () => {
    for (const action of [
      SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
      SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
      SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES,
      SCHOOL_ACTIONS.GENERATE_DOCUMENTS,
      SCHOOL_ACTIONS.DELETE_DOCUMENT_ARTIFACTS,
      SCHOOL_ACTIONS.EDIT_DOCUMENT_TEMPLATES_WITH_AI,
    ]) {
      for (const role of [
        'school.manager',
        'school.principal',
        'school.exam_coordinator',
      ] as const) {
        expect(await isAuthorized(request(action, role), { client })).toBe(
          true,
        );
        expect(
          await isAuthorized(request(action, role, 's2'), { client }),
        ).toBe(false);
      }
      const read =
        action === SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES ||
        action === SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS;
      expect(
        await isAuthorized(request(action, 'school.teacher'), { client }),
      ).toBe(read);
      expect(
        await client.queryValidated(
          'campuspilot/authorization/decision',
          request(action, 'school.accountant'),
          z.object({ allowed: z.boolean() }),
        ),
      ).toEqual({ allowed: read });
      expect(
        await client.queryValidated(
          'campuspilot/authorization/decision',
          {
            action,
            subject: {
              userId: 'malformed',
              roleAssignments: [
                { role: 'school.manager', scope: { kind: 'platform' } },
              ],
            },
            resource: { kind: 'school', schoolId: 's1' },
          },
          z.object({ allowed: z.boolean() }),
        ),
      ).toEqual({ allowed: false });
      expect(
        await isAuthorized(
          {
            action,
            subject: {
              userId: 'a',
              roleAssignments: [
                { role: 'platform.admin', scope: { kind: 'platform' } },
              ],
            },
            resource: { kind: 'school', schoolId: 's1' },
          },
          { client },
        ),
      ).toBe(false);
    }
  });
});
