import type { DatabaseExecutor } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperPageTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { ORPCError } from '@orpc/server';
import { and, eq, ne, sql } from 'drizzle-orm';

import { readSchoolKind } from '../school-access/school-kind.service';
import {
  PERSONAL_SPACE_LIMIT_MESSAGES,
  PERSONAL_SPACE_LIMIT_REASONS,
  PERSONAL_SPACE_STORAGE_QUOTA_BYTES,
  STANDALONE_PAPER_MAX_VERSIONS,
  STANDALONE_SAVE_WINDOW_MS,
  STANDALONE_SAVES_PER_WINDOW,
  type PersonalSpaceLimit,
} from './personal-space.limits';

/**
 * The checks of a personal space's limits (`personal-space.limits.ts`,
 * docs/personal-space.md "Limits").
 *
 * Each check runs twice where bytes or a PDF are about to be made: once as an
 * unlocked early look (`lock: false`) before anything is written or printed,
 * so a refused request costs no storage or render, and once inside the
 * transaction that records the write (`lock: true`), which is the authority.
 * The locked form takes one transaction-scoped advisory lock per school
 * ({@link lockPersonalSpaceLimits}), so two requests of one space are counted
 * one after the other and cannot pass a limit together. It is taken after
 * the paper's row lock (and after the school's job lock where both are
 * taken); nothing takes them in the other order.
 */

/** The refusal of a limit: TOO_MANY_REQUESTS for the save rate (it clears by itself), BAD_REQUEST for the others. */
export function personalSpaceLimitError(limit: PersonalSpaceLimit) {
  return new ORPCError(limit === 'saveRate' ? 'TOO_MANY_REQUESTS' : 'BAD_REQUEST', {
    message: PERSONAL_SPACE_LIMIT_MESSAGES[limit],
    data: { reason: PERSONAL_SPACE_LIMIT_REASONS[limit] },
  });
}

/** The transaction-scoped lock every locked limit check of one school takes. Re-entrant within a transaction. */
async function lockPersonalSpaceLimits(tx: DatabaseExecutor, schoolId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`personal-space-limits:${schoolId}`}, 0))`);
}

/**
 * Every byte the school stores for its question papers, from the size facts
 * of the rows that own the objects: page photos with their thumbnails and
 * model copies (a page still awaiting its photo has no size yet), figure
 * images, and the PDF and the Word file (once one was downloaded) of every
 * version. Nothing is estimated.
 */
export async function personalSpaceStoredBytes(db: DatabaseExecutor, schoolId: string): Promise<number> {
  const page = examQuestionPaperPageTable;
  const figure = examQuestionPaperFigureTable;
  const version = examQuestionPaperVersionTable;
  const result = await db.execute<{ bytes: string }>(sql`
    select (
      coalesce((select sum(coalesce(${page.byteSize}, 0)::bigint + coalesce(${page.thumbByteSize}, 0) + coalesce(${page.modelByteSize}, 0)) from ${page} where ${page.schoolId} = ${schoolId}), 0)
      + coalesce((select sum(${figure.byteSize})::bigint from ${figure} where ${figure.schoolId} = ${schoolId}), 0)
      + coalesce((select sum(${artifactTable.byteSize})::bigint from ${version} join ${artifactTable} on ${artifactTable.id} = ${version.pdfArtifactId} where ${version.schoolId} = ${schoolId}), 0)
      + coalesce((select sum(${artifactTable.byteSize})::bigint from ${version} join ${artifactTable} on ${artifactTable.id} = ${version.docxArtifactId} where ${version.schoolId} = ${schoolId}), 0)
    )::text as bytes
  `);
  return Number(result.rows[0]?.bytes ?? 0);
}

/**
 * Refuses (`storage`) when a personal space has no room for `addedBytes`
 * more: when what it stores plus them would pass
 * {@link PERSONAL_SPACE_STORAGE_QUOTA_BYTES}, or, for a write whose size is
 * not known yet (a page reservation, an early look; `addedBytes` 0), when it
 * is already full. Any other kind of school has no storage quota: nothing is
 * read or locked. The kind is the school's own fact (`readSchoolKind`), not
 * the paper's.
 */
export async function assertPersonalSpaceStorageRoom(
  db: DatabaseExecutor,
  input: { schoolId: string; addedBytes: number; lock: boolean },
): Promise<void> {
  if ((await readSchoolKind(db, input.schoolId)) !== 'personal') return;
  if (input.lock) await lockPersonalSpaceLimits(db, input.schoolId);
  const stored = await personalSpaceStoredBytes(db, input.schoolId);
  if (stored >= PERSONAL_SPACE_STORAGE_QUOTA_BYTES || stored + input.addedBytes > PERSONAL_SPACE_STORAGE_QUOTA_BYTES) {
    throw personalSpaceLimitError('storage');
  }
}

/**
 * Refuses another version of a standalone paper: `versions` when the paper
 * already has {@link STANDALONE_PAPER_MAX_VERSIONS}, and, for a save that
 * counts toward the rate (`countsTowardRate`: every save but the AI job's,
 * which is bounded by its own running-job cap and the AI limit, and whose
 * refusal would waste a paid generation), `saveRate` when the school saved
 * {@link STANDALONE_SAVES_PER_WINDOW} versions of standalone papers in the
 * last {@link STANDALONE_SAVE_WINDOW_MS}. Both count stored version rows.
 */
export async function assertStandaloneVersionRoom(
  db: DatabaseExecutor,
  input: { schoolId: string; paperId: string | null; countsTowardRate: boolean; lock: boolean },
): Promise<void> {
  const version = examQuestionPaperVersionTable;
  if (input.lock) await lockPersonalSpaceLimits(db, input.schoolId);
  if (input.paperId !== null) {
    const [held] = await db.select({ count: sql<number>`count(*)::int` }).from(version).where(eq(version.paperId, input.paperId));
    if ((held?.count ?? 0) >= STANDALONE_PAPER_MAX_VERSIONS) throw personalSpaceLimitError('versions');
  }
  if (!input.countsTowardRate) return;
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(version)
    .where(
      and(
        eq(version.schoolId, input.schoolId),
        eq(version.paperKind, 'standalone'),
        ne(version.source, 'ai_job'),
        sql`${version.createdAt} > clock_timestamp() - make_interval(secs => ${STANDALONE_SAVE_WINDOW_MS / 1000})`,
      ),
    );
  if ((recent?.count ?? 0) >= STANDALONE_SAVES_PER_WINDOW) throw personalSpaceLimitError('saveRate');
}
