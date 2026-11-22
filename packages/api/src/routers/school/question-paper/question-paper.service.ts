import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Database, DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { generateId } from '@campuspilot/db/id';
import { examPlanTable } from '@campuspilot/db/schema/exam';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperJobTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { classTable } from '@campuspilot/db/schema/class';
import { env as assistantEnv } from '@campuspilot/env/assistant';
import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';
import type { QuestionPaperPageRotation } from '@campuspilot/question-paper/pages';
import { ORPCError } from '@orpc/server';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import { PERSONAL_SPACE_MAX_RUNNING_JOBS } from '../../../personal-space/personal-space.limits';
import { assertPersonalSpaceStorageRoom, assertStandaloneVersionRoom } from '../../../personal-space/personal-space.storage';
import { readSchoolKind } from '../../../school-access/school-kind.service';
import { getExamSession } from '../exam/exam.service';
import { conversationRefOf, latestPaperConversationId, paperChatIsWorking, unshareConversationsOf, unsharePaperConversations } from './question-paper.conversations';
import { checkImageHeader, makeImageDerivatives, normalizeFigureImage } from '../../../files/image-derivative';
import { requestImageDerivatives } from '../../../workflows/image-derivatives/outbox';
import { getQuestionPaperModel } from '../../../workflows/question-paper/model';
import { handOff, dispatchQuestionPaperJob } from '../../../workflows/question-paper/outbox';
import {
  QUESTION_PAPER_MAX_PAGES,
  QUESTION_PAPER_PAGE_RESERVATION_TTL_MS,
  type detailOutputSchema,
  type getQuestionPaperOutputSchema,
  type listQuestionPapersOutputSchema,
} from './question-paper.dto';
import {
  activeJobOf,
  assertNoActiveJob,
  findPaper,
  findPaperOf,
  lastFinishedJobOf,
  lockOrCreatePaperOf,
  lockPaperOf,
  pagesOf,
  providerUnavailableError,
  templateMissingError,
  toPageDto,
  toVersionSummaries,
  versionsOf,
  type PageRow,
  type PaperRow,
} from './question-paper.records';
import { hasSelectedQuestionPaperTemplate } from './question-paper.render';
import {
  assertResolvedPaperWritable,
  assertResolvedPaperWritableLocked,
  isStandalonePaper,
  paperSchoolIdOf,
  printLayoutOf,
  type PaperScope,
  type ResolvedPaper,
} from './question-paper.scope';
import { deleteObjectsBestEffort, getObjectBytes, putObject, questionPaperKeys } from './question-paper.storage';
import { readTemplatePrints } from './question-paper.template-prints';
import { getVersion } from './question-paper.version.service';

const emptyPaperFacts = (scope: PaperScope, paper: PaperRow | undefined) => ({
  paperId: paper?.id ?? null,
  className: scope.className,
  subjectName: scope.subjectName,
  modeName: scope.modeName,
  examName: scope.examName,
  planMaxMarks: scope.planMaxMarks,
  pageCount: 0,
  pageRevision: paper?.pageRevision ?? 0,
  latestVersionNo: paper?.latestVersionNo ?? 0,
  examCompleted: scope.examCompleted,
  sessionActive: scope.sessionIsActive,
});

const toJob = (job: { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: Date }) => ({
  id: job.id,
  status: job.status,
  createdAt: job.createdAt,
});

/** A job for the paper screen ({@link getQuestionPaperDetail}): with the teacher's instructions it was started with. */
const toDetailJob = (job: { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: Date; instructions: string | null }) => ({
  ...toJob(job),
  instructions: job.instructions,
});

/** Everything the paper screen shows, for one paper that may not exist yet. */
async function loadPaperView(db: DatabaseExecutor, scope: PaperScope) {
  const paper = await findPaper(db, scope.key);
  if (!paper) return { paper: undefined, pages: [], facts: emptyPaperFacts(scope, undefined), activeJob: undefined };
  const [pages, activeJob] = await Promise.all([pagesOf(db, paper.id), activeJobOf(db, paper.id)]);
  return { paper, pages, facts: { ...emptyPaperFacts(scope, paper), pageCount: pages.length }, activeJob };
}

/**
 * `getQuestionPaper`: the paper, its pages and one version (the latest unless
 * named), with what the school's template prints around the body
 * (`templatePrints`). Agents are the only readers of this procedure, and the
 * lines are what tells them which heading lines not to write again; they are
 * always those of the currently selected template, the one a new version
 * would be printed with, also when an older version is named.
 */
export async function getQuestionPaper(
  db: DatabaseExecutor,
  scope: PaperScope,
  versionNo: number | undefined,
): Promise<z.infer<typeof getQuestionPaperOutputSchema>> {
  const [view, templatePrints] = await Promise.all([loadPaperView(db, scope), readTemplatePrints(db, scope)]);
  let version: z.infer<typeof getQuestionPaperOutputSchema>['version'] = null;
  if (view.paper && (versionNo !== undefined || view.paper.latestVersionNo > 0)) {
    const row = await getVersion(db, view.paper.id, versionNo ?? view.paper.latestVersionNo);
    const [summary] = await toVersionSummaries(db, [row], view.paper.latestVersionNo);
    version = { ...summary!, warnings: row.warnings, html: row.contentHtml };
  } else if (versionNo !== undefined) {
    throw rpcError.notFound('Question paper version');
  }
  return {
    paper: view.facts,
    templatePrints,
    pages: view.pages.map(toPageDto),
    activeJob: view.activeJob ? toJob(view.activeJob) : null,
    version,
  };
}

/** The facts of one paper (the `paper` block of {@link getQuestionPaper}) without its pages and versions. */
export async function getQuestionPaperFacts(db: DatabaseExecutor, scope: PaperScope) {
  return (await loadPaperView(db, scope)).facts;
}

/** `getQuestionPaperDetail`: what the Question paper screen needs in one call, polled while a job runs. */
export async function getQuestionPaperDetail(
  db: DatabaseExecutor,
  scope: PaperScope,
): Promise<z.infer<typeof detailOutputSchema>> {
  const view = await loadPaperView(db, scope);
  const [finished, versions, template, latestConversationId] = await Promise.all([
    view.paper ? lastFinishedJobOf(db, view.paper.id) : undefined,
    view.paper ? versionsOf(db, view.paper.id).then((rows) => toVersionSummaries(db, rows, view.paper!.latestVersionNo)) : [],
    hasSelectedQuestionPaperTemplate(db, scope.key.schoolId),
    latestPaperConversationId(db, conversationRefOf(scope)),
  ]);
  return {
    paper: view.facts,
    pages: view.pages.map(toPageDto),
    activeJob: view.activeJob ? toDetailJob(view.activeJob) : null,
    lastFinishedJob:
      finished && finished.completedAt
        ? { ...toDetailJob(finished), errorCode: finished.errorCode, errorMessage: finished.errorMessage, completedAt: finished.completedAt }
        : null,
    versions,
    templateConfigured: template,
    latestConversationId,
  };
}

