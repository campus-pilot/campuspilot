import { createHash } from 'node:crypto';

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
import { ORPCError } from '@orpc/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import { getExamSession } from '../exam/exam.service';
import { latestPaperConversationId } from './question-paper.conversations';
import { makeImageDerivatives, normalizeFigureImage } from '../../../files/image-derivative';
import { getQuestionPaperModel } from '../../../workflows/question-paper/model';
import { handOff, dispatchQuestionPaperJob } from '../../../workflows/question-paper/outbox';
import {
  QUESTION_PAPER_MAX_PAGES,
  type PaperKey,
  type detailOutputSchema,
  type getQuestionPaperOutputSchema,
  type listQuestionPapersOutputSchema,
} from './question-paper.dto';
import {
  activeJobOf,
  assertNoActiveJob,
  findPaper,
  lastFinishedJobOf,
  lockOrCreatePaper,
  lockPaper,
  pagesOf,
  providerUnavailableError,
  templateMissingError,
  toPageDto,
  toVersionSummaries,
  versionsOf,
  type PaperRow,
} from './question-paper.records';
import { hasSelectedQuestionPaperTemplate } from './question-paper.render';
import { assertPaperWritable, assertPaperWritableLocked, type PaperScope } from './question-paper.scope';
import { deleteObjectsBestEffort, putObject, questionPaperKeys } from './question-paper.storage';
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

/** `getQuestionPaper`: the paper, its pages and one version (the latest unless named). */
export async function getQuestionPaper(
  db: DatabaseExecutor,
  scope: PaperScope,
  versionNo: number | undefined,
): Promise<z.infer<typeof getQuestionPaperOutputSchema>> {
  const view = await loadPaperView(db, scope);
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
    latestPaperConversationId(db, scope.key),
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
export async function listQuestionPaperVersions(db: DatabaseExecutor, scope: PaperScope) {
  const paper = await findPaper(db, scope.key);
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
async function precheckPageUpload(db: Database, key: PaperKey) {
  const paper = await findPaper(db, key);
  if (!paper) return;
  const [pages, active] = await Promise.all([pagesOf(db, paper.id), activeJobOf(db, paper.id)]);
  if (pages.length >= QUESTION_PAPER_MAX_PAGES) throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_MAX_PAGES} pages.`);
  if (active) await assertNoActiveJob(db, paper.id, 'Pages cannot be added');
}

/** The same unlocked look for a figure: a paper that already holds its figures refuses before anything is written. */
async function precheckFigureUpload(db: Database, key: PaperKey) {
  const paper = await findPaper(db, key);
  if (!paper) return;
  const [figures] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(examQuestionPaperFigureTable)
    .where(eq(examQuestionPaperFigureTable.paperId, paper.id));
  if (figures!.count >= QUESTION_PAPER_LIMITS.figures) {
    throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_LIMITS.figures} figure images.`);
  }
}

/**
 * Stores one uploaded photo as the paper's next page (the upload route, after
 * it has checked permission, access and the file). The objects are written
 * first, with no lock held (a slow storage write must not hold the school's
 * session row, which every exam service queues behind); a short transaction
 * then re-checks the exam and plan under their locks, locks the paper so the
 * page cap and the page order are exact, and inserts the row. The objects are
 * removed again if any of that fails, so a refused upload leaves nothing.
 */
