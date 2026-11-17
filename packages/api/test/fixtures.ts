import { db } from '@campuspilot/db';
import type {
  SchoolFeatureConfigInput,
  SchoolFeatureEntry,
  SchoolFeatureKey,
  SchoolTier,
} from '@campuspilot/db/feature-flags/catalogue';
import { readSchoolFeatureConfig } from '@campuspilot/db/feature-flags/store';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { studentTable } from '@campuspilot/db/schema/student';
import { user } from '@campuspilot/db/schema/auth';
import { classTable, sectionTable } from '@campuspilot/db/schema/class';
import { examClassTable } from '@campuspilot/db/schema/exam';
import type { Role, RoleMeta } from '@campuspilot/db/schema/jsonb/role';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolTrialTable } from '@campuspilot/db/schema/school-trial';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { eq, max } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Client } from '@orpc/client';
import { createRouterClient } from '@orpc/server';

import type { Context } from '../src/context';
import { setSchoolFeature } from '../src/feature-flags/feature-flags.service';
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
    emailIsPlaceholder: value.emailIsPlaceholder,
    phoneNumber: value.phoneNumber,
    phoneNumberVerified: value.phoneNumberVerified,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    setupStatus: value.setupStatus as Record<string, unknown> | null,
    banned: value.banned,
    banReason: value.banReason,
    banExpires: value.banExpires,
  };
}

/**
 * Context for direct HTTP handler tests (uploads, downloads): authenticated by
 * a browser session when one is given, anonymous otherwise.
 */
export function createHandlerContext(
  session: Context['session'],
  headers: Headers = new Headers(),
): Context {
  return {
    db,
    headers,
    session,
    principal: session ? { authMethod: 'session' } : { authMethod: 'anonymous' },
  };
}

/** The value a JSON client (MCP, OpenAPI, curl) receives for an output. */
export type JsonWire<T> = T extends Date
  ? string
  : T extends readonly (infer Item)[]
    ? JsonWire<Item>[]
    : T extends object
      ? { [Key in keyof T]: JsonWire<T[Key]> }
      : T;

/** A router client whose outputs are typed as they arrive over a JSON wire. */
export type JsonWireRouterClient<T> =
  T extends Client<infer ClientContext, infer Input, infer Output, infer Error>
    ? Client<ClientContext, Input, JsonWire<Output>, Error>
    : { [Key in keyof T]: JsonWireRouterClient<T[Key]> };

/** The client type every integration suite uses; see {@link createTestClient}. */
export type TestClient = JsonWireRouterClient<AppRouterClient>;

/**
 * Sends a value through the same JSON encoding an MCP, OpenAPI or curl client
 * uses. `Date`, `undefined` members, class instances and `bigint` therefore
 * behave in tests exactly as they would for a real JSON caller.
 */
function jsonRoundTrip<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Creates a typed oRPC client bound to an optional user session and database
 * executor. Inputs and outputs cross a JSON round trip, so integration suites
 * exercise the contract a JSON client can actually send and receive rather
 * than in-process JavaScript values.
 */