/** `listQuestionPaperVersions`. */
export async function listQuestionPaperVersions(db: DatabaseExecutor, scope: ResolvedPaper) {
  const paper = await findPaperOf(db, scope);
  if (!paper) return { versions: [] };
  return { versions: await toVersionSummaries(db, await versionsOf(db, paper.id), paper.latestVersionNo) };
}

type ExamIdentity = { schoolId: string; sessionId: string; examSlug: string };

/**
 * `listQuestionPapers`: for each class of the exam the caller may read, the
 * subjects and modes of its plans with the state of the paper of each. A
 * class is listed only when `authorize` says the caller may read it, and its
 * `canManage` is the caller's own manage decision. Names come from the class
 * configuration (a plan can outlive a renamed subject), the maximum marks
 * from the plan.
 */
export async function listQuestionPapers(
  db: DatabaseExecutor,
  input: ExamIdentity & { classId?: string | undefined },
  authorize: (classIds: string[]) => Promise<{ read: Set<string>; manage: Set<string> }>,
): Promise<z.infer<typeof listQuestionPapersOutputSchema>> {
  const session = await getExamSession(db, input);
  if (!Object.hasOwn(session.config.examConfig, input.examSlug)) throw rpcError.notFound('Exam');
  const plans = await db
    .select({ classId: examPlanTable.classId, subjectSlug: examPlanTable.subjectSlug, modeConfig: examPlanTable.modeConfig })
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.schoolId, input.schoolId),
        eq(examPlanTable.sessionId, input.sessionId),
        eq(examPlanTable.examSlug, input.examSlug),
        input.classId ? eq(examPlanTable.classId, input.classId) : undefined,
      ),
    );
  const { read, manage } = await authorize([...new Set(plans.map((plan) => plan.classId))]);
  const visible = plans.filter((plan) => read.has(plan.classId));
  if (visible.length === 0) return { classes: [] };
  const classIds = [...new Set(visible.map((plan) => plan.classId))];
  const [classes, papers] = await Promise.all([
    db
      .select({ id: classTable.id, label: classTable.label, config: classTable.config, displayOrder: classTable.displayOrder })
      .from(classTable)
      .where(and(eq(classTable.schoolId, input.schoolId), inArray(classTable.id, classIds)))
      .orderBy(asc(classTable.displayOrder), asc(classTable.id)),
    db
      .select()
      .from(examQuestionPaperTable)
      .where(
        and(
          eq(examQuestionPaperTable.schoolId, input.schoolId),
          eq(examQuestionPaperTable.sessionId, input.sessionId),
          eq(examQuestionPaperTable.examSlug, input.examSlug),
          inArray(examQuestionPaperTable.classId, classIds),
        ),
      ),
  ]);
  const paperIds = papers.map((paper) => paper.id);
  const [pageCounts, latestVersions, activeJobs, lastJobs] = paperIds.length
    ? await Promise.all([
        db
          .select({ paperId: examQuestionPaperPageTable.paperId, count: sql<number>`count(*)::int` })
          .from(examQuestionPaperPageTable)
          .where(inArray(examQuestionPaperPageTable.paperId, paperIds))
          .groupBy(examQuestionPaperPageTable.paperId),
        db
          .select({
            paperId: examQuestionPaperVersionTable.paperId,
            versionNo: examQuestionPaperVersionTable.versionNo,
            planMaxMarks: examQuestionPaperVersionTable.planMaxMarks,
            warnings: examQuestionPaperVersionTable.warnings,
            createdAt: examQuestionPaperVersionTable.createdAt,
          })
          .from(examQuestionPaperVersionTable)
          .innerJoin(
            examQuestionPaperTable,
            and(
              eq(examQuestionPaperTable.id, examQuestionPaperVersionTable.paperId),
              eq(examQuestionPaperTable.latestVersionNo, examQuestionPaperVersionTable.versionNo),
            ),
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
  const paperOf = new Map(papers.map((paper) => [`${paper.classId}/${paper.subjectSlug}/${paper.modeSlug}`, paper]));

  return {
    classes: classes.map((schoolClass) => {
      const classPlans = visible.filter((plan) => plan.classId === schoolClass.id).sort((a, b) => a.subjectSlug.localeCompare(b.subjectSlug));
      return {
        classId: schoolClass.id,
        className: schoolClass.label,
        canManage: manage.has(schoolClass.id),
        subjects: classPlans.map((plan) => {
          const subject = schoolClass.config?.subjects?.[plan.subjectSlug];
          return {
            subjectSlug: plan.subjectSlug,
            subjectName: subject?.name ?? plan.subjectSlug,
            modes: Object.entries(plan.modeConfig)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([modeSlug, mode]) => {
                const paper = paperOf.get(`${schoolClass.id}/${plan.subjectSlug}/${modeSlug}`);
                const latest = paper ? latestOf.get(paper.id) : undefined;
                const active = paper ? activeOf.get(paper.id) : undefined;
                const last = paper ? lastOf.get(paper.id) : undefined;
                return {
                  modeSlug,
                  modeName: subject?.examModes?.[modeSlug]?.name ?? modeSlug,
                  maxMarks: mode.maxMarks,
                  paper: paper
                    ? {
                        paperId: paper.id,
                        pageCount: pageCountOf.get(paper.id) ?? 0,
                        latestVersionNo: paper.latestVersionNo,
                        planMaxMarks: latest?.planMaxMarks ?? null,
                        warningCount: latest?.warnings.length ?? 0,
                        activeJob: active ? { id: active.id, status: active.status as 'queued' | 'running' } : null,
                        // A failure is news only until a version is saved after it (the teacher fixed the paper in chat).
                        lastJobFailure:
                          last?.status === 'failed' && last.errorCode && !(latest && last.completedAt && latest.createdAt >= last.completedAt)
                            ? { errorCode: last.errorCode, message: last.errorMessage ?? 'AI generation failed.' }
                            : null,
                      }
                    : null,
                };
              }),
          };
        }),
      };
    }),
  };
}

/** The display name of an uploaded file: no path, no control characters, at most 200 characters. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned || 'page';
}

/**
 * A cheap read-only look, before any decode or storage write, at the refusals
 * the locked transaction will give anyway (a full paper, a running
 * generation), so a refused upload costs no storage calls. It takes no lock and
 * is never the authority: the transaction re-checks everything, and an upload
 * that passes here may still be refused there.
 */
async function precheckPageUpload(db: Database, scope: ResolvedPaper) {
  const paper = await findPaperOf(db, scope);
  if (!paper) return;
  const [pages, active] = await Promise.all([pagesOf(db, paper.id), activeJobOf(db, paper.id)]);
  if (pages.length >= QUESTION_PAPER_MAX_PAGES) throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_MAX_PAGES} pages.`);
  if (active) await assertNoActiveJob(db, paper.id, 'Pages cannot be added');
  await assertPersonalSpaceStorageRoom(db, { schoolId: paperSchoolIdOf(scope), addedBytes: 0, lock: false });
}

/** The same unlocked look for a figure: a paper that already holds its figures refuses before anything is written. */
async function precheckFigureUpload(db: Database, scope: ResolvedPaper) {
  const paper = await findPaperOf(db, scope);
  if (!paper) return;
  const [figures] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(examQuestionPaperFigureTable)
    .where(eq(examQuestionPaperFigureTable.paperId, paper.id));
  if (figures!.count >= QUESTION_PAPER_LIMITS.figures) {
    throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_LIMITS.figures} figure images.`);
  }
}