export async function addQuestionPaperPage(
  db: Database,
  input: {
    scope: PaperScope;
    userId: string;
    file: { bytes: Buffer; contentType: string; extension: string; name: string };
  },
) {
  const { scope, file } = input;
  assertPaperWritable(scope);
  await precheckPageUpload(db, scope.key);
  const derivatives = await makeImageDerivatives(file.bytes, file.contentType);
  const pageId = generateId('examQuestionPaperPage');
  const { schoolId } = scope.key;
  const originalKey = questionPaperKeys.original(schoolId, pageId, file.extension);
  const thumbKey = derivatives.status === 'ready' ? questionPaperKeys.thumb(schoolId, pageId) : null;
  const modelKey = derivatives.status === 'ready' ? questionPaperKeys.model(schoolId, pageId) : null;
  const written = [originalKey, thumbKey, modelKey].filter((key): key is string => key !== null);
  try {
    await putObject(originalKey, file.bytes, file.contentType);
    if (derivatives.status === 'ready') {
      await putObject(thumbKey!, derivatives.thumb.bytes, derivatives.thumb.contentType);
      await putObject(modelKey!, derivatives.model.bytes, derivatives.model.contentType);
    }
    return await db.transaction(async (tx) => {
      await assertPaperWritableLocked(tx, scope.key);
      const paper = await lockOrCreatePaper(tx, scope.key, input.userId);
      const existing = await pagesOf(tx, paper.id);
      if (existing.length >= QUESTION_PAPER_MAX_PAGES) {
        throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_MAX_PAGES} pages.`);
      }
      await assertNoActiveJob(tx, paper.id, 'Pages cannot be added');
      const [page] = await tx
        .insert(examQuestionPaperPageTable)
        .values({
          id: pageId,
          paperId: paper.id,
          schoolId,
          position: existing.length + 1,
          originalS3Key: originalKey,
          originalName: sanitizeFileName(file.name),
          contentType: file.contentType,
          byteSize: file.bytes.byteLength,
          sha256: createHash('sha256').update(file.bytes).digest('hex'),
          width: derivatives.width,
          height: derivatives.height,
          derivativeStatus: derivatives.status === 'ready' ? 'ready' : 'unsupported',
          thumbS3Key: thumbKey,
          modelS3Key: modelKey,
          modelContentType: derivatives.status === 'ready' ? derivatives.model.contentType : null,
          modelByteSize: derivatives.status === 'ready' ? derivatives.model.bytes.byteLength : null,
          uploadedBy: input.userId,
        })
        .returning();
      const [bumped] = await tx
        .update(examQuestionPaperTable)
        .set({ pageRevision: sql`${examQuestionPaperTable.pageRevision} + 1`, updatedAt: new Date() })
        .where(eq(examQuestionPaperTable.id, paper.id))
        .returning({ pageRevision: examQuestionPaperTable.pageRevision });
      return { page: toPageDto(page!), pageRevision: bumped!.pageRevision };
    });
  } catch (error) {
    await deleteObjectsBestEffort(written);
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
  input: { scope: PaperScope; pageIds: string[]; expectedPageRevision: number },
) {
  assertPaperWritable(input.scope);
  return db.transaction(async (tx) => {
    await assertPaperWritableLocked(tx, input.scope.key);
    const paper = await lockPaper(tx, input.scope.key);
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
  input: { scope: PaperScope; pageId: string; expectedPageRevision: number },
) {
  assertPaperWritable(input.scope);
  const { pageRevision, keys } = await db.transaction(async (tx) => {
    await assertPaperWritableLocked(tx, input.scope.key);
    const paper = await lockPaper(tx, input.scope.key);
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
    return { pageRevision: bumped!.pageRevision, keys: [page.originalS3Key, page.thumbS3Key, page.modelS3Key] };
  });
  await deleteObjectsBestEffort(keys);
  return { pageRevision };
}

/**
 * Deletes the papers matched by `where` inside the caller's transaction:
 * rows (pages, jobs, versions and figures cascade), the PDF artifacts of
 * their versions, and returns every object key to remove after the commit.
 * Template revisions are shared with other versions and are never deleted.
 */
async function deletePaperRows(tx: DatabaseTransaction, papers: PaperRow[]): Promise<string[]> {
  if (papers.length === 0) return [];
  const paperIds = papers.map((paper) => paper.id);
  const [pages, figures, versions] = await Promise.all([
    tx.select().from(examQuestionPaperPageTable).where(inArray(examQuestionPaperPageTable.paperId, paperIds)),
    tx.select().from(examQuestionPaperFigureTable).where(inArray(examQuestionPaperFigureTable.paperId, paperIds)),
    tx.select({ pdfArtifactId: examQuestionPaperVersionTable.pdfArtifactId }).from(examQuestionPaperVersionTable).where(inArray(examQuestionPaperVersionTable.paperId, paperIds)),
  ]);
  const artifactIds = versions.map((version) => version.pdfArtifactId).filter((id): id is string => id !== null);
  const artifacts = artifactIds.length
    ? await tx.select({ id: artifactTable.id, s3Key: artifactTable.s3Key }).from(artifactTable).where(inArray(artifactTable.id, artifactIds))
    : [];
  await tx.delete(examQuestionPaperTable).where(inArray(examQuestionPaperTable.id, paperIds));
  if (artifacts.length) {
    await tx.delete(artifactTable).where(inArray(artifactTable.id, artifacts.map((artifact) => artifact.id)));
  }
  return [
    ...pages.flatMap((page) => [page.originalS3Key, page.thumbS3Key, page.modelS3Key]),
    ...figures.map((figure) => figure.s3Key),
    ...artifacts.map((artifact) => artifact.s3Key),
  ].filter((key): key is string => key !== null);
}

/** Deletes one paper with its pages, figures, versions and PDFs (D25: originals are kept with the paper and go with it). */
export async function deleteQuestionPaper(db: Database, input: { scope: PaperScope }) {
  assertPaperWritable(input.scope);
  const keys = await db.transaction(async (tx) => {
    await assertPaperWritableLocked(tx, input.scope.key);
    const paper = await lockPaper(tx, input.scope.key);
    await assertNoActiveJob(tx, paper.id, 'The paper cannot be deleted');
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
  return deletePaperRows(tx, papers);
}

/**
 * Stores an uploaded figure image on a paper (design B6): normalised, owned
 * by the paper, at most {@link QUESTION_PAPER_LIMITS.figures} per
 * paper. Used when a chat attachment becomes a figure of a saved version.
 */
export async function addQuestionPaperFigure(
  db: Database,
  input: { scope: PaperScope; userId: string; bytes: Buffer; sourceAttachmentId?: string },
) {
  assertPaperWritable(input.scope);
  await precheckFigureUpload(db, input.scope.key);
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
    scope: PaperScope;
    userId: string;
    figure: PreparedFigure;
    provenance: { sourceAttachmentId: string | null; sourceFigureId: string | null };
  },
) {
  assertPaperWritable(input.scope);
  const { figure } = input;
  const figureId = generateId('examQuestionPaperFigure');
  const key = questionPaperKeys.figure(input.scope.key.schoolId, figureId, figure.extension);
  try {
    // Written before the transaction so no lock is held across storage I/O; removed again if the row is refused.
    await putObject(key, figure.bytes, figure.contentType);
    return await db.transaction(async (tx) => {
      await assertPaperWritableLocked(tx, input.scope.key);
      const paper = await lockOrCreatePaper(tx, input.scope.key, input.userId);
      const [figures] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(examQuestionPaperFigureTable)
        .where(eq(examQuestionPaperFigureTable.paperId, paper.id));
      if (figures!.count >= QUESTION_PAPER_LIMITS.figures) {
        throw rpcError.badRequest(`A paper can have at most ${QUESTION_PAPER_LIMITS.figures} figure images.`);
      }
      const [row] = await tx
        .insert(examQuestionPaperFigureTable)
        .values({
          id: figureId,
          paperId: paper.id,
          schoolId: input.scope.key.schoolId,
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
export function unreadablePageMessage(pages: Array<{ position: number; originalName: string; derivativeStatus: string; contentType: string }>, mimeTypes: readonly string[]) {
  const page = pages.find((candidate) => candidate.derivativeStatus === 'unsupported' && !mimeTypes.includes(candidate.contentType));
  return page
    ? `Page ${page.position} (${page.originalName}) is in a format the AI model cannot read. Convert it to JPEG and upload it again.`
    : null;
}

/**
 * Refuses a new job while the school already has
 * `QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL` queued or running ones. The
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
  const cap = assistantEnv.QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL;
  if ((row?.count ?? 0) >= cap) {
    throw rpcError.conflict(
      `Your school already has ${cap} AI generation${cap === 1 ? '' : 's'} running. Wait for one to finish, then generate this paper.`,
    );
  }
}

/**
 * Queues an AI generation for a paper (the manual UI's path; chat agents
 * author papers themselves). Checked, in order and before any cost: a model
 * is configured, the school chose a template, the paper has pages and the
 * caller saw their current order (`expectedPageRevision`), no page is in a
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
    scope: PaperScope;
    userId: string;
    expectedPageRevision: number;
    /** The teacher's instructions; null or omitted for none. */
    instructions?: string | null;
    /** Hands a committed job to the worker; the default is the outbox hand-over. Tests replace it. */
    dispatch?: (jobId: string) => void;
  },
) {
  const { scope } = input;
  assertPaperWritable(scope);
  const model = getQuestionPaperModel();
  if (!model) throw providerUnavailableError();
  if (!(await hasSelectedQuestionPaperTemplate(db, scope.key.schoolId))) throw templateMissingError();
  const jobId = await db.transaction(async (tx) => {
    await assertPaperWritableLocked(tx, scope.key);
    const paper = await lockPaper(tx, scope.key).catch((error: unknown) => {
      throw error instanceof ORPCError && error.status === 404 ? rpcError.badRequest('Upload at least one page before generating.') : error;
    });
    assertPageRevision(paper, input.expectedPageRevision);
    const pages = await pagesOf(tx, paper.id);
    if (pages.length === 0) throw rpcError.badRequest('Upload at least one page before generating.');
    const unreadable = unreadablePageMessage(pages, model.imageMimeTypes);
    if (unreadable) throw rpcError.badRequest(unreadable);
    if (await activeJobOf(tx, paper.id)) throw rpcError.conflict('A generation is already running for this paper.');
    await assertSchoolJobCapacity(tx, scope.key.schoolId);
    const [job] = await tx
      .insert(examQuestionPaperJobTable)
      .values({
        paperId: paper.id,
        schoolId: scope.key.schoolId,
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
