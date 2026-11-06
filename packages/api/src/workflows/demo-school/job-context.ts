import { db } from '@campuspilot/db';
import { demoSchoolJobTable } from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../../context';

/** Raised when a job may no longer act; workflows treat it as terminal. */
export class DemoJobGuardError extends Error {
  override name = 'DemoJobGuardError';
}

/**
 * Builds the router context a demo-seed step runs under: the platform admin
 * who requested the job, identified by a `system-job` principal. This is the
 * only constructor of that principal and it is never reachable from HTTP;
 * `createContextFromHeaders` and `createOAuthContext` cannot produce it.
 *
 * Every write still goes through the real procedures and OPA checks under the
 * admin's live `platform.admin` and `school.principal` assignments, so no
 * permission is widened. Guards, re-checked on every step:
 * - the job exists and its school is still a demo school (`is_demo = true`);
 *   once a purge has removed the school, the next step stops here;
 * - the requesting admin still holds `school.principal` in that school;
 * - the requesting admin still exists and is not banned.
 */
export async function createDemoSchoolJobContext(jobId: string): Promise<Context> {
  const [job] = await db
    .select({
      schoolId: demoSchoolJobTable.schoolId,
      requestedBy: demoSchoolJobTable.requestedBy,
      isDemo: schoolTable.isDemo,
    })
    .from(demoSchoolJobTable)
    .innerJoin(schoolTable, eq(schoolTable.id, demoSchoolJobTable.schoolId))
    .where(eq(demoSchoolJobTable.id, jobId))
    .limit(1);
  if (!job) throw new DemoJobGuardError('The demo job or its school no longer exists.');
  if (!job.isDemo) throw new DemoJobGuardError('Only demo schools can be seeded by a system job.');
  const requestedBy = job.requestedBy;
  if (!requestedBy) throw new DemoJobGuardError('The requesting admin no longer exists.');

  const [principalRole] = await db
    .select({ role: schoolUserRoleTable.role })
    .from(schoolUserRoleTable)
    .where(
      and(
        eq(schoolUserRoleTable.schoolId, job.schoolId),
        eq(schoolUserRoleTable.userId, requestedBy),
        eq(schoolUserRoleTable.role, 'principal'),
      ),
    )
    .limit(1);
  if (!principalRole) {
    throw new DemoJobGuardError('The requesting admin is no longer principal of the demo school.');
  }

  const user = await db.query.user.findFirst({
    where: (table, { eq: equals }) => equals(table.id, requestedBy),
  });
  if (!user) throw new DemoJobGuardError('The requesting admin no longer exists.');
  if (user.banned && (!user.banExpires || user.banExpires > new Date())) {
    throw new DemoJobGuardError('The requesting admin is banned.');
  }

  const now = new Date();
  const session = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      setupStatus: user.setupStatus,
      profileImageS3Key: user.profileImageS3Key,
    },
    // Step-scoped and never persisted; the id names the job for log correlation.
    session: {
      id: `system-job:${jobId}`,
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
  } as NonNullable<Context['session']>;

  return {
    db,
    headers: new Headers(),
    session,
    principal: { authMethod: 'system-job', jobId },
  };
}