/** Bumps the paper's page revision (positions or the set of pages changed) and returns it. */
async function bumpPageRevision(tx: DatabaseTransaction, paperId: string) {
  const [bumped] = await tx
    .update(examQuestionPaperTable)
    .set({ pageRevision: sql`${examQuestionPaperTable.pageRevision} + 1`, updatedAt: new Date() })
    .where(eq(examQuestionPaperTable.id, paperId))
    .returning({ pageRevision: examQuestionPaperTable.pageRevision });
  return bumped!.pageRevision;
}

/** Writes positions 1..n for `pages` in their given order, skipping rows already in place. */
async function renumberPages(tx: DatabaseTransaction, pages: ReadonlyArray<{ id: string; position: number }>) {
  for (const [index, page] of pages.entries()) {
    if (page.position === index + 1) continue;
    await tx.update(examQuestionPaperPageTable).set({ position: index + 1 }).where(eq(examQuestionPaperPageTable.id, page.id));
  }
}

/**
 * Reserves the next pages of a paper, one per picked photo and in the order
 * they were picked, before any bytes are sent. The rows are `awaiting` (no
 * file facts yet); the photos then upload in parallel into their own rows
 * ({@link storeQuestionPaperPage}), so the order never depends on which upload
 * finishes first. Runs under the paper row lock like every page write: the
 * 20 page cap counts reserved rows, and no generation may be running.
 */
