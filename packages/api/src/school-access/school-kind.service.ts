import type { DatabaseExecutor } from '@campuspilot/db';
import { DEFAULT_SCHOOL_KINDS, type SchoolKind } from '@campuspilot/db/school-kind';
import { resolveSchoolPlan } from '@campuspilot/db/feature-flags/catalogue';
import { joinActiveBillingPeriod } from '@campuspilot/db/feature-flags/store';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { ORPCError } from '@orpc/server';
import { and, eq, sql } from 'drizzle-orm';

import type { Context } from '../context';
import { rpcError } from '../errors';
import {
  SCHOOL_KIND_UNSUPPORTED_MESSAGES,
  SCHOOL_KIND_UNSUPPORTED_REASON,
  type SchoolKindUnsupportedData,
} from './school-access.contract';
import { resolveSchoolWriteRefusal, schoolWriteRefusedError, type SchoolWriteFacts } from './school-access.service';

/**
 * The school kind gate (docs/personal-space.md). Every procedure says which
 * kinds of school it serves (`schoolKinds` in its metadata; without it, real
 * schools only, so a new procedure fails closed for personal spaces), and
 * `requireAuth` refuses a call whose input names a school of any other kind,
 * reads included: a personal space has no sessions, classes or staff to read,
 * and a real school has no standalone papers. Upload routes outside oRPC call
 * {@link assertSchoolKindServedByCaller} with the kinds they serve.
 *
 * Unlike the read-only gate it holds everyone, not only members: a platform
 * administrator's grants must not let a real-school procedure write into a
 * personal space either. It must still tell an outsider nothing, so a member
 * is told why (`SCHOOL_KIND_UNSUPPORTED` with the school's kind) and anyone
 * else gets the plain FORBIDDEN a permission denial gives. A school that does
 * not exist is not held here; the procedure's own lookup answers it.
 * Platform administration (`systemAdmin.*`) is not held: it acts on a school
 * from outside it (the admin app renews a personal space's trial).
 */

/** The kinds an upload route of real-school data serves (admissions, the logo, exam question papers). */
export const REAL_SCHOOLS_ONLY: readonly SchoolKind[] = DEFAULT_SCHOOL_KINDS;

/** The kinds an upload route of personal space data serves (standalone question papers). */
export const PERSONAL_SPACES_ONLY: readonly SchoolKind[] = ['personal'];

/** The kinds a procedure serves: its own `schoolKinds`, or real schools only when it declares none. */
export function servedSchoolKinds(declared: readonly SchoolKind[] | undefined): readonly SchoolKind[] {
  return declared ?? DEFAULT_SCHOOL_KINDS;
}

/** The FORBIDDEN error for a member whose school's kind the procedure does not serve. */
export function schoolKindUnsupportedError(schoolKind: SchoolKind) {
  return new ORPCError('FORBIDDEN', {
    message: SCHOOL_KIND_UNSUPPORTED_MESSAGES[schoolKind],
    data: { reason: SCHOOL_KIND_UNSUPPORTED_REASON, schoolKind } satisfies SchoolKindUnsupportedData,
  });
}

/** The school's kind and whether `userId` is a member of it, in one query; null when the school does not exist. */
export async function readSchoolKindFacts(
  db: DatabaseExecutor,
  schoolId: string,
  userId: string,
): Promise<{ kind: SchoolKind; member: boolean } | null> {
  const [row] = await db
    .select({
      kind: schoolTable.kind,
      member: sql<boolean>`exists (select 1 from ${schoolMemberTable} where ${and(eq(schoolMemberTable.schoolId, schoolTable.id), eq(schoolMemberTable.userId, userId))})`,
    })
    .from(schoolTable)
    .where(eq(schoolTable.id, schoolId))
    .limit(1);
  return row ? { kind: row.kind, member: row.member === true } : null;
}

