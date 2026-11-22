import { encodedImageBytes, MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES } from '@campuspilot/assistant-contract/attachments';
import { ORPCError } from '@orpc/server';
import { db as defaultDb, type Database } from '@campuspilot/db';
import { examQuestionPaperJobTable, examQuestionPaperPageTable, examQuestionPaperTable, examQuestionPaperVersionTable } from '@campuspilot/db/schema/exam-question-paper';
import { env } from '@campuspilot/env/assistant';
import { withTimingScope } from '@campuspilot/logger/perf';
import { splitQuestionPaperDetails, type QuestionPaperDetails } from '@campuspilot/question-paper/details';
import { extractQuestionPaperFragment, hasPaperContent, questionPaperFragmentShapeProblem } from '@campuspilot/question-paper/fragment';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { resolveAssistantAccess } from '../../assistant/access';
import { SCHOOL_SUSPENDED_REASON, schoolWriteRefusalMessageOf } from '../../school-access/school-access.contract';
import { readSchoolWriteFacts, resolveSchoolWriteRefusal, schoolKindForRefusal } from '../../school-access/school-access.service';
import type { PaperKey, TemplatePrints } from '../../routers/school/question-paper/question-paper.dto';
import { hasSelectedQuestionPaperTemplate } from '../../routers/school/question-paper/question-paper.render';
import { readTemplatePrints } from '../../routers/school/question-paper/question-paper.template-prints';
import {
  assertPaperWritable,
  isPaperLockedError,
  isPlanModeRemovedError,
  findStandalonePaperScope,
  isStandalonePaper,
  printLayoutOf,
  resolvePaperScope,
  type ResolvedPaper,
} from '../../routers/school/question-paper/question-paper.scope';
import { examKeyPart } from '../../routers/school/question-paper/question-paper.records';
import { STANDALONE_QUESTION_PAPER_PRINTS } from '../../routers/school/question-paper/question-paper.standalone-shell';
import { pageNotReadyMessage, unreadablePageMessage } from '../../routers/school/question-paper/question-paper.service';
import { getObjectBytes } from '../../routers/school/question-paper/question-paper.storage';
import { renameReservedClasses } from '../../routers/school/question-paper/question-paper.sanitize';
import { checkQuestionPaperDraft, saveQuestionPaperVersion, SourceJobEndedError } from '../../routers/school/question-paper/question-paper.version.service';
import { personalSpaceLimitOf } from '../../personal-space/personal-space.limits';
import { QUESTION_PAPER_JOB_FAILURES, type QuestionPaperJobErrorCode } from './constants';
import { nextQuestionPaperRequestKey, recordQuestionPaperRequest } from './cost';
import type { QuestionPaperJobInput } from './input';
import { log } from './log';
import { getQuestionPaperFigureRoute, getQuestionPaperModel, type QuestionPaperFigureRoute, type QuestionPaperModel, type TextPart, type TextResult } from './model';
import { describeError } from './error-detail';
import { buildGenerationParts, buildRepairParts, FIGURE_DECISION_QUESTION, FIGURE_DECISION_THRESHOLD, questionPaperJobSystemPrompt } from './prompt';

/**
 * The body of the generation job, shared by the Restate workflow
 * (`workflow.ts`) and the integration tests so both run exactly the same
 * sequence. Every unit of work goes through `step`, which Restate journals;
 * only small values (ids, counts, the model's text) are returned from
 * steps. Images are read inside the model step and never journaled.
 *
 * Sequence (design F6): begin, access, inputs, route (on the figure route
 * only: one decision request, with its cost), model call, cost, validate, at
 * most one repair (call, cost, validate), save, succeed. Anything that
 * cannot succeed ends the job as `failed` with a code and a safe message
 * (`QUESTION_PAPER_JOB_FAILURES`); the workflow then returns normally, because
 * the job row, not the invocation, is where the user reads the outcome.
 */

/** Calls the model makes for one request: the first, plus retries of a busy or unknown failure. */
const MODEL_ATTEMPTS = 3;
/** Waits before the second and third attempt. */
const DEFAULT_RETRY_DELAYS_MS = [5_000, 20_000] as const;
/**
 * Total size of the page images in one request, counted as the providers
 * receive them (base64, 4/3 of the file, the same budget and helper as the
 * chat context); over it the job fails before any cost (design F5).
 */
export const QUESTION_PAPER_MAX_REQUEST_IMAGE_BYTES = MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES;
/** Most problems kept from a validation (they are journaled and sent to the repair call). */
const MAX_PROBLEMS = 50;

/** A job outcome that is a failure the user should read. */
export class QuestionPaperJobFailure extends Error {
  constructor(
    readonly code: QuestionPaperJobErrorCode,
    /** Safe user-facing text. */
    message: string = QUESTION_PAPER_JOB_FAILURES[code],
    /** Raw detail for developers; stored in `error_detail`, never shown. */
    readonly detail: string | null = null,
  ) {
    super(message);
  }
}