export function createTestClient(
  session: Context['session'] = null,
  headers: Headers = new Headers(),
): TestClient {
  const client: AppRouterClient = createRouterClient(appRouter, {
    context: async () => createHandlerContext(session, headers),
    interceptors: [
      async ({ next, ...options }) =>
        jsonRoundTrip(
          await next({ ...options, input: jsonRoundTrip(options.input) }),
        ),
    ],
  });
  // The interceptor changes only the runtime encoding the types describe.
  return client as unknown as TestClient;
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
 * The features of a test school created without a `tier`: student
 * management and WhatsApp notifications, and nothing else. No tier is
 * exactly that, so such a school is stored as a Plus school with these two
 * switched on for it (adjustments, written like an administrator's). It is
 * the smallest school most suites need: students exist and their guardians
 * can be messaged, while the Cadet Portal, notices and the assistant stay
 * off until a suite names them.
 */
const TEST_SCHOOL_BASELINE_FEATURES = ['studentManagement', 'whatsapp'] as const satisfies readonly SchoolFeatureKey[];

/**
 * Inserts a test school directly into the database.
 *
 * Without `tier` it has the baseline features
 * ({@link TEST_SCHOOL_BASELINE_FEATURES}) and no other; a suite that
 * exercises a feature-gated area names it in `features` (for example
 * `features: ['cadet']` for anything touching the Cadet Portal), so the
 * feature gate is exercised for real instead of being bypassed.
 *
 * With `tier` it is a school of exactly that tier, with no adjustment but
 * the ones named in `features`: what a suite about tiers needs.
 */
export async function createTestSchool(overrides: {
  id?: string;
  name?: string;
  slug?: string;
  location?: string;
  registrationNo?: string | null;
  logoS3Key?: string | null;
  hasCompletedOnboarding?: boolean;
  /** Fixed at insert: a database trigger makes `is_demo` immutable afterwards. */
  isDemo?: boolean;
  /**
   * The school's subscription tier (null: none), with no baseline
   * adjustments. Omit it for the baseline school described above.
   */
  tier?: SchoolTier | null;
  /**
   * Platform features to switch on for the school on top of that (default:
   * none): a key for a feature without settings, or `{ feature, config }`
   * for one with settings (enabling such a feature needs them).
   */
  features?: readonly (SchoolFeatureKey | TestSchoolFeature)[];
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
      isDemo: overrides.isDemo ?? false,
      tier: overrides.tier === undefined ? 'plus' : overrides.tier,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (overrides.tier === undefined) {
    for (const feature of TEST_SCHOOL_BASELINE_FEATURES) await setTestSchoolFeature(id, feature, true);
  }
  for (const feature of overrides.features ?? []) {
    if (typeof feature === 'string') await setTestSchoolFeature(id, feature, true);
    else await setTestSchoolFeature(id, feature.feature, true, feature.config as never);
  }

  return school!;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Inserts a trial for a test school directly, as the admin procedures store
 * one. By default it started a day ago and ends in 30 days, so it is active;
 * pass an `endsAt` in the past (and an earlier `startsAt`) for a trial that
 * has run out, or `endedAt` for one an administrator ended early. Time is
 * never waited for: a trial's state follows from these timestamps alone.
 */
export async function createTestSchoolTrial(options: {
  schoolId: string;
  tier: SchoolTier;
  startsAt?: Date;
  endsAt?: Date;
  endedAt?: Date | null;
}) {
  const startsAt = options.startsAt ?? new Date(Date.now() - DAY_MS);
  const [trial] = await db
    .insert(schoolTrialTable)
    .values({
      schoolId: options.schoolId,
      tier: options.tier,
      startsAt,
      endsAt: options.endsAt ?? new Date(Date.now() + 30 * DAY_MS),
      endedAt: options.endedAt ?? null,
    })
    .returning();
  return trial!;
}

/** A feature with its settings, for `createTestSchool({ features })`. */
export type TestSchoolFeature = {
  [K in SchoolFeatureKey]: { feature: K; config: SchoolFeatureConfigInput<K> };
}[SchoolFeatureKey];

/**
 * Switches one platform feature on or off for a test school, writing the
 * same adjustment an administrator's change writes (`setSchoolFeature`);
 * null returns the feature to the school's tier. Use it to flip a feature
 * mid-test, for example to prove that disabling the Cadet Portal stops an
 * existing session.
 *
 * `config` sets the feature's settings; when it is omitted the stored
 * settings are kept (as an administrator's switch keeps them), so disabling
 * and enabling again never wipes them.
 */
export async function setTestSchoolFeature<K extends SchoolFeatureKey>(
  schoolId: string,
  feature: K,
  enabled: boolean | null,
  config?: SchoolFeatureConfigInput<K> | null,
) {
  const stored = config === undefined ? await readSchoolFeatureConfig(db, schoolId, feature) : null;
  const kept = config !== undefined ? config : stored?.status === 'valid' ? stored.config : null;
  await setSchoolFeature(db, { schoolId, feature, enabled, config: kept, updatedBy: null } as SchoolFeatureEntry & {
    schoolId: string;
    updatedBy: null;
  });
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

/**
 * Inserts a test class with at least one section while preserving the same
 * invariant as the public createClass procedure.
 */
export async function createTestClass(overrides: {
  id?: string;
  schoolId: string;
  slug?: string;
  label?: string;
  sections?: Array<{
    id?: string;
    slug?: string;
    label?: string;
    attributes?: Record<string, unknown>;
  }>;
}) {
  return db.transaction(async (transaction) => {
    const slug = overrides.slug ?? `class-${randomUUID().toLowerCase()}`;
    const [lastClass] = await transaction
      .select({ displayOrder: max(classTable.displayOrder) })
      .from(classTable)
      .where(eq(classTable.schoolId, overrides.schoolId));
    const [schoolClass] = await transaction
      .insert(classTable)
      .values({
        id: overrides.id ?? randomUUID(),
        schoolId: overrides.schoolId,
        slug,
        label: overrides.label ?? `Test Class ${slug}`,
        displayOrder: (lastClass?.displayOrder ?? 0) + 1,
      })
      .returning();

    const sectionValues = overrides.sections ?? [
      { slug: 'a', label: 'Section A' },
    ];
    const sections = await transaction
      .insert(sectionTable)
      .values(
        sectionValues.map((section, sectionIndex) => ({
          id: section.id ?? randomUUID(),
          schoolId: overrides.schoolId,
          classId: schoolClass!.id,
          slug: section.slug ?? `section-${randomUUID().toLowerCase()}`,
          label: section.label ?? 'Test Section',
          displayOrder: sectionIndex + 1,
          attributes: section.attributes,
        })),
      )
      .returning();

    return { schoolClass: schoolClass!, sections };
  });
}

/** Inserts an admission directly for router tests which do not exercise creation. */
export async function createTestAdmission(overrides: {
  id?: string;
  schoolId: string;
  name?: string;
  admissionNo?: string;
  admissionClassId?: string | null;
  registered?: boolean;
}) {
  const [admission] = await db
    .insert(admissionTable)
    .values({
      id: overrides.id ?? randomUUID(),
      schoolId: overrides.schoolId,
      name: overrides.name ?? 'Test Student',
      admissionNo: overrides.admissionNo ?? `ADM-${randomUUID()}`,
      admissionClassId: overrides.admissionClassId ?? null,
      address: 'Test address',
      phoneNo: '9999999999',
      email: null,
      dob: '2015-01-01',
      fatherName: 'Test Father',
      motherName: 'Test Mother',
      registered: overrides.registered ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return admission!;
}

/** Inserts one explicitly session-scoped student enrollment. */
export async function createTestStudent(overrides: {
  id?: string;
  schoolId: string;
  admissionId: string;
  sessionId: string;
  classId?: string | null;
  sectionId?: string | null;
  rollNo?: number | null;
}) {
  const [student] = await db
    .insert(studentTable)
    .values({
      id: overrides.id ?? randomUUID(),
      schoolId: overrides.schoolId,
      admissionId: overrides.admissionId,
      sessionId: overrides.sessionId,
      classId: overrides.classId ?? null,
      sectionId: overrides.sectionId ?? null,
      rollNo: overrides.rollNo ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return student!;
}

/**
 * Records that classes take part in examinations (`exam_class`), for tests
 * that insert subject plans directly: every plan references its class's row.
 * Already recorded classes are left as they are.
 */
export async function includeTestExamClasses(
  rows: Array<{ schoolId: string; sessionId: string; examSlug: string; classId: string }>,
) {
  if (!rows.length) return;
  await db
    .insert(examClassTable)
    .values(rows.map(({ schoolId, sessionId, examSlug, classId }) => ({ schoolId, sessionId, examSlug, classId })))
    .onConflictDoNothing();
}