/** The school's kind, or null when it does not exist. */
export async function readSchoolKind(db: DatabaseExecutor, schoolId: string): Promise<SchoolKind | null> {
  const [row] = await db.select({ kind: schoolTable.kind }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  return row?.kind ?? null;
}

/**
 * Refuses the call when the school `schoolId` names is of a kind not in
 * `served`. See the file comment for who is told what.
 */
export async function assertSchoolKindServedByCaller(
  context: Pick<Context, 'db' | 'session'>,
  schoolId: string,
  served: readonly SchoolKind[],
): Promise<void> {
  const userId = context.session?.user.id;
  if (!userId) return;
  const facts = await readSchoolKindFacts(context.db, schoolId, userId);
  if (!facts || served.includes(facts.kind)) return;
  if (facts.member) throw schoolKindUnsupportedError(facts.kind);
  throw rpcError.forbidden();
}

/**
 * The kinds of the schools a user belongs to, for the MCP listing: a tool
 * that serves none of them could only ever be refused, so it is not listed
 * (a user whose only school is a personal space sees only its tools).
 */
export async function schoolKindsOfUser(db: DatabaseExecutor, userId: string): Promise<ReadonlySet<SchoolKind>> {
  const rows = await db
    .selectDistinct({ kind: schoolTable.kind })
    .from(schoolMemberTable)
    .innerJoin(schoolTable, eq(schoolTable.id, schoolMemberTable.schoolId))
    .where(eq(schoolMemberTable.userId, userId));
  return new Set(rows.map((row) => row.kind));
}

/**
 * Everything the two school gates of `requireAuth` decide from, in one query:
 * the school's kind, whether the caller is a member, and the two facts that
 * make it read-only (`school-access.service.ts`). Null when the school does
 * not exist.
 */
export async function readSchoolGateFacts(
  db: DatabaseExecutor,
  schoolId: string,
  userId: string,
): Promise<({ kind: SchoolKind; member: boolean } & SchoolWriteFacts) | null> {
  const [row] = await db
    .select({
      kind: schoolTable.kind,
      member: sql<boolean>`exists (select 1 from ${schoolMemberTable} where ${and(eq(schoolMemberTable.schoolId, schoolTable.id), eq(schoolMemberTable.userId, userId))})`,
      suspendedAt: schoolTable.suspendedAt,
      subscribedTier: schoolTable.tier,
      periodTier: schoolBillingPeriodTable.tier,
      periodKind: schoolBillingPeriodTable.kind,
    })
    .from(schoolTable)
    .leftJoin(schoolBillingPeriodTable, joinActiveBillingPeriod())
    .where(eq(schoolTable.id, schoolId))
    .limit(1);
  if (!row) return null;
  const plan = resolveSchoolPlan({
    subscribedTier: row.subscribedTier,
    activePeriod: row.periodTier === null || row.periodKind === null ? null : { tier: row.periodTier, kind: row.periodKind },
  });
  return { kind: row.kind, member: row.member === true, suspended: row.suspendedAt !== null, hasActivePlan: plan.tier !== null };
}

/**
 * Both school gates of a procedure for the school its input names, from one
 * read ({@link readSchoolGateFacts}), in their order: the school kind gate
 * (everyone, reads included; a member is told why), then, for a procedure that
 * is not a read, the read-only gate (members only, as in
 * `assertSchoolWritableByCaller`). A school that does not exist is left to
 * the procedure.
 */
export async function assertSchoolGatesByCaller(
  context: Pick<Context, 'db' | 'session'>,
  schoolId: string,
  gates: { served: readonly SchoolKind[]; write: boolean },
): Promise<void> {
  const userId = context.session?.user.id;
  if (!userId) return;
  const facts = await readSchoolGateFacts(context.db, schoolId, userId);
  if (!facts) return;
  if (!gates.served.includes(facts.kind)) {
    if (facts.member) throw schoolKindUnsupportedError(facts.kind);
    throw rpcError.forbidden();
  }
  if (!gates.write || !facts.member) return;
  const refusal = resolveSchoolWriteRefusal(facts);
  if (refusal) throw schoolWriteRefusedError(refusal);
}
