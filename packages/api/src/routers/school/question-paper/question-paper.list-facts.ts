import type { DatabaseExecutor } from '@campuspilot/db';
import {
  examQuestionPaperJobTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** What a paper list row shows about a paper's activity, read for one page of papers at once. */
export type PaperListFacts = {
  pageCount: number;
  /** Notices of the latest version. */
  warningCount: number;
  activeJob: { id: string; status: 'queued' | 'running' } | null;
  /** The last generation's failure, until a version is saved after it. */
  lastJobFailure: { errorCode: string; message: string } | null;
};

const NO_FACTS: PaperListFacts = { pageCount: 0, warningCount: 0, activeJob: null, lastJobFailure: null };

/**
 * The activity facts of a page of listed papers (`listStandalonePapers`,
 * `listSchoolQuestionPapers`), in four queries whatever the page size: page
 * counts, the latest version's notices, the running generation, and the last
 * generation's failure. A failure is news only until a version is saved after
 * it, as on an exam paper's screen.
 */
export async function paperListFactsOf(db: DatabaseExecutor, paperIds: readonly string[]): Promise<(paperId: string) => PaperListFacts> {
  if (paperIds.length === 0) return () => NO_FACTS;
  const ids = [...paperIds];
  const [pageCounts, latestVersions, activeJobs, lastJobs] = await Promise.all([
    db
      .select({ paperId: examQuestionPaperPageTable.paperId, count: sql<number>`count(*)::int` })
      .from(examQuestionPaperPageTable)
      .where(inArray(examQuestionPaperPageTable.paperId, ids))
      .groupBy(examQuestionPaperPageTable.paperId),
    db
      .select({ paperId: examQuestionPaperVersionTable.paperId, warnings: examQuestionPaperVersionTable.warnings, createdAt: examQuestionPaperVersionTable.createdAt })
      .from(examQuestionPaperVersionTable)
      .innerJoin(
        examQuestionPaperTable,
        and(eq(examQuestionPaperTable.id, examQuestionPaperVersionTable.paperId), eq(examQuestionPaperTable.latestVersionNo, examQuestionPaperVersionTable.versionNo)),
      )
      .where(inArray(examQuestionPaperVersionTable.paperId, ids)),
    db
      .select({ paperId: examQuestionPaperJobTable.paperId, id: examQuestionPaperJobTable.id, status: examQuestionPaperJobTable.status })
      .from(examQuestionPaperJobTable)
      .where(and(inArray(examQuestionPaperJobTable.paperId, ids), inArray(examQuestionPaperJobTable.status, ['queued', 'running']))),
    db
      .selectDistinctOn([examQuestionPaperJobTable.paperId], {
        paperId: examQuestionPaperJobTable.paperId,
        status: examQuestionPaperJobTable.status,
        errorCode: examQuestionPaperJobTable.errorCode,
        errorMessage: examQuestionPaperJobTable.errorMessage,
        completedAt: examQuestionPaperJobTable.completedAt,
      })
      .from(examQuestionPaperJobTable)
      .where(inArray(examQuestionPaperJobTable.paperId, ids))
      .orderBy(examQuestionPaperJobTable.paperId, sql`${examQuestionPaperJobTable.createdAt} desc`, sql`${examQuestionPaperJobTable.id} desc`),
  ]);
  const pageCountOf = new Map(pageCounts.map((row) => [row.paperId, row.count]));
  const latestOf = new Map(latestVersions.map((row) => [row.paperId, row]));
  const activeOf = new Map(activeJobs.map((row) => [row.paperId, row]));
  const lastOf = new Map(lastJobs.map((row) => [row.paperId, row]));
  return (paperId) => {
    const latest = latestOf.get(paperId);
    const active = activeOf.get(paperId);
    const last = lastOf.get(paperId);
    return {
      pageCount: pageCountOf.get(paperId) ?? 0,
      warningCount: latest?.warnings.length ?? 0,
      activeJob: active ? { id: active.id, status: active.status as 'queued' | 'running' } : null,
      lastJobFailure:
        last?.status === 'failed' && last.errorCode && !(latest && last.completedAt && latest.createdAt >= last.completedAt)
          ? { errorCode: last.errorCode, message: last.errorMessage ?? 'AI generation failed.' }
          : null,
    };
  };
}