export async function reserveQuestionPaperPages(
  db: Database,
  input: { scope: ResolvedPaper; userId: string; fileNames: readonly string[] },
) {
  const { scope } = input;
  assertResolvedPaperWritable(scope);
  if (input.fileNames.length === 0) throw rpcError.badRequest('Pick at least one photo.');
  return db.transaction(async (tx) => {
    await assertResolvedPaperWritableLocked(tx, scope);
    const paper = await lockOrCreatePaperOf(tx, scope, input.userId);
    const existing = await pagesOf(tx, paper.id);
    if (existing.length + input.fileNames.length > QUESTION_PAPER_MAX_PAGES) {
      throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_MAX_PAGES} pages.`);
    }
    await assertNoActiveJob(tx, paper.id, 'Pages cannot be added');
    // A personal space that is already full reserves nothing (the photo's size is checked when it arrives).
    await assertPersonalSpaceStorageRoom(tx, { schoolId: paperSchoolIdOf(scope), addedBytes: 0, lock: true });
    const rows = await tx
      .insert(examQuestionPaperPageTable)
      .values(
        input.fileNames.map((name, index) => ({
          paperId: paper.id,
          schoolId: paperSchoolIdOf(scope),
          position: existing.length + index + 1,
          uploadStatus: 'awaiting' as const,
          originalName: sanitizeFileName(name),
          derivativeStatus: 'pending' as const,
          uploadedBy: input.userId,
        })),
      )
      .returning();
    const pageRevision = await bumpPageRevision(tx, paper.id);
    const pages = [...rows].sort((a, b) => a.position - b.position).map(toPageDto);
    return { pages, pageRevision };
  });
}

/**
 * The cheap, unlocked look before the original is written: the page exists in
 * this paper and still awaits its bytes. The locked update re-checks both.
 */
async function precheckPageStore(db: Database, scope: ResolvedPaper, pageId: string, byteSize: number) {
  const paper = await findPaperOf(db, scope);
  const [page] = paper
    ? await db
        .select({ uploadStatus: examQuestionPaperPageTable.uploadStatus })
        .from(examQuestionPaperPageTable)
        .where(and(eq(examQuestionPaperPageTable.id, pageId), eq(examQuestionPaperPageTable.paperId, paper.id)))
        .limit(1)
    : [];
  if (!page) throw rpcError.notFound('Question paper page');
  if (page.uploadStatus !== 'awaiting') throw rpcError.conflict('This page already has its photo.');
  await assertPersonalSpaceStorageRoom(db, { schoolId: paperSchoolIdOf(scope), addedBytes: byteSize, lock: false });
}

/**
 * Stores the photo of a reserved page (the upload route, after it has checked
 * permission, access and the file). The header is read first (an image over
 * 40 megapixels is refused before anything is written); the original is then
 * written with no lock held, and a short transaction re-checks the exam, locks
 * the paper and fills the row (`stored`, derivatives `pending`). The worker
 * makes the thumbnail and model copy after the commit
 * (`workflows/image-derivatives`), so this request never decodes the photo.
 * A refused store removes the object again. Filling a row changes no position,
 * so the page revision stays as it is.
 */
export async function storeQuestionPaperPage(
  db: Database,
  input: {
    scope: ResolvedPaper;
    pageId: string;
    file: { bytes: Buffer; contentType: string; extension: string; name: string };
    /** Hands the stored page to the worker; the default is the outbox hand-over. Tests replace it. */
    requestDerivatives?: (pageId: string) => void;
  },
) {
  const { scope, file, pageId } = input;
  assertResolvedPaperWritable(scope);
  await precheckPageStore(db, scope, pageId, file.bytes.byteLength);
  const size = await checkImageHeader(file.bytes);
  // Each attempt writes its own object: an overlapping store for the same page (a repeated request) that loses
  // the fence below removes only what it wrote, never the original of the attempt that won.
  const originalKey = questionPaperKeys.original(paperSchoolIdOf(scope), pageId, file.extension, randomBytes(6).toString('hex'));
  try {
    await putObject(originalKey, file.bytes, file.contentType);
    const page = await db.transaction(async (tx) => {
      await assertResolvedPaperWritableLocked(tx, scope);
      const paper = await lockPaperOf(tx, scope);
      await assertNoActiveJob(tx, paper.id, 'Pages cannot be added');
      // The photo's bytes count now; its thumbnail and model copy, made by the worker from an accepted photo, are
      // counted once they exist (docs/personal-space.md "Limits").
      await assertPersonalSpaceStorageRoom(tx, { schoolId: paperSchoolIdOf(scope), addedBytes: file.bytes.byteLength, lock: true });
      const [stored] = await tx
        .update(examQuestionPaperPageTable)
        .set({
          uploadStatus: 'stored',
          originalS3Key: originalKey,
          // The name of the file actually sent (a photo re-encoded in the browser is a .jpg), not the one picked.
          originalName: sanitizeFileName(file.name),
          contentType: file.contentType,
          byteSize: file.bytes.byteLength,
          sha256: createHash('sha256').update(file.bytes).digest('hex'),
          width: size?.width ?? null,
          height: size?.height ?? null,
          storedAt: new Date(),
        })
        .where(
          and(
            eq(examQuestionPaperPageTable.id, pageId),
            eq(examQuestionPaperPageTable.paperId, paper.id),
            eq(examQuestionPaperPageTable.uploadStatus, 'awaiting'),
          ),
        )
        .returning();
      if (!stored) throw rpcError.conflict('This page was removed or already has its photo. Add the photo again.');
      return stored;
    });
    (input.requestDerivatives ?? ((id: string) => requestImageDerivatives('page', id)))(page.id);
    return { page: toPageDto(page) };
  } catch (error) {
    await deleteObjectsBestEffort([originalKey]);
    throw error;
  }
}

/**
 * Removes a reserved page whose photo never arrived (its upload failed or was
 * cancelled) and renumbers the rest. No page revision is asked for: nobody
 * has seen this page as a photo yet. A page that already has its photo is
 * removed with {@link deleteQuestionPaperPage} instead. Removing one that is
 * already gone is not an error.
 */
export async function releaseQuestionPaperPage(db: Database, input: { scope: ResolvedPaper; pageId: string }) {
  assertResolvedPaperWritable(input.scope);
  return db.transaction(async (tx) => {
    await assertResolvedPaperWritableLocked(tx, input.scope);
    const paper = await lockPaperOf(tx, input.scope);
    const pages = await pagesOf(tx, paper.id);
    const page = pages.find((candidate) => candidate.id === input.pageId);
    if (!page) return { released: false, pageRevision: paper.pageRevision };
    if (page.uploadStatus !== 'awaiting') throw rpcError.conflict('This page already has its photo. Delete the page instead.');
    await tx.delete(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.id, page.id));
    await renumberPages(tx, pages.filter((candidate) => candidate.id !== page.id));
    return { released: true, pageRevision: await bumpPageRevision(tx, paper.id) };
  });
}

/**
 * Removes reservations whose photo never arrived within
 * {@link QUESTION_PAPER_PAGE_RESERVATION_TTL_MS} (a closed tab, a lost
 * connection), at most `limit` papers per call, and renumbers each paper's
 * remaining pages. Each paper is locked on its own (`SKIP LOCKED`), so the
 * sweep never waits for, or blocks, a teacher's own page write.
 */
export async function releaseExpiredPageReservations(db: Database, now: Date = new Date(), limit = 20) {
  const cutoff = new Date(now.getTime() - QUESTION_PAPER_PAGE_RESERVATION_TTL_MS);
  const papers = await db
    .selectDistinct({ paperId: examQuestionPaperPageTable.paperId })
    .from(examQuestionPaperPageTable)
    .where(and(eq(examQuestionPaperPageTable.uploadStatus, 'awaiting'), lt(examQuestionPaperPageTable.createdAt, cutoff)))
    .limit(limit);
  let released = 0;
  for (const { paperId } of papers) {
    released += await db.transaction(async (tx) => {
      const [paper] = await tx
        .select({ id: examQuestionPaperTable.id })
        .from(examQuestionPaperTable)
        .where(eq(examQuestionPaperTable.id, paperId))
        .for('update', { skipLocked: true });
      if (!paper) return 0;
      const pages = await pagesOf(tx, paper.id);
      const expired = new Set(pages.filter((page) => page.uploadStatus === 'awaiting' && page.createdAt < cutoff).map((page) => page.id));
      if (expired.size === 0) return 0;
      await tx.delete(examQuestionPaperPageTable).where(inArray(examQuestionPaperPageTable.id, [...expired]));
      await renumberPages(tx, pages.filter((page) => !expired.has(page.id)));
      await bumpPageRevision(tx, paper.id);
      return expired.size;
    });
  }
  return { released };
}

/**
 * Adds one photo as the paper's next page in a single call: a reservation of
 * one page, then its store. For callers that hold the bytes already (the demo
 * seed, and the original single-request route that browser tabs opened before
 * reservations existed may still use). A store that fails releases the
 * reservation again, so a refused upload leaves nothing.
 */
export async function addQuestionPaperPage(
  db: Database,
  input: {
    scope: ResolvedPaper;
    userId: string;
    file: { bytes: Buffer; contentType: string; extension: string; name: string };
    requestDerivatives?: (pageId: string) => void;
  },
) {
  const { scope, file } = input;
  assertResolvedPaperWritable(scope);
  await precheckPageUpload(db, scope);
  // Refused before a reservation exists, so an oversized photo changes nothing.
  await checkImageHeader(file.bytes);
  const reserved = await reserveQuestionPaperPages(db, { scope, userId: input.userId, fileNames: [file.name] });
  const pageId = reserved.pages[0]!.id;
  try {
    const { page } = await storeQuestionPaperPage(db, { scope, pageId, file, requestDerivatives: input.requestDerivatives });
    return { page, pageRevision: reserved.pageRevision };
  } catch (error) {
    await releaseQuestionPaperPage(db, { scope, pageId }).catch(() => undefined);
    throw error;
  }
}

function assertPageRevision(paper: PaperRow, expected: number) {
  if (paper.pageRevision !== expected) {
    throw rpcError.conflict('The pages changed since you loaded them. Reload the paper and try again.');
  }
}

/** Reorders the pages: `pageIds` must be exactly the paper's pages in the new order. */
export async function reorderQuestionPaperPages(
  db: Database,
  input: { scope: ResolvedPaper; pageIds: string[]; expectedPageRevision: number },
) {
  assertResolvedPaperWritable(input.scope);
  return db.transaction(async (tx) => {
    await assertResolvedPaperWritableLocked(tx, input.scope);
    const paper = await lockPaperOf(tx, input.scope);
    assertPageRevision(paper, input.expectedPageRevision);
    await assertNoActiveJob(tx, paper.id, 'Pages cannot be reordered');
    const pages = await pagesOf(tx, paper.id);
    const current = new Set(pages.map((page) => page.id));
    if (input.pageIds.length !== pages.length || new Set(input.pageIds).size !== pages.length || input.pageIds.some((id) => !current.has(id))) {
      throw rpcError.badRequest('Send every page of the paper exactly once.');
    }
    for (const [index, pageId] of input.pageIds.entries()) {
      await tx
        .update(examQuestionPaperPageTable)
        .set({ position: index + 1 })
        .where(and(eq(examQuestionPaperPageTable.id, pageId), eq(examQuestionPaperPageTable.paperId, paper.id)));
    }
    const [bumped] = await tx
      .update(examQuestionPaperTable)
      .set({ pageRevision: sql`${examQuestionPaperTable.pageRevision} + 1`, updatedAt: new Date() })
      .where(eq(examQuestionPaperTable.id, paper.id))
      .returning({ pageRevision: examQuestionPaperTable.pageRevision });
    return { pageRevision: bumped!.pageRevision };
  });
}

/** Deletes one page, renumbers the rest and removes its three objects after the commit. */
export async function deleteQuestionPaperPage(
  db: Database,
  input: { scope: ResolvedPaper; pageId: string; expectedPageRevision: number },
) {
  assertResolvedPaperWritable(input.scope);
  const { pageRevision, keys } = await db.transaction(async (tx) => {
    await assertResolvedPaperWritableLocked(tx, input.scope);
    const paper = await lockPaperOf(tx, input.scope);
    assertPageRevision(paper, input.expectedPageRevision);
    await assertNoActiveJob(tx, paper.id, 'A page cannot be deleted');
    const pages = await pagesOf(tx, paper.id);
    const page = pages.find((candidate) => candidate.id === input.pageId);
    if (!page) throw rpcError.notFound('Question paper page');
    await tx.delete(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.id, page.id));
    const rest = pages.filter((candidate) => candidate.id !== page.id);
    for (const [index, remaining] of rest.entries()) {
      if (remaining.position === index + 1) continue;
      await tx.update(examQuestionPaperPageTable).set({ position: index + 1 }).where(eq(examQuestionPaperPageTable.id, remaining.id));
    }
    const [bumped] = await tx
      .update(examQuestionPaperTable)
      .set({ pageRevision: sql`${examQuestionPaperTable.pageRevision} + 1`, updatedAt: new Date() })
      .where(eq(examQuestionPaperTable.id, paper.id))
      .returning({ pageRevision: examQuestionPaperTable.pageRevision });
    return { pageRevision: bumped!.pageRevision, keys: pageObjectKeys(page) };
  });
  await deleteObjectsBestEffort(keys);
  return { pageRevision };
}

/** The refusal for turning a page whose photo the server cannot decode (a HEIC): it has no derivatives to make again. */
const unturnablePage = () =>
  rpcError.badRequest('This photo cannot be turned: the server cannot read its format (HEIC). Convert it to JPEG and add it again.');

/**
 * The stored original of a page that can be turned, or the refusal. Only a
 * `ready` page has derivatives to make again. The worker makes them after the
 * upload, so a page whose photo is still on its way (`awaiting`, always
 * `pending`) or whose copies are not made yet (`pending`) is refused until
 * they exist: a turn is never recorded on a page the worker may still write,
 * and the worker never meets a turned page. A `failed` page cannot be read at
 * all, an `unsupported` one (HEIC) not by this server.
 */
function turnableOriginal(page: PageRow): { s3Key: string; contentType: string } {
  if (page.uploadStatus === 'awaiting') throw rpcError.conflict('This photo is still uploading. Turn it once it has finished.');
  if (page.derivativeStatus === 'pending') throw rpcError.conflict('This photo is still being processed. Try again in a moment.');
  if (page.derivativeStatus === 'failed') throw rpcError.badRequest('This photo could not be read as an image. Remove it and upload it again.');
  // A `ready` page always has its photo (`exam_question_paper_page_upload_check`); the null checks only narrow the types.
  if (page.derivativeStatus !== 'ready' || !page.originalS3Key || !page.contentType) throw unturnablePage();
  return { s3Key: page.originalS3Key, contentType: page.contentType };
}

/** The page of a paper, or NOT_FOUND; a page id of another paper is not found under this one. */
async function pageOfPaper(db: DatabaseExecutor, paperId: string, pageId: string) {
  const [page] = await db
    .select()
    .from(examQuestionPaperPageTable)
    .where(and(eq(examQuestionPaperPageTable.id, pageId), eq(examQuestionPaperPageTable.paperId, paperId)))
    .limit(1);
  if (!page) throw rpcError.notFound('Question paper page');
  return page;
}

/**
 * Turns one page to `rotation` (clockwise degrees on top of the photo's EXIF
 * orientation) and makes its thumbnail and model derivative again from the
 * stored original, which is never changed. Like an upload, the slow part runs
 * with no lock held: a read-only look refuses early (stale revision, running
 * generation, unknown or undecodable page) before the original is read,
 * decoded and the new derivatives are written under new keys
 * (`questionPaperKeys` with a random remake token). A short transaction then
 * re-checks the exam, the revision, the job and the page under the paper
 * lock, points the row at the new objects with the turned size, and bumps the
 * page's `derivative_revision` and the paper's `page_revision` (the model's
 * input changed, so a generation must be started against the new revision).
 * The new objects are removed again if that is refused; the old ones are
 * deleted after the commit, best effort.
 *
 * Asking for the rotation the page already has changes nothing and returns
 * the current revision.
 */
export async function rotateQuestionPaperPage(
  db: Database,
  input: { scope: ResolvedPaper; pageId: string; rotation: QuestionPaperPageRotation; expectedPageRevision: number },
) {
  const { scope } = input;
  assertResolvedPaperWritable(scope);
  const paper = await findPaperOf(db, scope);
  if (!paper) throw rpcError.notFound('Question paper');
  assertPageRevision(paper, input.expectedPageRevision);
  await assertNoActiveJob(db, paper.id, 'A page cannot be turned');
  const page = await pageOfPaper(db, paper.id, input.pageId);
  const original = turnableOriginal(page);
  if (page.rotation === input.rotation) return { page: toPageDto(page), pageRevision: paper.pageRevision };

  const derivatives = await makeImageDerivatives(await getObjectBytes(original.s3Key), original.contentType, { rotation: input.rotation });
  // The server decoded this photo at upload; a decoder that no longer can is the same refusal, not a broken row.
  if (derivatives.status !== 'ready') throw unturnablePage();
  const remake = randomUUID();
  const schoolId = paperSchoolIdOf(scope);
  const thumbKey = questionPaperKeys.thumb(schoolId, page.id, remake);
  const modelKey = questionPaperKeys.model(schoolId, page.id, remake);
  let committed: { replaced: Array<string | null>; result: { page: ReturnType<typeof toPageDto>; pageRevision: number } };
  try {
    await putObject(thumbKey, derivatives.thumb.bytes, derivatives.thumb.contentType);
    await putObject(modelKey, derivatives.model.bytes, derivatives.model.contentType);
    committed = await db.transaction(async (tx) => {
      await assertResolvedPaperWritableLocked(tx, scope);
      const locked = await lockPaperOf(tx, scope);
      assertPageRevision(locked, input.expectedPageRevision);
      await assertNoActiveJob(tx, locked.id, 'A page cannot be turned');
      const current = await pageOfPaper(tx, locked.id, input.pageId);
      turnableOriginal(current);
      const [turned] = await tx
        .update(examQuestionPaperPageTable)
        .set({
          rotation: input.rotation,
          derivativeRevision: sql`${examQuestionPaperPageTable.derivativeRevision} + 1`,
          width: derivatives.width,
          height: derivatives.height,
          thumbS3Key: thumbKey,
          thumbByteSize: derivatives.thumb.bytes.byteLength,
          modelS3Key: modelKey,
          modelContentType: derivatives.model.contentType,
          modelByteSize: derivatives.model.bytes.byteLength,
        })
        .where(eq(examQuestionPaperPageTable.id, current.id))
        .returning();
      const [bumped] = await tx
        .update(examQuestionPaperTable)
        .set({ pageRevision: sql`${examQuestionPaperTable.pageRevision} + 1`, updatedAt: new Date() })
        .where(eq(examQuestionPaperTable.id, locked.id))
        .returning({ pageRevision: examQuestionPaperTable.pageRevision });
      return {
        replaced: [current.thumbS3Key, current.modelS3Key],
        result: { page: toPageDto(turned!), pageRevision: bumped!.pageRevision },
      };
    });
  } catch (error) {
    await deleteObjectsBestEffort([thumbKey, modelKey]);
    throw error;
  }
  await deleteObjectsBestEffort(committed.replaced);
  return committed.result;
}

/**
 * Deletes the papers matched by `where` inside the caller's transaction:
 * rows (pages, jobs, versions and figures cascade), the PDF and Word artifacts
 * of their versions, and returns every object key to remove after the commit.
 * Template revisions are shared with other versions and are never deleted.
 */
/**
 * Every object a deleted page may own: the keys on the row, plus the
 * thumbnail and model keys the worker writes for this page. The row is read
 * without a row lock, so the worker may record its copies between that read
 * and the delete; deleting their fixed keys as well leaves nothing behind.
 */
function pageObjectKeys(page: { id: string; schoolId: string; originalS3Key: string | null; thumbS3Key: string | null; modelS3Key: string | null }) {
  const keys = [page.originalS3Key, page.thumbS3Key, page.modelS3Key, questionPaperKeys.thumb(page.schoolId, page.id), questionPaperKeys.model(page.schoolId, page.id)];
  return [...new Set(keys.filter((key): key is string => key !== null))];
}

async function deletePaperRows(tx: DatabaseTransaction, papers: PaperRow[]): Promise<string[]> {
  if (papers.length === 0) return [];
  const paperIds = papers.map((paper) => paper.id);
  const [pages, figures, versions] = await Promise.all([
    tx.select().from(examQuestionPaperPageTable).where(inArray(examQuestionPaperPageTable.paperId, paperIds)),
    tx.select().from(examQuestionPaperFigureTable).where(inArray(examQuestionPaperFigureTable.paperId, paperIds)),
    // FOR UPDATE: a download storing a version's Word file (or restoring its PDF) sets the version's pointer in its own
    // transaction without the paper lock. Locking the rows here makes the two wait for each other: either that
    // pointer committed first and its artifact is read (and deleted) here, or it waits, finds the version gone and
    // rolls back with its upload deleted. Without the lock its artifact and object would outlive the paper.
    tx
      .select({ pdfArtifactId: examQuestionPaperVersionTable.pdfArtifactId, docxArtifactId: examQuestionPaperVersionTable.docxArtifactId })
      .from(examQuestionPaperVersionTable)
      .where(inArray(examQuestionPaperVersionTable.paperId, paperIds))
      .for('update'),
  ]);
  // Each version's PDF and, once one was downloaded, its Word file.
  const artifactIds = versions.flatMap((version) => [version.pdfArtifactId, version.docxArtifactId]).filter((id): id is string => id !== null);
  const artifacts = artifactIds.length
    ? await tx.select({ id: artifactTable.id, s3Key: artifactTable.s3Key }).from(artifactTable).where(inArray(artifactTable.id, artifactIds))
    : [];
  await tx.delete(examQuestionPaperTable).where(inArray(examQuestionPaperTable.id, paperIds));
  if (artifacts.length) {
    await tx.delete(artifactTable).where(inArray(artifactTable.id, artifacts.map((artifact) => artifact.id)));
  }
  return [
    ...pages.flatMap(pageObjectKeys),
    ...figures.map((figure) => figure.s3Key),
    ...artifacts.map((artifact) => artifact.s3Key),
  ].filter((key): key is string => key !== null);
}

/** Deletes one paper with its pages, figures, versions and PDFs (D25: originals are kept with the paper and go with it). */
export async function deleteQuestionPaper(db: Database, input: { scope: ResolvedPaper }) {
  assertResolvedPaperWritable(input.scope);
  const keys = await db.transaction(async (tx) => {
    await assertResolvedPaperWritableLocked(tx, input.scope);
    const paper = await lockPaperOf(tx, input.scope);
    await assertNoActiveJob(tx, paper.id, 'The paper cannot be deleted');
    const conversations = conversationRefOf(input.scope);
    if (await paperChatIsWorking(tx, conversations)) {
      throw new ORPCError('CONFLICT', { message: 'The assistant is still working on this paper. Stop it, or decide on its change, before deleting the paper.' });
    }
    await unshareConversationsOf(tx, conversations);
    return deletePaperRows(tx, [paper]);
  });
  await deleteObjectsBestEffort(keys);
  return { deleted: true as const };
}

/**
 * Deletes every paper (all modes) of one plan's class and subject, in the
 * caller's transaction. `deleteExamPlan` calls this because a paper has no
 * foreign key to the plan (plans are deleted and regenerated). A running
 * generation goes with its paper: the job row cascades, and the worker stops
 * at its next step when the row is gone. The caller removes the returned
 * objects after its transaction commits (`deleteObjectsBestEffort`).
 */
export async function deleteQuestionPapersOfPlan(
  tx: DatabaseTransaction,
  plan: { schoolId: string; sessionId: string; examSlug: string; classId: string; subjectSlug: string },
): Promise<string[]> {
  const papers = await tx
    .select()
    .from(examQuestionPaperTable)
    .where(
      and(
        eq(examQuestionPaperTable.schoolId, plan.schoolId),
        eq(examQuestionPaperTable.sessionId, plan.sessionId),
        eq(examQuestionPaperTable.examSlug, plan.examSlug),
        eq(examQuestionPaperTable.classId, plan.classId),
        eq(examQuestionPaperTable.subjectSlug, plan.subjectSlug),
      ),
    )
    .for('update');
  // Every mode's conversations, also of a paper that never got a row.
  await unsharePaperConversations(tx, plan);
  return deletePaperRows(tx, papers);
}

/**
 * Stores an uploaded figure image on a paper (design B6): normalised, owned
 * by the paper, at most {@link QUESTION_PAPER_LIMITS.figures} per
 * paper. Used when a chat attachment becomes a figure of a saved version.
 */
export async function addQuestionPaperFigure(
  db: Database,
  input: { scope: ResolvedPaper; userId: string; bytes: Buffer; sourceAttachmentId?: string },
) {
  assertResolvedPaperWritable(input.scope);
  await precheckFigureUpload(db, input.scope);
  const figure = await normalizeFigureImage(input.bytes);
  return storeQuestionPaperFigure(db, {
    scope: input.scope,
    userId: input.userId,
    figure,
    provenance: { sourceAttachmentId: input.sourceAttachmentId ?? null, sourceFigureId: null },
  });
}

/** A print-ready figure image: what {@link normalizeFigureImage} makes, or a stored figure's own bytes and facts. */
export type PreparedFigure = { bytes: Buffer; contentType: string; extension: string; width: number; height: number };

/**
 * Writes a prepared figure as a new figure of the paper: the object under
 * `schools/{schoolId}/exam-question-papers/figures/`, then the row, in a short
 * transaction that re-checks the exam and plan under their locks, locks (or
 * creates) the paper and enforces the figure cap. The object is removed again
 * if the row is refused. `provenance` names where the image came from, each
 * fact in its own column (at most one is set).
 */
export async function storeQuestionPaperFigure(
  db: Database,
  input: {
    scope: ResolvedPaper;
    userId: string;
    figure: PreparedFigure;
    provenance: { sourceAttachmentId: string | null; sourceFigureId: string | null };
  },
) {
  assertResolvedPaperWritable(input.scope);
  const { figure } = input;
  const figureId = generateId('examQuestionPaperFigure');
  const key = questionPaperKeys.figure(paperSchoolIdOf(input.scope), figureId, figure.extension);
  // An early look before the object is written; the transaction below decides.
  await assertPersonalSpaceStorageRoom(db, { schoolId: paperSchoolIdOf(input.scope), addedBytes: figure.bytes.byteLength, lock: false });
  try {
    // Written before the transaction so no lock is held across storage I/O; removed again if the row is refused.
    await putObject(key, figure.bytes, figure.contentType);
    return await db.transaction(async (tx) => {
      await assertResolvedPaperWritableLocked(tx, input.scope);
      const paper = await lockOrCreatePaperOf(tx, input.scope, input.userId);
      const [figures] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(examQuestionPaperFigureTable)
        .where(eq(examQuestionPaperFigureTable.paperId, paper.id));
      if (figures!.count >= QUESTION_PAPER_LIMITS.figures) {
        throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_LIMITS.figures} figure images.`);
      }
      await assertPersonalSpaceStorageRoom(tx, { schoolId: paperSchoolIdOf(input.scope), addedBytes: figure.bytes.byteLength, lock: true });
      const [row] = await tx
        .insert(examQuestionPaperFigureTable)
        .values({
          id: figureId,
          paperId: paper.id,
          schoolId: paperSchoolIdOf(input.scope),
          s3Key: key,
          contentType: figure.contentType,
          byteSize: figure.bytes.byteLength,
          width: figure.width,
          height: figure.height,
          sha256: createHash('sha256').update(figure.bytes).digest('hex'),
          sourceAttachmentId: input.provenance.sourceAttachmentId,
          sourceFigureId: input.provenance.sourceFigureId,
          createdBy: input.userId,
        })
        .returning();
      return row!;
    });
  } catch (error) {
    await deleteObjectsBestEffort([key]);
    throw error;
  }
}

