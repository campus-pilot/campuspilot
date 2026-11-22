import type { DatabaseExecutor } from '@campuspilot/db';
import {
  examQuestionPaperJobTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../../paginations';
import { conversationRefOf, latestPaperConversationId } from '../question-paper/question-paper.conversations';
import {
  activeJobOf,
  findPaperOf,
  lastFinishedJobOf,
  pagesOf,
  toPageDto,
  toVersionSummaries,
  versionsOf,
  type PaperRow,
} from '../question-paper/question-paper.records';
import type { StandalonePaperScope } from '../question-paper/question-paper.scope';
import { STANDALONE_QUESTION_PAPER_PRINTS } from '../question-paper/question-paper.standalone-shell';
import { getVersion } from '../question-paper/question-paper.version.service';
import type {
  getStandalonePaperOutputSchema,
  listStandalonePaperFilterOptionsOutputSchema,
  listStandalonePapersInputSchema,
  listStandalonePapersOutputSchema,
  standalonePaperDetailOutputSchema,
  StandalonePaperDetailsDto,
  standalonePaperFactsSchema,
} from './standalone-paper.dto';

/**
 * Standalone question papers (docs/personal-space.md): the reads that are
 * their own. Everything that changes a paper (pages, generation, versions,
 * delete) is the exam papers' shared service with a standalone scope
 * (`ResolvedPaper`), so both kinds are validated, printed and locked the same
 * way.
 */

/** The details of a paper row, as read back. */
export function detailsOf(paper: Pick<PaperRow, 'detailsSchoolName' | 'detailsClassName' | 'detailsSubjectName' | 'detailsExamName'>): StandalonePaperDetailsDto {
  return {
    schoolName: paper.detailsSchoolName,
    className: paper.detailsClassName,
    subjectName: paper.detailsSubjectName,
    examName: paper.detailsExamName,
  };
}

/** Creates an empty standalone paper in a personal space. The caller has checked the school's kind and the permission. */
export async function createStandalonePaper(db: DatabaseExecutor, input: { schoolId: string; userId: string }): Promise<{ paperId: string }> {
  const [paper] = await db
    .insert(examQuestionPaperTable)
    .values({ schoolId: input.schoolId, kind: 'standalone', createdBy: input.userId })
    .returning({ id: examQuestionPaperTable.id });
  if (!paper) throw rpcError.internal();
  return { paperId: paper.id };
}

/** The row of a resolved standalone paper, or NOT_FOUND (deleted meanwhile). */
async function paperRowOf(db: DatabaseExecutor, scope: StandalonePaperScope): Promise<PaperRow> {
  const paper = await findPaperOf(db, scope);
  if (!paper) throw rpcError.notFound('Question paper');
  return paper;
}

/** The `paper` block of every standalone read. */
async function factsOf(db: DatabaseExecutor, paper: PaperRow): Promise<z.infer<typeof standalonePaperFactsSchema>> {
  const [pages] = await db.select({ count: count() }).from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, paper.id));
  return {
    paperId: paper.id,
    details: detailsOf(paper),
    pageCount: pages?.count ?? 0,
    pageRevision: paper.pageRevision,
    latestVersionNo: paper.latestVersionNo,
  };
}

/** The facts of one standalone paper without its pages and versions (for a draft read). */
export async function getStandalonePaperFacts(db: DatabaseExecutor, scope: StandalonePaperScope) {
  return factsOf(db, await paperRowOf(db, scope));
}

const toJob = (job: { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: Date }) => ({ id: job.id, status: job.status, createdAt: job.createdAt });
const toDetailJob = (job: { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: Date; instructions: string | null }) => ({
  ...toJob(job),
  instructions: job.instructions,
});

/**
 * `getStandalonePaper`: the paper, its pages and one version (the latest
 * unless named), for agents. `templatePrints` is always two empty lists: the
 * plain page prints nothing, so the agent writes the whole heading.
 */
