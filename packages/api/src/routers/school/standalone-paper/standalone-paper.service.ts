import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { assistantConversationTable } from '@campuspilot/db/schema/assistant';
import { examQuestionPaperPageTable, examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, notExists, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { lockSchool } from '../../../billing/billing.service';
import { rpcError } from '../../../errors';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../../paginations';
import { conversationRefOf, latestPaperConversationId } from '../question-paper/question-paper.conversations';
import { paperListFactsOf } from '../question-paper/question-paper.list-facts';
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
import type { StandalonePaperReach, StandalonePaperScope } from '../question-paper/question-paper.scope';
import { hasSelectedQuestionPaperTemplate } from '../question-paper/question-paper.render';
import { readTemplatePrints } from '../question-paper/question-paper.template-prints';
import { getVersion } from '../question-paper/question-paper.version.service';
import { personalSpaceLimitError } from '../../../personal-space/personal-space.storage';
import { readSchoolKind } from '../../../school-access/school-kind.service';
import { STANDALONE_PAPERS_PER_SPACE_LIMIT } from './standalone-paper.dto';
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
 * Standalone question papers (docs/personal-space.md, docs/question-papers.md
 * "Quick papers in a school"): the reads that are their own. Everything that changes a paper (pages, generation, versions,
 * delete) is the exam papers' shared service with a standalone scope
 * (`ResolvedPaper`), so both kinds are validated, printed and locked the same
 * way.
 */

/** The details of a paper row, as read back. */
export function detailsOf(
  paper: Pick<PaperRow, 'detailsSchoolName' | 'detailsClassName' | 'detailsSubjectName' | 'detailsExamName' | 'detailsMaxMarks'>,
): StandalonePaperDetailsDto {
  return {
    schoolName: paper.detailsSchoolName,
    className: paper.detailsClassName,
    subjectName: paper.detailsSubjectName,
    examName: paper.detailsExamName,
    maxMarks: paper.detailsMaxMarks,
  };
}

/**
 * The papers of a school a reach covers: every standalone paper with
 * `oversee`, otherwise only the ones the person created (a paper whose
 * creator was deleted has a null `created_by` and is left out).
 */
export const reachedPapersWhere = (reach: StandalonePaperReach): SQL | undefined =>
  reach.oversee ? undefined : eq(examQuestionPaperTable.createdBy, reach.userId);

/**
 * A paper for the person to start on (`createStandalonePaper`), in one
 * transaction under the school's row lock, so creations sent at once see each
 * other. How it prints is decided here, once, from the school's kind
 * (`readSchoolKind`) and stored on the row (`print_layout`):
 *
 * - In a **personal space**: `plain`, no session (`sessionId` must not be
 *   sent), and at most {@link STANDALONE_PAPERS_PER_SPACE_LIMIT} papers
 *   (`personalSpaceLimitError('papers')`).
 * - In a **real school** (a quick paper): `school_template`, in the session
 *   the caller names (`sessionId`, required, a session of this school), with
 *   no count limit (docs/question-papers.md "Quick papers in a school").
 *
 * An **unused** paper of the caller's in the same place (the same session, or
 * none) is returned instead of a new one (`reused: true`). Unused is decided
 * from three facts, each read on its own: the paper has no page (reserved or
 * stored), no saved version (`latest_version_no = 0`), and no conversation
 * shared with it (`assistant_conversation.standalone_paper_id`, live or
 * deleted). Only the caller's own (`created_by`): a paper someone else
 * created is never handed to another person, even an empty one. Such a paper
 * holds nothing anyone made, so repeated clicks or a looping agent never pile
 * up empty papers. The oldest unused one is returned.
 *
 * The caller has checked the school's kind and the permission.
 */
export async function createStandalonePaper(
  db: Database,
  input: { schoolId: string; userId: string; sessionId: string | null },
): Promise<{ paperId: string; reused: boolean }> {
  const personal = (await readSchoolKind(db, input.schoolId)) === 'personal';
  if (personal && input.sessionId !== null) throw rpcError.badRequest('A personal space has no academic sessions: create the paper without a sessionId.');
  if (!personal && input.sessionId === null) throw rpcError.badRequest('Choose the academic session the question paper belongs to (sessionId).');
  return db.transaction(async (tx) => {
    await lockSchool(tx, input.schoolId);
    if (input.sessionId !== null) {
      const [session] = await tx
        .select({ id: schoolSessionTable.id })
        .from(schoolSessionTable)
        .where(and(eq(schoolSessionTable.id, input.sessionId), eq(schoolSessionTable.schoolId, input.schoolId)))
        .limit(1);
      if (!session) throw rpcError.notFound('Academic session');
    }
    const standalone = and(eq(examQuestionPaperTable.schoolId, input.schoolId), eq(examQuestionPaperTable.kind, 'standalone'));
    const [unused] = await tx
      .select({ id: examQuestionPaperTable.id })
      .from(examQuestionPaperTable)
      .where(
        and(
          standalone,
          eq(examQuestionPaperTable.createdBy, input.userId),
          input.sessionId === null ? isNull(examQuestionPaperTable.sessionId) : eq(examQuestionPaperTable.sessionId, input.sessionId),
          eq(examQuestionPaperTable.latestVersionNo, 0),
          notExists(tx.select({ id: examQuestionPaperPageTable.id }).from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, examQuestionPaperTable.id))),
          notExists(
            tx
              .select({ id: assistantConversationTable.id })
              .from(assistantConversationTable)
              .where(and(eq(assistantConversationTable.schoolId, input.schoolId), eq(assistantConversationTable.standalonePaperId, examQuestionPaperTable.id))),
          ),
        ),
      )
      .orderBy(asc(examQuestionPaperTable.createdAt), asc(examQuestionPaperTable.id))
      .limit(1);
    if (unused) return { paperId: unused.id, reused: true };
    if (personal) {
      const [held] = await tx.select({ count: count() }).from(examQuestionPaperTable).where(standalone);
      if ((held?.count ?? 0) >= STANDALONE_PAPERS_PER_SPACE_LIMIT) {
        throw personalSpaceLimitError('papers');
      }
    }
    const [paper] = await tx
      .insert(examQuestionPaperTable)
      .values({
        schoolId: input.schoolId,
        kind: 'standalone',
        printLayout: personal ? 'plain' : 'school_template',
        sessionId: input.sessionId,
        createdBy: input.userId,
      })
      .returning({ id: examQuestionPaperTable.id });
    if (!paper) throw rpcError.internal();
    return { paperId: paper.id, reused: false };
  });
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
    printLayout: paper.printLayout,
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
 * unless named), for agents, with what is printed around it
 * (`readTemplatePrints`): two empty lists on a plain page (the agent writes the
 * whole heading), the school template's lines for a quick paper.
 */
