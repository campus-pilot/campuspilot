import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { OpaClient, OpaHttpError } from '../client';
import { startOpaContainer, type RunningOpaContainer } from './opa-container';

describe('OpaClient Integration', () => {
  let runningOpa: RunningOpaContainer;
  let client: OpaClient;

  beforeAll(async () => {
    runningOpa = await startOpaContainer();
    client = new OpaClient(runningOpa.url);
  }, 45000);

  afterAll(async () => {
    if (runningOpa) {
      await runningOpa.stop();
    }
  });

  it('queries raw policy data', async () => {
    const response = await client.query<
      { action: string; subject: { userId: string; roleAssignments: [] }; resource: { kind: 'system' } },
      { allowed: boolean }
    >('campuspilot/authorization/decision', {
      action: 'unknown.action',
      subject: { userId: 'u1', roleAssignments: [] },
      resource: { kind: 'system' },
    });

    expect(response).toBeDefined();
    expect(response.result).toEqual({ allowed: false });
  });

  it('queries validated policy decision using a Zod schema', async () => {
    const decisionSchema = z.object({
      allowed: z.boolean(),
    });

    const result = await client.queryValidated(
      'campuspilot/authorization/decision',
      {
        action: 'system.school.list',
        subject: {
          userId: 'admin-1',
          roleAssignments: [
            { role: 'platform.admin', scope: { kind: 'platform' } },
          ],
        },
        resource: { kind: 'system' },
      },
      decisionSchema,
    );

    expect(result).toEqual({ allowed: true });
  });

  it('fails Zod validation when policy result does not match schema', async () => {
    const strictSchema = z.object({
      mustHaveString: z.string(),
    });

    await expect(
      client.queryValidated(
        'campuspilot/authorization/decision',
        {
          action: 'system.school.list',
          subject: { userId: 'u1', roleAssignments: [] },
          resource: { kind: 'system' },
        },
        strictSchema,
      ),
    ).rejects.toThrow();
  });

  it('throws OpaHttpError when HTTP status is not ok', async () => {
    const badClient = new OpaClient(runningOpa.url, async () => {
      return new Response('Not Found', { status: 404 });
    });

    await expect(
      badClient.query('campuspilot/authorization/decision', {}),
    ).rejects.toThrow(OpaHttpError);
  });
});