export async function getStandalonePaper(
  db: DatabaseExecutor,
  scope: StandalonePaperScope,
  versionNo: number | undefined,
): Promise<z.infer<typeof getStandalonePaperOutputSchema>> {
  const paper = await paperRowOf(db, scope);
  const [facts, pages, activeJob] = await Promise.all([factsOf(db, paper), pagesOf(db, paper.id), activeJobOf(db, paper.id)]);
  let version: z.infer<typeof getStandalonePaperOutputSchema>['version'] = null;
  if (versionNo !== undefined || paper.latestVersionNo > 0) {
    const row = await getVersion(db, paper.id, versionNo ?? paper.latestVersionNo);
    const [summary] = await toVersionSummaries(db, [row], paper.latestVersionNo);
    version = { ...summary!, warnings: row.warnings, html: row.contentHtml };
  }
  return {
    paper: facts,
    templatePrints: STANDALONE_QUESTION_PAPER_PRINTS,
    pages: pages.map(toPageDto),
    activeJob: activeJob ? toJob(activeJob) : null,
    version,
  };
}

/** `getStandalonePaperDetail`: what the paper's screen needs in one call, polled while a job runs. */
export async function getStandalonePaperDetail(db: DatabaseExecutor, scope: StandalonePaperScope): Promise<z.infer<typeof standalonePaperDetailOutputSchema>> {
  const paper = await paperRowOf(db, scope);
  const [facts, pages, activeJob, finished, versions, latestConversationId] = await Promise.all([
    factsOf(db, paper),
    pagesOf(db, paper.id),
    activeJobOf(db, paper.id),
    lastFinishedJobOf(db, paper.id),
    versionsOf(db, paper.id).then((rows) => toVersionSummaries(db, rows, paper.latestVersionNo)),
    latestPaperConversationId(db, conversationRefOf(scope)),
  ]);
  return {
    paper: facts,
    pages: pages.map(toPageDto),
    activeJob: activeJob ? toDetailJob(activeJob) : null,
    lastFinishedJob:
      finished && finished.completedAt
        ? { ...toDetailJob(finished), errorCode: finished.errorCode, errorMessage: finished.errorMessage, completedAt: finished.completedAt }
        : null,
    versions,
    latestConversationId,
  };
}

/** Escapes `%`, `_` and `\` so a search term matches literally. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/** The four detail columns, in the order the filters and options name them. */
const DETAIL_COLUMNS = {
  schoolName: examQuestionPaperTable.detailsSchoolName,
  className: examQuestionPaperTable.detailsClassName,
  subjectName: examQuestionPaperTable.detailsSubjectName,
  examName: examQuestionPaperTable.detailsExamName,
} as const;

/**
 * `listStandalonePapers`: the school's standalone papers, most recently
 * changed first, matching the search (any detail contains it) and every
 * filter (that detail equals it exactly, as the filter options list them).
 */