export async function getStandalonePaper(
  db: DatabaseExecutor,
  scope: StandalonePaperScope,
  versionNo: number | undefined,
): Promise<z.infer<typeof getStandalonePaperOutputSchema>> {
  const paper = await paperRowOf(db, scope);
  const [facts, pages, activeJob, templatePrints] = await Promise.all([factsOf(db, paper), pagesOf(db, paper.id), activeJobOf(db, paper.id), readTemplatePrints(db, scope)]);
  let version: z.infer<typeof getStandalonePaperOutputSchema>['version'] = null;
  if (versionNo !== undefined || paper.latestVersionNo > 0) {
    const row = await getVersion(db, paper.id, versionNo ?? paper.latestVersionNo);
    const [summary] = await toVersionSummaries(db, [row], paper.latestVersionNo);
    version = { ...summary!, warnings: row.warnings, html: row.contentHtml };
  }
  return {
    paper: facts,
    templatePrints,
    pages: pages.map(toPageDto),
    activeJob: activeJob ? toJob(activeJob) : null,
    version,
  };
}

/** `getStandalonePaperDetail`: what the paper's screen needs in one call, polled while a job runs. */
export async function getStandalonePaperDetail(db: DatabaseExecutor, scope: StandalonePaperScope): Promise<z.infer<typeof standalonePaperDetailOutputSchema>> {
  const paper = await paperRowOf(db, scope);
  const [facts, pages, activeJob, finished, versions, latestConversationId, templateConfigured] = await Promise.all([
    factsOf(db, paper),
    pagesOf(db, paper.id),
    activeJobOf(db, paper.id),
    lastFinishedJobOf(db, paper.id),
    versionsOf(db, paper.id).then((rows) => toVersionSummaries(db, rows, paper.latestVersionNo)),
    latestPaperConversationId(db, conversationRefOf(scope)),
    paper.printLayout === 'plain' ? true : hasSelectedQuestionPaperTemplate(db, paper.schoolId),
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
    templateConfigured,
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
 * `listStandalonePapers`: the school's standalone papers the caller reaches
 * ({@link reachedPapersWhere}), most recently changed first, matching the
 * search (any detail contains it) and every filter (that detail equals it
 * exactly, as the filter options list them).
 */
export async function listStandalonePapers(
  db: DatabaseExecutor,
  input: z.infer<typeof listStandalonePapersInputSchema>,
  reach: StandalonePaperReach,
): Promise<z.infer<typeof listStandalonePapersOutputSchema>> {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const search = input.searchQuery
    ? or(...Object.values(DETAIL_COLUMNS).map((column) => ilike(column, likePattern(input.searchQuery))))
    : undefined;
  const filters = (Object.keys(DETAIL_COLUMNS) as Array<keyof typeof DETAIL_COLUMNS>)
    .map((key): SQL | undefined => (input.filters[key] === undefined ? undefined : eq(DETAIL_COLUMNS[key], input.filters[key]!)))
    .filter((clause): clause is SQL => clause !== undefined);
  const where = and(eq(examQuestionPaperTable.schoolId, input.schoolId), eq(examQuestionPaperTable.kind, 'standalone'), reachedPapersWhere(reach), search, ...filters);
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
  const listFactsOf = await paperListFactsOf(db, papers.map((paper) => paper.id));
  return createPaginatedResult({
    items: papers.map((paper) => {
      const facts = listFactsOf(paper.id);
      return {
        paperId: paper.id,
        details: detailsOf(paper),
        pageCount: facts.pageCount,
        latestVersionNo: paper.latestVersionNo,
        warningCount: facts.warningCount,
        activeJob: facts.activeJob,
        lastJobFailure: facts.lastJobFailure,
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

/** `listStandalonePaperFilterOptions`: the distinct details of the school's standalone papers the caller reaches, each list sorted. */
export async function listStandalonePaperFilterOptions(
  db: DatabaseExecutor,
  schoolId: string,
  reach: StandalonePaperReach,
): Promise<z.infer<typeof listStandalonePaperFilterOptionsOutputSchema>> {
  const optionsOf = async (column: (typeof DETAIL_COLUMNS)[keyof typeof DETAIL_COLUMNS]) => {
    const rows = await db
      .selectDistinct({ value: column })
      .from(examQuestionPaperTable)
      .where(and(eq(examQuestionPaperTable.schoolId, schoolId), eq(examQuestionPaperTable.kind, 'standalone'), reachedPapersWhere(reach), isNotNull(column)))
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