/** `Page 3 (IMG_0042.HEIC) is in a format the AI model cannot read...` for the first page the model cannot read (D46). */
export function unreadablePageMessage(pages: Array<{ position: number; originalName: string; derivativeStatus: string; contentType: string | null }>, mimeTypes: readonly string[]) {
  const page = pages.find((candidate) => candidate.derivativeStatus === 'unsupported' && !mimeTypes.includes(candidate.contentType ?? ''));
  return page
    ? `Page ${page.position} (${page.originalName}) is in a format the AI model cannot read. Convert it to JPEG and upload it again.`
    : null;
}

/**
 * Why the pages cannot be generated from yet, for the first page that is not
 * ready: its photo is still on its way (`awaiting`), the worker has not made
 * its copies yet (`pending`), or it could not be read (`failed`). Null when
 * every page is `ready` or `unsupported` (the latter is then judged by
 * {@link unreadablePageMessage}). Generation never starts on part of a paper.
 */
export function pageNotReadyMessage(pages: ReadonlyArray<{ position: number; originalName: string; uploadStatus: string; derivativeStatus: string }>) {
  for (const page of pages) {
    if (page.uploadStatus === 'awaiting') {
      return `Page ${page.position} (${page.originalName}) is still uploading. Wait for it to finish, or remove it, then generate.`;
    }
    if (page.derivativeStatus === 'pending') {
      return `Page ${page.position} (${page.originalName}) is still being processed. Try again in a moment.`;
    }
    if (page.derivativeStatus === 'failed') {
      return `Page ${page.position} (${page.originalName}) could not be read as an image. Remove it and upload it again.`;
    }
  }
  return null;
}

