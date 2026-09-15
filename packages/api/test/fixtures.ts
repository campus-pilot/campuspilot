import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import type { Role, RoleMeta } from '@campuspilot/db/schema/jsonb/role';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createRouterClient } from '@orpc/server';

import type { Context } from '../src/context';
import { appRouter, type AppRouterClient } from '../src/routers/index';

export type UserSession = NonNullable<Context['session']>;

/** Maps the database JSON field to Better Auth's narrower session-user shape. */
function toSessionUser(
  value: typeof user.$inferSelect,
  role: string,
): UserSession['user'] {
  return {
    id: value.id,
    name: value.name,
    email: value.email,
    image: value.image,
    role,
    emailVerified: value.emailVerified,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    setupStatus: value.setupStatus as Record<string, unknown> | null,
    banned: value.banned,
    banReason: value.banReason,
    banExpires: value.banExpires,
  };
}

/**
 * Creates a typed oRPC client bound to an optional user session and database executor.
 */
export function createTestClient(
  session: Context['session'] = null,
  headers: Headers = new Headers(),
): AppRouterClient {
  return createRouterClient(appRouter, {
    context: async () => ({
      db,
      headers,
      session,
    }),
  });
}

/**
 * Inserts a test user directly into the database or returns existing by email.
 */
export async function createTestUser(overrides: {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
} = {}) {
  const id = overrides.id ?? randomUUID();
  const name = overrides.name ?? 'Test User';
  const email = overrides.email ?? `user_${randomUUID().toLowerCase()}@example.com`;
  const role = overrides.role ?? 'user';

  const [existing] = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(user)
    .values({
      id,
      name,
      email,
      role,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: user.email,
      set: { role, updatedAt: new Date() },
    })
    .returning();

  return created!;
}

/**
 * Creates an authenticated session for a platform administrator.
 */
export async function createAdminSession(): Promise<UserSession> {
  const adminUser = await createTestUser({
    name: 'Admin User',
    email: 'admin@campuspilot.test',
    role: 'admin',
  });

  return {
    user: toSessionUser(adminUser, 'admin'),
    session: {
      id: randomUUID(),
      userId: adminUser.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

/**
 * Creates an authenticated session for a regular user without school roles.
 */
export async function createRegularUserSession(): Promise<UserSession> {
  const regularUser = await createTestUser({
    name: 'Regular User',
    role: 'user',
  });

  return {
    user: toSessionUser(regularUser, 'user'),
    session: {
      id: randomUUID(),
      userId: regularUser.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

/**
 * Inserts a test school directly into the database.
 */
export async function createTestSchool(overrides: {
  id?: string;
  name?: string;
  slug?: string;
  location?: string;
  registrationNo?: string | null;
  logoS3Key?: string | null;
  hasCompletedOnboarding?: boolean;
} = {}) {
  const id = overrides.id ?? randomUUID();
  const slug = overrides.slug ?? `school-${randomUUID().toLowerCase()}`;
  const name = overrides.name ?? `Test School ${slug}`;
  const location = overrides.location ?? 'Test City';

  const [school] = await db
    .insert(schoolTable)
    .values({
      id,
      name,
      slug,
      location,
      registrationNo: overrides.registrationNo ?? null,
      logoS3Key: overrides.logoS3Key ?? null,
      hasCompletedOnboarding: overrides.hasCompletedOnboarding ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return school!;
}

/**
 * Inserts a test school member and role assignments into the database.
 */
export async function createTestSchoolMember(options: {
  schoolId: string;
  userId: string;
  roles: Array<{ role: Role; meta?: RoleMeta | null }>;
}) {
  await db.insert(schoolMemberTable).values({
    schoolId: options.schoolId,
    userId: options.userId,
    addedAt: new Date(),
  });

  if (options.roles.length > 0) {
    await db.insert(schoolUserRoleTable).values(
      options.roles.map(({ role, meta }) => ({
        schoolId: options.schoolId,
        userId: options.userId,
        role,
        meta: meta ?? null,
      })),
    );
  }
}

/**
 * Creates an authenticated session for a user with specific school roles.
 */
export async function createSchoolStaffSession(
  schoolId: string,
  roles: Array<{ role: Role; meta?: RoleMeta | null }>,
): Promise<{ session: UserSession; user: typeof user.$inferSelect }> {
  const staffUser = await createTestUser({ role: 'user' });
  await createTestSchoolMember({
    schoolId,
    userId: staffUser.id,
    roles,
  });

  const session: UserSession = {
    user: toSessionUser(staffUser, 'user'),
    session: {
      id: randomUUID(),
      userId: staffUser.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  return { session, user: staffUser };
}

/**
 * Inserts a test academic session into the database.
 */
export async function createTestSession(overrides: {
  id?: string;
  schoolId: string;
  sessionStartYear: number;
  sessionEndYear: number;
  isActive?: boolean;
}) {
  const [session] = await db
    .insert(schoolSessionTable)
    .values({
      id: overrides.id ?? randomUUID(),
      schoolId: overrides.schoolId,
      sessionStartYear: overrides.sessionStartYear,
      sessionEndYear: overrides.sessionEndYear,
      isActive: overrides.isActive ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return session!;
}
