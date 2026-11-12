import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import {
  examQuestionPaperJobTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { ORPCError } from '@orpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import type { PaperKey, pageDtoSchema, versionSummarySchema } from './question-paper.dto';

/** Row types, named once. */
export type PaperRow = typeof examQuestionPaperTable.$inferSelect;
export type PageRow = typeof examQuestionPaperPageTable.$inferSelect;
export type VersionRow = typeof examQuestionPaperVersionTable.$inferSelect;
export type JobRow = typeof examQuestionPaperJobTable.$inferSelect;

/** The unique columns of a paper: the plan's natural key. */
export const paperKeyWhere = (key: PaperKey) =>
  and(
    eq(examQuestionPaperTable.schoolId, key.schoolId),
    eq(examQuestionPaperTable.sessionId, key.sessionId),
    eq(examQuestionPaperTable.examSlug, key.examSlug),
    eq(examQuestionPaperTable.classId, key.classId),
    eq(examQuestionPaperTable.subjectSlug, key.subjectSlug),
    eq(examQuestionPaperTable.modeSlug, key.modeSlug),
  );

/** The paper of a key, or undefined when nothing was uploaded or saved yet. */
export async function findPaper(db: DatabaseExecutor, key: PaperKey): Promise<PaperRow | undefined> {
  const [paper] = await db.select().from(examQuestionPaperTable).where(paperKeyWhere(key)).limit(1);
  return paper;
}

/**
 * Locks the paper's row for the rest of the transaction, creating the row
 * first when it does not exist (the first upload or the first agent save).
 * Every change to a paper's pages, jobs and versions happens under this lock,
 * which is what makes page caps, revisions and version numbers exact.
 */
export async function lockOrCreatePaper(tx: DatabaseTransaction, key: PaperKey, userId: string): Promise<PaperRow> {
  await tx
    .insert(examQuestionPaperTable)
    .values({ ...key, createdBy: userId })
    .onConflictDoNothing({
      target: [
        examQuestionPaperTable.sessionId,
        examQuestionPaperTable.examSlug,
        examQuestionPaperTable.classId,
        examQuestionPaperTable.subjectSlug,
        examQuestionPaperTable.modeSlug,
      ],
    });
  const [paper] = await tx.select().from(examQuestionPaperTable).where(paperKeyWhere(key)).for('update');
  if (!paper) throw rpcError.notFound('Question paper');
  return paper;
}

/** Locks an existing paper's row, or NOT_FOUND. */
export async function lockPaper(tx: DatabaseTransaction, key: PaperKey): Promise<PaperRow> {
  const [paper] = await tx.select().from(examQuestionPaperTable).where(paperKeyWhere(key)).for('update');
  if (!paper) throw rpcError.notFound('Question paper');
  return paper;
}

export const pagesOf = (db: DatabaseExecutor, paperId: string) =>
  db
    .select()
    .from(examQuestionPaperPageTable)
    .where(eq(examQuestionPaperPageTable.paperId, paperId))
    .orderBy(asc(examQuestionPaperPageTable.position), asc(examQuestionPaperPageTable.id));

export function toPageDto(page: PageRow): z.infer<typeof pageDtoSchema> {
  return {
    id: page.id,
    position: page.position,
    originalName: page.originalName,
    contentType: page.contentType,
    byteSize: page.byteSize,
    sha256: page.sha256,
    width: page.width,
    height: page.height,
    derivativeStatus: page.derivativeStatus,
  };
}

/** The paper's in-flight job (queued or running); at most one exists (partial unique index). */
export async function activeJobOf(db: DatabaseExecutor, paperId: string): Promise<JobRow | undefined> {
  const [job] = await db
    .select()
    .from(examQuestionPaperJobTable)
    .where(and(eq(examQuestionPaperJobTable.paperId, paperId), inArray(examQuestionPaperJobTable.status, ['queued', 'running'])))
    .limit(1);
  return job;
}

/** The paper's most recent job that ended, with its outcome. */
export async function lastFinishedJobOf(db: DatabaseExecutor, paperId: string): Promise<JobRow | undefined> {
  const [job] = await db
    .select()
    .from(examQuestionPaperJobTable)
    .where(and(eq(examQuestionPaperJobTable.paperId, paperId), inArray(examQuestionPaperJobTable.status, ['succeeded', 'failed'])))
    .orderBy(desc(examQuestionPaperJobTable.completedAt), desc(examQuestionPaperJobTable.id))
    .limit(1);
  return job;
}

/** Refuses a change while a generation reads or will write this paper. */
export async function assertNoActiveJob(db: DatabaseExecutor, paperId: string, what: string) {
  if (await activeJobOf(db, paperId)) {
    throw rpcError.conflict(`${what} while the AI is generating this paper. Wait for it to finish.`);
  }
}

type SummaryRow = Pick<
  VersionRow,
  'versionNo' | 'source' | 'createdAt' | 'createdBy' | 'planMaxMarks' | 'warnings' | 'pdfArtifactId' | 'sourceJobId'
>;

/** Names of the users who created versions (none for a deleted account). */
async function userNames(db: DatabaseExecutor, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function toVersionSummaries(
  db: DatabaseExecutor,
  rows: SummaryRow[],
  latestVersionNo: number,
): Promise<Array<z.infer<typeof versionSummarySchema>>> {
  const names = await userNames(db, rows.map((row) => row.createdBy));
  return rows.map((row) => ({
    versionNo: row.versionNo,
    source: row.source,
    sourceJobId: row.sourceJobId,
    createdAt: row.createdAt,
    createdBy: { id: row.createdBy, name: names.get(row.createdBy) ?? null },
    planMaxMarks: row.planMaxMarks,
    warningCount: row.warnings.length,
    hasPdf: row.pdfArtifactId !== null,
    isLatest: row.versionNo === latestVersionNo,
  }));
}

/** Versions, newest first. */
export const versionsOf = (db: DatabaseExecutor, paperId: string, limit = 100) =>
  db
    .select()
    .from(examQuestionPaperVersionTable)
    .where(eq(examQuestionPaperVersionTable.paperId, paperId))
    .orderBy(desc(examQuestionPaperVersionTable.versionNo))
    .limit(limit);

/** The error for "the school has not chosen a question paper template" (D17: there is no default design). */
export function templateMissingError() {
  return new ORPCError('PRECONDITION_FAILED', {
    message: 'Choose a question paper template in the school settings before generating papers.',
    data: { reason: 'QUESTION_PAPER_TEMPLATE_MISSING' },
  });
}

/** The error for "no AI model is configured in this deployment". */
export function providerUnavailableError() {
  return new ORPCError('PRECONDITION_FAILED', {
    message: 'AI generation is not available right now.',
    data: { reason: 'provider_unavailable' },
  });
}