/** The job is no longer the live attempt (swept, retried or deleted): stop quietly. */
class JobStopped extends Error {}

/** A journaled step's result: a value, a failure to report, or a stop. */
type StepResult<T> = { ok: true; value: T } | { ok: false; failure: { code: QuestionPaperJobErrorCode; message: string; detail: string | null } } | { ok: false; stopped: true };

export type StepOptions = { maxRetryAttempts?: number };
/** Runs one named, idempotent unit of work; Restate journals it, tests call it directly. */
export type StepRunner = <T>(name: string, action: () => Promise<T>, options?: StepOptions) => Promise<T>;

export type GenerationOutcome =
  | { status: 'succeeded'; versionNo: number }
  | { status: 'failed'; code: QuestionPaperJobErrorCode }
  | { status: 'skipped' };

/** The seams a test replaces; the defaults are the real database, storage and model. */
export type GenerationDeps = {
  db: Database;
  getModel: () => QuestionPaperModel | undefined;
  getFigureRoute: () => QuestionPaperFigureRoute | undefined;
  readObject: (key: string) => Promise<Uint8Array>;
  save: typeof saveQuestionPaperVersion;
  sleep: (ms: number) => Promise<void>;
  retryDelaysMs: readonly number[];
  maxOutputTokens: number;
};

export function defaultGenerationDeps(): GenerationDeps {
  return {
    db: defaultDb,
    getModel: getQuestionPaperModel,
    getFigureRoute: getQuestionPaperFigureRoute,
    readObject: getObjectBytes,
    save: saveQuestionPaperVersion,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
    maxOutputTokens: env.QUESTION_PAPER_MAX_OUTPUT_TOKENS,
  };
}

/**
 * What the begin step returns: the job's facts, none of them large. The
 * teacher's instructions (at most 2,000 characters) are journaled with them, so
 * a replay sends exactly the text the first run read. A journal written before
 * the field existed has no `instructions`; read it through {@link instructionsOf}.
 */
type BegunJob = {
  /** The exam paper's key; null for a standalone paper, which has none. */
  key: PaperKey | null;
  /**
   * The paper's kind (docs/personal-space.md). A journal written before
   * standalone papers existed has none: that job is an exam paper's.
   */
  paperKind?: 'exam' | 'standalone';
  paperId: string;
  schoolId: string;
  requestedBy: string;
  pageIds: string[];
  instructions?: string | null;
};

/** Whether a begun job writes a standalone paper (absent kind: an exam paper, journaled before the kind existed). */
const isStandaloneJob = (begun: BegunJob): boolean => begun.paperKind === 'standalone';

/** The job's instructions, null for none (also for a begin step journaled before they existed: such a job had none). */
const instructionsOf = (begun: BegunJob): string | null => begun.instructions ?? null;

type PlannedPage = { id: string; position: number; name: string; key: string; mimeType: string };
/**
 * What the inputs step returns. `templatePrints` is what the school's
 * template prints around this paper (null: not known), read once here and
 * journaled, so the first request and every retry of it tell the model the
 * same lines even if the school changes its template or its name meanwhile.
 * A journal written before the field existed has none; read it through
 * {@link templatePrintsOfPlan}.
 */
type Plan = { scope: ResolvedPaper; pages: PlannedPage[]; templatePrints?: TemplatePrints | null };

/** The plan's template lines, null for not known (also for an inputs step journaled before they existed). */
const templatePrintsOfPlan = (plan: Plan): TemplatePrints | null => plan.templatePrints ?? null;

/**
 * What the route step returns: whether the paper is written on the figure
 * route, and the decision model's probability of a diagram (null when no
 * decision was made: the route is off, or the decision request failed).
 */
type Route = { figures: boolean; probability: number | null };

/** A model answer as journaled. */
type ModelAnswer = Pick<TextResult, 'text' | 'usage' | 'answeredModel' | 'refusal' | 'unfinished'>;

/** The outcome of checking an answer: the fragment to save, or the problems to repair. */
type Validation =
  /**
   * `details`: what a standalone paper's answer said about the paper
   * (`paper-details` block), with `detailsFound` false when it had none; both
   * absent for an exam paper.
   */
  | { ok: true; html: string; details?: QuestionPaperDetails; detailsFound?: boolean }
  /** `rejected`: the answer is a refusal or chatter, not a paper to repair (the job fails as `model_rejected`). */
  | { ok: false; html: string; problems: string[]; rejected?: true };

/** How a refusal by the assistant gate maps to a job failure. */
function accessFailure(code: string): QuestionPaperJobErrorCode {
  if (code === 'limit_reached') return 'limit_reached';
  if (code === 'feature_disabled') return 'feature_disabled';
  if (code === 'school_suspended') return 'school_suspended';
  if (code === 'no_plan') return 'no_plan';
  return 'role_not_enabled';
}