/**
 * Refuses a new job while the school already has its cap of queued or running
 * ones: `QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL` for a real school,
 * `PERSONAL_SPACE_MAX_RUNNING_JOBS` for a personal space (decided from the
 * school's kind, docs/personal-space.md "Limits"). The
 * monthly AI limit is checked against a cached spend sum, so the number of
 * jobs that can pass that check on the same stale value has to be bounded
 * here. A transaction-scoped advisory lock on the school makes the count and
 * the insert that follows exact across papers (a paper's own row lock does
 * not serialize two different papers). Taken after the paper lock; nothing
 * takes them in the other order.
 */
async function assertSchoolJobCapacity(tx: DatabaseTransaction, schoolId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`question-paper-jobs:${schoolId}`}, 0))`);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(examQuestionPaperJobTable)
    .where(and(eq(examQuestionPaperJobTable.schoolId, schoolId), inArray(examQuestionPaperJobTable.status, ['queued', 'running'])));
  const personal = (await readSchoolKind(tx, schoolId)) === 'personal';
  const cap = personal ? PERSONAL_SPACE_MAX_RUNNING_JOBS : assistantEnv.QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL;
  if ((row?.count ?? 0) >= cap) {
    const holder = personal ? 'Your personal space' : 'Your school';
    throw rpcError.conflict(
      `${holder} already has ${cap} AI generation${cap === 1 ? '' : 's'} running. Wait for ${cap === 1 ? 'it' : 'one'} to finish, then generate this paper.`,
    );
  }
}

/**
 * Queues an AI generation for a paper (the manual UI's path; chat agents
 * author papers themselves). Checked, in order and before any cost: a model
 * is configured, the school chose a template, the paper has pages and the
 * caller saw their current order (`expectedPageRevision`), every page's photo
 * has arrived and been processed by the worker, no page is in a
 * format the configured model cannot read (the user hears it now, not after
 * the job failed; pages are never silently dropped), and no generation is
 * already in flight. The job row is the outbox entry; the hand-over to the
 * worker happens after the commit and never blocks the request.
 *
 * `instructions` are the teacher's optional note on what to change (already
 * normalised by `generationInstructionsSchema`: trimmed, null for none). They
 * are stored on the job row as written and never changed; the worker reads
 * them from there, so every attempt of the job uses the same text. They change
 * no check, limit or cost rule above.
 */
export async function startQuestionPaperGeneration(
  db: Database,
  input: {
    scope: ResolvedPaper;
    userId: string;
    expectedPageRevision: number;
    /** The teacher's instructions; null or omitted for none. */
    instructions?: string | null;
    /** Hands a committed job to the worker; the default is the outbox hand-over. Tests replace it. */
    dispatch?: (jobId: string) => void;
  },
) {
  const { scope } = input;
  assertResolvedPaperWritable(scope);
  const model = getQuestionPaperModel();
  if (!model) throw providerUnavailableError();
  // A plain paper (a personal space's) prints in the built-in shell: it needs no template. Every other paper, a quick
  // paper of a school included, prints with the school's selected template.
  if (printLayoutOf(scope) !== 'plain' && !(await hasSelectedQuestionPaperTemplate(db, paperSchoolIdOf(scope)))) throw templateMissingError();
  const jobId = await db.transaction(async (tx) => {
    await assertResolvedPaperWritableLocked(tx, scope);
    const paper = await lockPaperOf(tx, scope).catch((error: unknown) => {
      throw error instanceof ORPCError && error.status === 404 ? rpcError.badRequest('Upload at least one page before generating.') : error;
    });
    assertPageRevision(paper, input.expectedPageRevision);
    const pages = await pagesOf(tx, paper.id);
    if (pages.length === 0) throw rpcError.badRequest('Upload at least one page before generating.');
    const notReady = pageNotReadyMessage(pages);
    if (notReady) throw rpcError.badRequest(notReady);
    const unreadable = unreadablePageMessage(pages, model.imageMimeTypes);
    if (unreadable) throw rpcError.badRequest(unreadable);
    if (await activeJobOf(tx, paper.id)) throw rpcError.conflict('A generation is already running for this paper.');
    await assertSchoolJobCapacity(tx, paperSchoolIdOf(scope));
    if (isStandalonePaper(scope)) {
      // The job saves a version and its PDF: refused now, before any model cost, when it could not be saved (a
      // personal space's limits; both return at once for a real school, which has none).
      await assertStandaloneVersionRoom(tx, { schoolId: paperSchoolIdOf(scope), paperId: paper.id, countsTowardRate: false, lock: true });
      await assertPersonalSpaceStorageRoom(tx, { schoolId: paperSchoolIdOf(scope), addedBytes: 0, lock: true });
    }
    const [job] = await tx
      .insert(examQuestionPaperJobTable)
      .values({
        paperId: paper.id,
        schoolId: paperSchoolIdOf(scope),
        requestedBy: input.userId,
        pageIds: pages.map((page) => page.id),
        pageRevision: paper.pageRevision,
        instructions: input.instructions ?? null,
      })
      .returning({ id: examQuestionPaperJobTable.id });
    return job!.id;
  });
  const dispatch = input.dispatch ?? ((id: string) => handOff('dispatch', () => dispatchQuestionPaperJob(db, id)));
  dispatch(jobId);
  return { jobId, status: 'queued' as const };
}