export async function listStandalonePapers(
  db: DatabaseExecutor,
  input: z.infer<typeof listStandalonePapersInputSchema>,
): Promise<z.infer<typeof listStandalonePapersOutputSchema>> {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const search = input.searchQuery
    ? or(...Object.values(DETAIL_COLUMNS).map((column) => ilike(column, likePattern(input.searchQuery))))
    : undefined;
  const filters = (Object.keys(DETAIL_COLUMNS) as Array<keyof typeof DETAIL_COLUMNS>)
    .map((key): SQL | undefined => (input.filters[key] === undefined ? undefined : eq(DETAIL_COLUMNS[key], input.filters[key]!)))
    .filter((clause): clause is SQL => clause !== undefined);
  const where = and(eq(examQuestionPaperTable.schoolId, input.schoolId), eq(examQuestionPaperTable.kind, 'standalone'), search, ...filters);
  const [papers, [total]] = await Promise.all([
    db
      .select()
      .from(examQuestionPaperTable)
      .where(where)
      .orderBy(desc(examQuestionPaperTable.updatedAt), desc(examQuestionPaperTable.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(examQuestionPaperTable).where(where),
  ]);
  const totalItems = total?.count ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  const paperIds = papers.map((paper) => paper.id);
  const [pageCounts, latestVersions, activeJobs, lastJobs] = paperIds.length
    ? await Promise.all([
        db
          .select({ paperId: examQuestionPaperPageTable.paperId, count: sql<number>`count(*)::int` })
          .from(examQuestionPaperPageTable)
          .where(inArray(examQuestionPaperPageTable.paperId, paperIds))
          .groupBy(examQuestionPaperPageTable.paperId),
        db
          .select({ paperId: examQuestionPaperVersionTable.paperId, warnings: examQuestionPaperVersionTable.warnings, createdAt: examQuestionPaperVersionTable.createdAt })
          .from(examQuestionPaperVersionTable)
          .innerJoin(
            examQuestionPaperTable,
            and(eq(examQuestionPaperTable.id, examQuestionPaperVersionTable.paperId), eq(examQuestionPaperTable.latestVersionNo, examQuestionPaperVersionTable.versionNo)),
          )
          .where(inArray(examQuestionPaperVersionTable.paperId, paperIds)),
        db
          .select({ paperId: examQuestionPaperJobTable.paperId, id: examQuestionPaperJobTable.id, status: examQuestionPaperJobTable.status })
          .from(examQuestionPaperJobTable)
          .where(and(inArray(examQuestionPaperJobTable.paperId, paperIds), inArray(examQuestionPaperJobTable.status, ['queued', 'running']))),
        db
          .selectDistinctOn([examQuestionPaperJobTable.paperId], {
            paperId: examQuestionPaperJobTable.paperId,
            status: examQuestionPaperJobTable.status,
            errorCode: examQuestionPaperJobTable.errorCode,
            errorMessage: examQuestionPaperJobTable.errorMessage,
            completedAt: examQuestionPaperJobTable.completedAt,
          })
          .from(examQuestionPaperJobTable)
          .where(inArray(examQuestionPaperJobTable.paperId, paperIds))
          .orderBy(examQuestionPaperJobTable.paperId, sql`${examQuestionPaperJobTable.createdAt} desc`, sql`${examQuestionPaperJobTable.id} desc`),
      ])
    : [[], [], [], []];
  const pageCountOf = new Map(pageCounts.map((row) => [row.paperId, row.count]));
  const latestOf = new Map(latestVersions.map((row) => [row.paperId, row]));
  const activeOf = new Map(activeJobs.map((row) => [row.paperId, row]));
  const lastOf = new Map(lastJobs.map((row) => [row.paperId, row]));
  return createPaginatedResult({
    items: papers.map((paper) => {
      const latest = latestOf.get(paper.id);
      const active = activeOf.get(paper.id);
      const last = lastOf.get(paper.id);
      return {
        paperId: paper.id,
        details: detailsOf(paper),
        pageCount: pageCountOf.get(paper.id) ?? 0,
        latestVersionNo: paper.latestVersionNo,
        warningCount: latest?.warnings.length ?? 0,
        activeJob: active ? { id: active.id, status: active.status as 'queued' | 'running' } : null,
        // As for exam papers: a failure is news only until a version is saved after it.
        lastJobFailure:
          last?.status === 'failed' && last.errorCode && !(latest && last.completedAt && latest.createdAt >= last.completedAt)
            ? { errorCode: last.errorCode, message: last.errorMessage ?? 'AI generation failed.' }
            : null,
        createdAt: paper.createdAt,
        updatedAt: paper.updatedAt,
      };
    }),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems,
    pageSize,
  });
}

/** The most values each filter offers; a personal space with more distinct details than this is not expected. */
const FILTER_OPTIONS_LIMIT = 200;

/** `listStandalonePaperFilterOptions`: the distinct details of the school's own standalone papers, each list sorted. */
export async function listStandalonePaperFilterOptions(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<z.infer<typeof listStandalonePaperFilterOptionsOutputSchema>> {
  const optionsOf = async (column: (typeof DETAIL_COLUMNS)[keyof typeof DETAIL_COLUMNS]) => {
    const rows = await db
      .selectDistinct({ value: column })
      .from(examQuestionPaperTable)
      .where(and(eq(examQuestionPaperTable.schoolId, schoolId), eq(examQuestionPaperTable.kind, 'standalone'), isNotNull(column)))
      .orderBy(asc(column))
      .limit(FILTER_OPTIONS_LIMIT);
    return rows.map((row) => row.value).filter((value): value is string => value !== null);
  };
  const [schoolNames, classNames, subjectNames, examNames] = await Promise.all([
    optionsOf(DETAIL_COLUMNS.schoolName),
    optionsOf(DETAIL_COLUMNS.className),
    optionsOf(DETAIL_COLUMNS.subjectName),
    optionsOf(DETAIL_COLUMNS.examName),
  ]);
  return { schoolNames, classNames, subjectNames, examNames };
}