/**
 * Fails the job when its school became read-only while it ran (suspended, or
 * a trial ended without a subscription). Asked before every model request
 * and before the save, next to the job's own liveness, so a job already
 * running neither spends more nor saves a version. Only the school's write
 * facts, not the whole assistant decision: a school that reached its AI limit
 * with the last request still saves the paper it paid for.
 */
async function assertSchoolStillWritable(db: Database, schoolId: string): Promise<void> {
  const facts = await readSchoolWriteFacts(db, schoolId);
  const refusal = facts ? resolveSchoolWriteRefusal(facts) : null;
  if (!refusal) return;
  const code = refusal === SCHOOL_SUSPENDED_REASON ? 'school_suspended' : 'no_plan';
  // A personal space's owner reads the refusal in their space's words (docs/personal-space.md), never about a school.
  const kind = await schoolKindForRefusal(db, schoolId);
  throw new QuestionPaperJobFailure(code, kind === 'personal' ? schoolWriteRefusalMessageOf(refusal, kind) : QUESTION_PAPER_JOB_FAILURES[code]);
}

/** The failure for a model request that failed for good, by what the provider said about it. */
function modelFailure(kind: ReturnType<QuestionPaperModel['failureKind']>, error: unknown): QuestionPaperJobFailure {
  const code = { rejected: 'model_rejected', unavailable: 'provider_unavailable', busy: 'model_busy', unknown: 'model_error' } as const;
  return new QuestionPaperJobFailure(code[kind], undefined, describeError(error));
}

/** Whether this is still the live attempt of a job that has not ended. */
async function jobIsLive(db: Database, input: QuestionPaperJobInput): Promise<boolean> {
  const [job] = await db
    .select({ id: examQuestionPaperJobTable.id })
    .from(examQuestionPaperJobTable)
    .where(
      and(
        eq(examQuestionPaperJobTable.id, input.jobId),
        eq(examQuestionPaperJobTable.attempt, input.attempt),
        eq(examQuestionPaperJobTable.status, 'running'),
      ),
    )
    .limit(1);
  return Boolean(job);
}

/**
 * Runs one attempt of a generation job. Never throws for a job that cannot
 * succeed (that is a recorded failure); throws only when recording itself
 * fails, which Restate retries.
 */
export async function runQuestionPaperGeneration(
  input: QuestionPaperJobInput,
  step: StepRunner,
  deps: GenerationDeps = defaultGenerationDeps(),
): Promise<GenerationOutcome> {
  const { db } = deps;
  let phase: 'prepare' | 'model' | 'save' = 'prepare';

  /** A step whose business failures are values, so Restate never retries them. */
  const run = async <T>(name: string, action: () => Promise<T>, options?: StepOptions): Promise<T> => {
    const result = await step<StepResult<T>>(
      name,
      async () => {
        try {
          return { ok: true, value: await action() };
        } catch (error) {
          if (error instanceof JobStopped) return { ok: false, stopped: true };
          if (error instanceof QuestionPaperJobFailure) return { ok: false, failure: { code: error.code, message: error.message, detail: error.detail } };
          throw error;
        }
      },
      options,
    );
    if (result.ok) return result.value;
    if ('stopped' in result) throw new JobStopped();
    throw new QuestionPaperJobFailure(result.failure.code, result.failure.message, result.failure.detail);
  };

  try {
    // A worker without a provider still serves this workflow, so a queued job
    // ends with a clear failure instead of waiting forever.
    const model = deps.getModel();
    if (!model) throw new QuestionPaperJobFailure('provider_unavailable');
    const begun = await run('begin', () => beginJob(deps, input, model));
    if (!begun) return { status: 'skipped' };

    await run('access', () => assertAccess(deps, begun));
    const plan = await run('inputs', () => planInputs(deps, begun, model));

    phase = 'model';
    const figureRoute = deps.getFigureRoute();
    const route = await run('route', () => chooseRoute(deps, input, begun, plan, figureRoute));
    // A journaled "figures" whose route was switched off since is written by the question paper model.
    const writer = route.figures && figureRoute ? figureRoute.model : model;
    const redrawFigures = writer !== model;
    const first = await runModelRequest({ deps, run, model: writer, redrawFigures, input, begun, plan, n: 1, parts: null });
    if (first.refusal) throw new QuestionPaperJobFailure('model_rejected', undefined, 'The model declined to answer.');
    if (first.unfinished) throw new QuestionPaperJobFailure('output_too_long', undefined, 'The answer stopped on the output limit.');

    // A repair of the first answer also asks for a standalone paper's missing details block; a repaired answer need not have one.
    let validation = await run('validate:1', () => validateAnswer(deps, plan, first.text, { requireDetails: true }));
    // The details of the first answer, for a repaired answer that leaves its details block out.
    const firstDetails = validation.ok ? undefined : detailsOfAnswer(plan, first.text);
    if (!validation.ok && validation.rejected) {
      throw new QuestionPaperJobFailure('model_rejected', undefined, `The model answered without an HTML fragment: ${validation.html.slice(0, 200)}`);
    }
    if (!validation.ok) {
      // One repair, text only; a second failure ends the job (no loop).
      await run('access:2', () => assertAccess(deps, begun));
      const repair = await runModelRequest({
        deps,
        run,
        model: writer,
        redrawFigures,
        input,
        begun,
        plan,
        n: 2,
        parts: buildRepairParts(validation.html, validation.problems, { instructed: instructionsOf(begun) !== null, standalone: isStandalonePaper(plan.scope) }),
      });
      if (repair.refusal) throw new QuestionPaperJobFailure('model_rejected', undefined, 'The model declined the repair request.');
      if (repair.unfinished) throw new QuestionPaperJobFailure('output_too_long', undefined, 'The repaired answer stopped on the output limit.');
      validation = await run('validate:2', () => validateAnswer(deps, plan, repair.text, { requireDetails: false }));
      if (!validation.ok && validation.rejected) {
        throw new QuestionPaperJobFailure('model_rejected', undefined, `The model answered the repair request without an HTML fragment: ${validation.html.slice(0, 200)}`);
      }
      if (!validation.ok) {
        throw new QuestionPaperJobFailure('invalid_output', undefined, validation.problems.slice(0, 10).join('; '));
      }
    }

    phase = 'save';
    const details = isStandalonePaper(plan.scope) ? savedDetails(validation, firstDetails) : undefined;
    const saved = await run('save', () => savePaper(deps, input, begun, plan, validation.html, details), { maxRetryAttempts: 4 });
    await run('succeed', () => markSucceeded(deps, input));
    return { status: 'succeeded', versionNo: saved.versionNo };
  } catch (error) {
    if (error instanceof JobStopped) return { status: 'skipped' };
    const failure = error instanceof QuestionPaperJobFailure ? error : unexpectedFailure(error, phase);
    log.warn({ jobId: input.jobId, attempt: input.attempt, code: failure.code, phase }, 'question-paper.job.failed');
    await step('fail', () => markFailed(db, input, failure));
    return { status: 'failed', code: failure.code };
  }
}

