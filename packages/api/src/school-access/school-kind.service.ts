import type { DatabaseExecutor } from '@campuspilot/db';
import { DEFAULT_SCHOOL_KINDS, SCHOOL_KINDS, type SchoolKind } from '@campuspilot/db/school-kind';
import { getSchoolKind } from '@campuspilot/db/school-kind-store';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../context';
import { rpcError } from '../errors';
import {
  SCHOOL_KIND_UNSUPPORTED_MESSAGES,
  SCHOOL_KIND_UNSUPPORTED_REASON,
  type SchoolKindUnsupportedData,
} from './school-access.contract';
import { assertSchoolWritableByCaller } from './school-access.service';

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

/**
 * The kinds an upload route serves that holds the data of either kind:
 * standalone question papers (a personal space's papers, a real school's quick
 * papers; docs/question-papers.md "Quick papers in a school").
 */
export const EVERY_SCHOOL_KIND: readonly SchoolKind[] = SCHOOL_KINDS;

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

/** How many schools' kinds one process remembers; the oldest is dropped beyond it. */
export const SCHOOL_KIND_CACHE_SIZE = 10_000;

/**
 * The kinds of schools read so far, by school id, least recently used first
 * (a `Map` keeps insertion order). A school's kind is set when its row is
 * created and never changes (`school.kind`, docs/personal-space.md), so a
 * remembered kind is never stale and needs no expiry: the cache is bounded by
 * size only. A school that does not exist is not remembered. A deleted
 * school's entry is harmless: school ids are random and never reused, and the
 * procedure itself finds no school.
 */
const schoolKinds = new Map<string, SchoolKind>();

/** The school's kind, from the process cache or one query; null when the school does not exist. */
export async function readSchoolKind(db: DatabaseExecutor, schoolId: string): Promise<SchoolKind | null> {
  const known = schoolKinds.get(schoolId);
  if (known !== undefined) {
    schoolKinds.delete(schoolId);
    schoolKinds.set(schoolId, known);
    return known;
  }
  const kind = await getSchoolKind(db, schoolId);
  if (kind === null) return null;
  schoolKinds.set(schoolId, kind);
  if (schoolKinds.size > SCHOOL_KIND_CACHE_SIZE) schoolKinds.delete(schoolKinds.keys().next().value!);
  return kind;
}

/** Whether `userId` is a member of the school, for the reason a kind refusal gives. */
async function isSchoolMember(db: DatabaseExecutor, schoolId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ schoolId: schoolMemberTable.schoolId })
    .from(schoolMemberTable)
    .where(and(eq(schoolMemberTable.schoolId, schoolId), eq(schoolMemberTable.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/** The kind refusal: a member is told why, anyone else gets a plain permission denial. */
async function kindRefusal(db: DatabaseExecutor, schoolId: string, userId: string, kind: SchoolKind) {
  return (await isSchoolMember(db, schoolId, userId)) ? schoolKindUnsupportedError(kind) : rpcError.forbidden();
}

/**
 * Refuses the call when the school `schoolId` names is of a kind not in
 * `served`. See the file comment for who is told what. Served: no query but
 * the (cached) kind.
 */
export async function assertSchoolKindServedByCaller(
  context: Pick<Context, 'db' | 'session'>,
  schoolId: string,
  served: readonly SchoolKind[],
): Promise<void> {
  const userId = context.session?.user.id;
  if (!userId) return;
  const kind = await readSchoolKind(context.db, schoolId);
  if (kind === null || served.includes(kind)) return;
  throw await kindRefusal(context.db, schoolId, userId, kind);
}

/**
 * Both school gates of a procedure for the school its input names, in their
 * order: the school kind gate (everyone, reads included; a member is told
 * why), then, for a procedure that is not a read, the read-only gate
 * (`assertSchoolWritableByCaller`: members only, exactly as before kinds
 * existed). The kind comes from the process cache, so a read of a school of a
 * kind the procedure serves runs no gate query; membership is read only to
 * word a kind refusal, and the read-only facts only for a write. A school
 * that does not exist is left to the procedure.
 */
export async function assertSchoolGatesByCaller(
  context: Pick<Context, 'db' | 'session'>,
  schoolId: string,
  gates: { served: readonly SchoolKind[]; write: boolean },
): Promise<void> {
  const userId = context.session?.user.id;
  if (!userId) return;
  const kind = await readSchoolKind(context.db, schoolId);
  if (kind === null) return;
  if (!gates.served.includes(kind)) throw await kindRefusal(context.db, schoolId, userId, kind);
  if (gates.write) await assertSchoolWritableByCaller(context, schoolId);
}

/**
 * The kinds of school by which the MCP listing may narrow a user's tools, or
 * undefined when it must not narrow them. The rule: a listing hides a
 * school-scoped tool only when the user's memberships prove it unusable.
 *
 * - A platform administrator (`user.role = 'admin'`) acts on any school
 *   through platform grants, whatever their memberships: never narrowed.
 * - A user with no membership has no school to prove anything with: never
 *   narrowed (the listing is as it was before school kinds existed; every
 *   school-scoped call is refused by permission anyway).
 * - Anyone else: the kinds of their schools. A tool serving none of them is
 *   one every call of which the kind gate would refuse (a user whose only
 *   school is a personal space sees only its tools).
 */
export async function listingSchoolKindsOf(
  db: DatabaseExecutor,
  user: { id: string; role?: string | null },
): Promise<ReadonlySet<SchoolKind> | undefined> {
  if (user.role === 'admin') return undefined;
  const rows = await db
    .selectDistinct({ kind: schoolTable.kind })
    .from(schoolMemberTable)
    .innerJoin(schoolTable, eq(schoolTable.id, schoolMemberTable.schoolId))
    .where(eq(schoolMemberTable.userId, user.id));
  return rows.length === 0 ? undefined : new Set(rows.map((row) => row.kind));
}
