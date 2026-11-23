import { db } from '@campuspilot/db';
import { schoolSetupTable } from '@campuspilot/db/schema/school-setup';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';

import type { Context } from '../../context';
import { assertPermission } from '../../permissions/authorization';
import { SchoolSetupStepError } from '../../school-setup/school-setup.service';

/**
 * Checks, before every step, that the admin who started the setup may still
 * run it: the account exists, is not banned, and OPA still grants
 * `system.school_setup.manage` to it. The workflow acts as that admin
 * (a `system-job` principal that HTTP can never produce), so a revoked
 * administrator stops the setup at its next step.
 */
export async function assertSchoolSetupActor(setupId: string) {
  const [setup] = await db.select({ requestedBy: schoolSetupTable.requestedBy }).from(schoolSetupTable).where(eq(schoolSetupTable.id, setupId)).limit(1);
  if (!setup?.requestedBy) throw new SchoolSetupStepError('The admin who started this setup no longer exists.');
  const requestedBy = setup.requestedBy;
  const user = await db.query.user.findFirst({ where: (table, { eq: equals }) => equals(table.id, requestedBy) });
  if (!user) throw new SchoolSetupStepError('The admin who started this setup no longer exists.');
  if (user.banned && (!user.banExpires || user.banExpires > new Date())) throw new SchoolSetupStepError('The admin who started this setup is banned.');
  const now = new Date();
  const context = {
    db,
    headers: new Headers(),
    session: {
      user,
      session: {
        id: `system-job:${setupId}`,
        userId: user.id,
        token: '',
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
        authMethod: 'system-job',
        apiKeyId: null,
        impersonatedBy: null,
      },
    },
    principal: { authMethod: 'system-job', jobId: setupId },
  } as unknown as Context;
  try {
    await assertPermission(context, { action: SYSTEM_ACTIONS.MANAGE_SCHOOL_SETUP, resource: { kind: 'system' } });
  } catch (error) {
    // A refusal is final; anything else (OPA unreachable) is retried by the step.
    if (error instanceof ORPCError && error.code === 'FORBIDDEN') {
      throw new SchoolSetupStepError('The admin who started this setup may no longer set up schools.');
    }
    throw error;
  }
}