/** What a standalone paper's answer says about the paper; undefined for an exam paper. Pure, so it needs no step of its own. */
function detailsOfAnswer(plan: Plan, text: string): { details: QuestionPaperDetails; found: boolean } | undefined {
  if (!isStandalonePaper(plan.scope)) return undefined;
  const split = splitQuestionPaperDetails(text);
  return { details: split.details, found: split.found };
}

/**
 * What a standalone paper's version does to the paper's details: replaces
 * them with those of the answer that passed, or, when that was a repair that
 * left its block out, with those of the first answer; `keep` when neither
 * answer had a readable block (a version that states no details does not
 * change them, docs/personal-space.md).
 */
function savedDetails(validation: Validation, first: { details: QuestionPaperDetails; found: boolean } | undefined): QuestionPaperDetails | 'keep' {
  if (validation.ok && validation.detailsFound && validation.details) return validation.details;
  return first?.found ? first.details : 'keep';
}

/**
 * An error no step recognised, after Restate gave up retrying it. In the save
 * phase that is almost always the PDF (Gotenberg) or its storage.
 */
function unexpectedFailure(error: unknown, phase: 'prepare' | 'model' | 'save'): QuestionPaperJobFailure {
  return new QuestionPaperJobFailure(phase === 'save' ? 'pdf_failed' : 'internal_error', undefined, describeError(error));
}

/**
 * Moves the job to `running` for this attempt. Null when it is not a queued or
 * running job of this attempt (already ended, retried or swept): nothing runs.
 * `started_at` is kept across a replay so the sweep's timeout counts from the
 * first start.
 */
async function beginJob(deps: GenerationDeps, input: QuestionPaperJobInput, model: QuestionPaperModel): Promise<BegunJob | null> {
  const { db } = deps;
  const [job] = await db
    .select()
    .from(examQuestionPaperJobTable)
    .where(and(eq(examQuestionPaperJobTable.id, input.jobId), eq(examQuestionPaperJobTable.attempt, input.attempt)))
    .limit(1);
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return null;
  const [paper] = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, job.paperId)).limit(1);
  if (!paper) return null;
  const [started] = await db
    .update(examQuestionPaperJobTable)
    .set({
      status: 'running',
      startedAt: sql`coalesce(${examQuestionPaperJobTable.startedAt}, now())`,
      provider: model.provider,
      model: model.model,
    })
    .where(
      and(
        eq(examQuestionPaperJobTable.id, job.id),
        eq(examQuestionPaperJobTable.attempt, input.attempt),
        inArray(examQuestionPaperJobTable.status, ['queued', 'running']),
      ),
    )
    .returning({ id: examQuestionPaperJobTable.id });
  if (!started) return null;
  return {
    key:
      paper.kind === 'standalone'
        ? null
        : {
            schoolId: paper.schoolId,
            sessionId: examKeyPart(paper.sessionId),
            examSlug: examKeyPart(paper.examSlug),
            classId: examKeyPart(paper.classId),
            subjectSlug: examKeyPart(paper.subjectSlug),
            modeSlug: examKeyPart(paper.modeSlug),
          },
    paperKind: paper.kind,
    paperId: paper.id,
    schoolId: job.schoolId,
    requestedBy: job.requestedBy,
    pageIds: job.pageIds,
    instructions: job.instructions,
  };
}

/**
 * The assistant gate before every model request (design F8): a school that
 * hit its limit or switched the feature off stops the job at its next
 * request. A version that is already saved stays.
 */
async function assertAccess(deps: GenerationDeps, begun: BegunJob): Promise<void> {
  const decision = await resolveAssistantAccess(deps.db, { schoolId: begun.schoolId, userId: begun.requestedBy });
  if (decision.refusal) throw new QuestionPaperJobFailure(accessFailure(decision.refusal.code), undefined, decision.refusal.message);
}

/**
 * Everything the job needs before it spends money: the plan's names and
 * marks, a writable paper, a chosen template with the lines it prints around
 * this paper, and for every page a source the model can read (D46: a page is
 * never dropped silently). Nothing here is large (the template's lines are
 * capped, see `QUESTION_PAPER_TEMPLATE_PRINTS_LINES`); the images themselves
 * are read in the model step.
 */
async function planInputs(deps: GenerationDeps, begun: BegunJob, model: QuestionPaperModel): Promise<Plan> {
  const { db } = deps;
  let scope: ResolvedPaper;
  try {
    if (isStandaloneJob(begun) || begun.key === null) {
      // A standalone paper has no plan or exam to lock: the paper itself must still exist in its school. The job runs
      // for a person whose permission the start procedure checked, so the paper is read without a reach check.
      scope = await findStandalonePaperScope(db, { schoolId: begun.schoolId, paperId: begun.paperId });
    } else {
      const exam = await resolvePaperScope(db, begun.key);
      assertPaperWritable(exam);
      scope = exam;
    }
  } catch (error) {
    if (error instanceof ORPCError) throw new QuestionPaperJobFailure('paper_locked', undefined, `${error.status}: ${error.message}`);
    throw error;
  }
  // A plain paper (a personal space's) prints in the built-in shell: no template is needed, and it prints nothing around
  // the body. Every other paper, a school's quick paper included, prints with the school's selected template.
  if (printLayoutOf(scope) !== 'plain' && !(await hasSelectedQuestionPaperTemplate(db, begun.schoolId))) throw new QuestionPaperJobFailure('template_missing');

  const rows = await db
    .select()
    .from(examQuestionPaperPageTable)
    .where(and(eq(examQuestionPaperPageTable.paperId, begun.paperId), inArray(examQuestionPaperPageTable.id, begun.pageIds)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pages = begun.pageIds.map((id) => byId.get(id));
  if (pages.some((page) => !page)) throw new QuestionPaperJobFailure('page_unreadable', 'A page of this paper was removed. Upload it again.', 'A page of the job snapshot no longer exists.');
  const present = pages as NonNullable<(typeof pages)[number]>[];
  // The start procedure refused pages that were not ready; a page cannot change state under a running job, so this only guards that rule.
  const notReady = pageNotReadyMessage(present);
  if (notReady) throw new QuestionPaperJobFailure('page_unreadable', notReady);
  const stored = present.map((page) => {
    if (!page.originalS3Key || !page.contentType || page.byteSize === null) {
      throw new QuestionPaperJobFailure('page_unreadable', undefined, 'A page of the job snapshot has no stored photo.');
    }
    return { ...page, originalS3Key: page.originalS3Key, contentType: page.contentType, byteSize: page.byteSize };
  });

  const unreadable = unreadablePageMessage(present, model.imageMimeTypes);
  if (unreadable) throw new QuestionPaperJobFailure('unsupported_page_format', unreadable);
  const totalBytes = stored.reduce((sum, page) => sum + encodedImageBytes(page.modelByteSize ?? page.byteSize), 0);
  if (totalBytes > QUESTION_PAPER_MAX_REQUEST_IMAGE_BYTES) {
    throw new QuestionPaperJobFailure('images_too_large', undefined, `${totalBytes} encoded bytes of page images.`);
  }
  return {
    scope,
    templatePrints: await readTemplatePrints(db, scope),
    pages: stored.map((page): PlannedPage => ({
      id: page.id,
      position: page.position,
      name: page.originalName,
      // A ready page has a JPEG model copy; otherwise the original, which the check above proved readable.
      key: page.modelS3Key ?? page.originalS3Key,
      mimeType: page.modelS3Key ? (page.modelContentType ?? 'image/jpeg') : page.contentType,
    })),
  };
}

/**
 * Decides whether the paper is written on the figure route: the decision model
 * reads the page photos and says how likely the paper has a diagram to
 * redraw. The route only chooses a model, so a decision that cannot be made (a
 * provider error, a page that cannot be read) writes the paper as before
 * instead of failing it; the transcription step reports an unreadable page on
 * its own. The decision's cost is saved like any other request of the job,
 * as request 0.
 */
async function chooseRoute(deps: GenerationDeps, input: QuestionPaperJobInput, begun: BegunJob, plan: Plan, route: QuestionPaperFigureRoute | undefined): Promise<Route> {
  if (!route) return { figures: false, probability: null };
  if (!(await jobIsLive(deps.db, input))) throw new JobStopped();
  // The decision is billed too: a school that became read-only spends nothing more.
  await assertSchoolStillWritable(deps.db, begun.schoolId);
  let decided: Awaited<ReturnType<QuestionPaperFigureRoute['decision']['decide']>>;
  try {
    const images = await Promise.all(plan.pages.map(async (page) => ({ type: 'image' as const, mimeType: page.mimeType, data: await deps.readObject(page.key) })));
    decided = await route.decision.decide({ images, question: FIGURE_DECISION_QUESTION });
  } catch (error) {
    log.warn({ jobId: input.jobId, model: route.decision.model, err: describeError(error) }, 'question-paper.route.failed');
    return { figures: false, probability: null };
  }
  await recordQuestionPaperRequest(deps.db, {
    jobId: input.jobId,
    schoolId: begun.schoolId,
    userId: begun.requestedBy,
    requestKey: await nextQuestionPaperRequestKey(deps.db, { jobId: input.jobId, attempt: input.attempt, n: 0, finalAnswer: true }),
    model: route.decision,
    answeredModel: decided.answeredModel,
    usage: decided.usage,
    usageComplete: true,
  });
  const figures = decided.probability >= FIGURE_DECISION_THRESHOLD;
  log.info({ jobId: input.jobId, probability: decided.probability, figures }, 'question-paper.route');
  return { figures, probability: decided.probability };
}

/** Whether an S3 error means the object is gone. */
const isMissingObject = (error: unknown) => error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound');

/**
 * Makes one model request (one journaled step). The cost row of every call
 * the provider billed is saved inside that same step, right after the call
 * returns, so a result that was paid for is never journaled without its cost.
 * Only a crash of the worker between the provider's answer and that insert
 * can lose a cost row, and a re-run of the step (which calls the provider
 * again and is billed again) saves its own row under the next free key
 * (`nextQuestionPaperRequestKey`), so a repeated call is counted, not dropped.
 * `parts` is null for the transcription request, whose parts are built from
 * the pages (and the job's instructions) inside the step; the images are never
 * journaled. Every request of a job with instructions uses the instructed
 * system prompt, the repair too.
 */
async function runModelRequest(options: {
  deps: GenerationDeps;
  run: <T>(name: string, action: () => Promise<T>, options?: StepOptions) => Promise<T>;
  model: QuestionPaperModel;
  /** The job runs on the figure route: its prompt asks for simple diagrams to be redrawn. */
  redrawFigures: boolean;
  input: QuestionPaperJobInput;
  begun: BegunJob;
  plan: Plan;
  n: number;
  parts: TextPart[] | null;
}): Promise<ModelAnswer> {
  const { run, n } = options;
  return run(`model:${n}`, () => callModel(options), { maxRetryAttempts: 3 });
}

async function callModel({
  deps,
  model,
  redrawFigures,
  input,
  begun,
  plan,
  n,
  parts,
}: Parameters<typeof runModelRequest>[0]): Promise<ModelAnswer> {
  if (!(await jobIsLive(deps.db, input))) throw new JobStopped();
  // The same stored text for the first request, every retry and the repair's system prompt.
  const instructions = instructionsOf(begun);
  const requestParts =
    parts ??
    buildGenerationParts(
      isStandalonePaper(plan.scope)
        ? {
            kind: 'standalone',
            // A plain page prints nothing (a plan journaled before the lines were journaled has none); a quick paper's
            // unknown lines stay unknown.
            templatePrints: printLayoutOf(plan.scope) === 'plain' ? (templatePrintsOfPlan(plan) ?? STANDALONE_QUESTION_PAPER_PRINTS) : templatePrintsOfPlan(plan),
          }
        : {
            className: plan.scope.className,
            subjectName: plan.scope.subjectName,
            modeName: plan.scope.modeName,
            planMaxMarks: plan.scope.planMaxMarks,
            templatePrints: templatePrintsOfPlan(plan),
          },
      await Promise.all(
        plan.pages.map(async (page) => {
          try {
            return { mimeType: page.mimeType, data: await deps.readObject(page.key) };
          } catch (error) {
            if (isMissingObject(error)) {
              throw new QuestionPaperJobFailure('page_unreadable', `Page ${page.position} (${page.name}) could not be read. Upload it again.`, describeError(error));
            }
            throw error;
          }
        }),
      ),
      instructions,
    );

  for (let attempt = 1; ; attempt += 1) {
    await assertSchoolStillWritable(deps.db, begun.schoolId);
    let result: TextResult;
    try {
      result = await model.generate({
        system: questionPaperJobSystemPrompt(instructions, {
          redrawFigures,
          standalone: isStandalonePaper(plan.scope),
          schoolTemplate: printLayoutOf(plan.scope) === 'school_template',
        }),
        parts: requestParts,
        maxOutputTokens: deps.maxOutputTokens,
      });
    } catch (error) {
      // A request that failed after the provider reported usage is billed:
      // save it under its own attempt key before retrying or failing.
      const billed = model.billedUsageOf(error);
      if (billed) {
        await recordQuestionPaperRequest(deps.db, {
          jobId: input.jobId,
          schoolId: begun.schoolId,
          userId: begun.requestedBy,
          requestKey: await nextQuestionPaperRequestKey(deps.db, { jobId: input.jobId, attempt: input.attempt, n, finalAnswer: false }),
          model,
          answeredModel: billed.model ?? model.model,
          usage: billed.usage,
          usageComplete: billed.complete,
        });
      }
      const kind = model.failureKind(error);
      log.error(
        {
          jobId: input.jobId,
          n,
          attempt,
          kind,
          provider: model.provider,
          model: model.model,
          // The shape of the request, never its content: enough to tell a bad schema from a bad image.
          request: { images: requestParts.filter((part) => part.type === 'image').length, textParts: requestParts.filter((part) => part.type === 'text').length, maxOutputTokens: deps.maxOutputTokens },
          err: describeError(error),
        },
        'question-paper.model.error',
      );
      // Only a busy or unknown failure can pass on its own; the same rejected
      // request, or a wrong key, fails the same way again.
      if ((kind === 'busy' || kind === 'unknown') && attempt < MODEL_ATTEMPTS) {
        await deps.sleep(deps.retryDelaysMs[attempt - 1] ?? deps.retryDelaysMs.at(-1) ?? 0);
        continue;
      }
      throw modelFailure(kind, error);
    }
    // Outside the try: a failure to save the cost must never be mistaken for a model failure and repeat a billed call.
    await recordQuestionPaperRequest(deps.db, {
      jobId: input.jobId,
      schoolId: begun.schoolId,
      userId: begun.requestedBy,
      requestKey: await nextQuestionPaperRequestKey(deps.db, { jobId: input.jobId, attempt: input.attempt, n, finalAnswer: true }),
      model,
      answeredModel: result.answeredModel,
      usage: result.usage,
      usageComplete: true,
    });
    return { text: result.text, usage: result.usage, answeredModel: result.answeredModel, refusal: result.refusal, unfinished: result.unfinished };
  }
}

/**
 * Takes the fragment out of the model's text (a code fence and chatter around
 * it are dropped), renames the class names it gave itself that the page
 * reserves (nobody reads the sanitiser's report in a job, and the paper would
 * otherwise lose all its styling, see `renameReservedClasses`), and checks it
 * with the same function the save uses. A figure
 * id the model invented becomes a placeholder: the job can attach no image. What
 * the sanitiser removes is not a problem, so the answer that passes is the
 * extracted fragment, which the save cleans again.
 */
/**
 * `requireDetails`: whether a standalone paper's missing details block joins
 * the problems when the answer has others (true for the first answer, whose
 * problems a repair fixes; false for the repaired one, after which nothing is
 * asked again).
 */
async function validateAnswer(deps: GenerationDeps, plan: Plan, text: string, options: { requireDetails: boolean }): Promise<Validation> {
  // A standalone paper's answer carries its details in their own fenced block, taken out before the fragment is read.
  const standalone = isStandalonePaper(plan.scope);
  const split = standalone ? splitQuestionPaperDetails(text) : null;
  // A missing or malformed details block is asked for again only alongside the paper's own problems, in a repair that
  // happens anyway. On its own it is never a problem: it neither fails the job nor costs a second paper request (the
  // version then keeps the paper's stored details, `savedDetails`).
  const detailsProblems = split && !split.found && options.requireDetails ? [DETAILS_MISSING_PROBLEM] : [];
  const html = renameReservedClasses(extractQuestionPaperFragment(split ? split.text : text));
  if (html === '') return { ok: false, html, problems: ['The answer is empty. Return the HTML fragment of the paper.'] };
  // The shape comes first: a refusal or a sentence of chatter would otherwise be cleaned to text and printed as the paper.
  const shape = questionPaperFragmentShapeProblem(html);
  if (shape?.kind === 'no_markup') return { ok: false, html, problems: [shape.message], rejected: true };
  if (shape) return { ok: false, html, problems: [shape.message, ...detailsProblems] };
  const checked = await checkQuestionPaperDraft(deps.db, plan.scope, html, { unresolvedFigures: 'placeholder', strictStructure: true });
  if (!checked.ok) return { ok: false, html, problems: [...checked.problems.slice(0, MAX_PROBLEMS - detailsProblems.length), ...detailsProblems] };
  if (!hasPaperContent(checked.html)) {
    return { ok: false, html, problems: ['After cleaning, the answer holds no paper: it needs block elements (p, div, h1-h6, ul, ol, table, figure) with readable text.', ...detailsProblems] };
  }
  return split ? { ok: true, html, details: split.details, detailsFound: split.found } : { ok: true, html };
}

/** The repair problem of a standalone paper's answer without a readable details block. */
export const DETAILS_MISSING_PROBLEM =
  'The answer has no readable paper-details block. After the fragment, add the fenced block labelled paper-details with one JSON object: schoolName, className, subjectName and examName as the paper prints them, and maxMarks as a whole number, each null when the paper does not state it.';

/** Saves the version through the one function chat uses; idempotent per job id. */
async function savePaper(deps: GenerationDeps, input: QuestionPaperJobInput, begun: BegunJob, plan: Plan, html: string, details: QuestionPaperDetails | 'keep' | undefined) {
  if (!(await jobIsLive(deps.db, input))) throw new JobStopped();
  await assertSchoolStillWritable(deps.db, begun.schoolId);
  try {
    // No HTTP request opens a timing scope in the worker; this one logs where the save's render and print time went.
    const saved = await withTimingScope(log, 'question-paper.save.timing', { jobId: input.jobId }, () =>
      deps.save(deps.db, {
        scope: plan.scope,
        userId: begun.requestedBy,
        expectedVersionNo: null,
        html,
        source: { kind: 'ai_job', jobId: input.jobId, pageIds: begun.pageIds },
        ...(details ? { details } : {}),
      }),
    );
    return { versionNo: saved.versionNo };
  } catch (error) {
    // The sweep ended this job while the version was rendering: nothing was committed, stop quietly.
    if (error instanceof SourceJobEndedError) throw new JobStopped();
    // A personal space's limits (docs/personal-space.md "Limits"): checked when the job started, and again here,
    // because other saves may have filled the space or the paper meanwhile.
    const limit = personalSpaceLimitOf(error);
    if (limit === 'storage') throw new QuestionPaperJobFailure('storage_full', undefined, (error as Error).message);
    if (limit === 'versions') throw new QuestionPaperJobFailure('version_limit', undefined, (error as Error).message);
    if (error instanceof ORPCError && error.code === 'BAD_REQUEST') {
      // Four different BAD_REQUESTs reach here: the paper was locked meanwhile (session or exam ended), the plan lost the
      // paper's mode meanwhile, the document failed the shared check, or the render refused it (too large or too complex).
      const code = isPaperLockedError(error) ? 'paper_locked' : isPlanModeRemovedError(error) ? 'plan_mode_removed' : error.message.startsWith('The question paper is not valid') ? 'invalid_output' : 'paper_unprintable';
      throw new QuestionPaperJobFailure(code, undefined, error.message);
    }
    if (error instanceof ORPCError && error.code === 'PRECONDITION_FAILED') throw new QuestionPaperJobFailure('template_missing', undefined, error.message);
    throw error;
  }
}

async function markSucceeded(deps: GenerationDeps, input: QuestionPaperJobInput): Promise<void> {
  await deps.db
    .update(examQuestionPaperJobTable)
    .set({
      status: 'succeeded',
      completedAt: new Date(),
      errorCode: null,
      versionId: sql`(select ${examQuestionPaperVersionTable.id} from ${examQuestionPaperVersionTable} where ${examQuestionPaperVersionTable.sourceJobId} = ${input.jobId})`,
    })
    .where(
      and(
        eq(examQuestionPaperJobTable.id, input.jobId),
        eq(examQuestionPaperJobTable.attempt, input.attempt),
        inArray(examQuestionPaperJobTable.status, ['queued', 'running']),
      ),
    );
}

/**
 * Ends the job as failed. Fenced by attempt and status: a job the sweep
 * already failed, or a newer attempt, is left alone. The code and the safe
 * message are what the user reads; the detail is for developers.
 */
async function markFailed(db: Database, input: QuestionPaperJobInput, failure: QuestionPaperJobFailure): Promise<void> {
  await db
    .update(examQuestionPaperJobTable)
    .set({
      status: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message,
      errorDetail: failure.detail?.slice(0, 2_000) ?? null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(examQuestionPaperJobTable.id, input.jobId),
        eq(examQuestionPaperJobTable.attempt, input.attempt),
        inArray(examQuestionPaperJobTable.status, ['queued', 'running']),
      ),
    );
}
