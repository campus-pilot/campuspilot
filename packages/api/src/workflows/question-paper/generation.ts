import { encodedImageBytes, MODEL_REQUEST_IMAGE_BUDGET_BYTES } from '@campuspilot/assistant-contract/attachments';
import { ORPCError } from '@orpc/server';
import { db as defaultDb, type Database } from '@campuspilot/db';
import { examQuestionPaperJobTable, examQuestionPaperPageTable, examQuestionPaperTable, examQuestionPaperVersionTable } from '@campuspilot/db/schema/exam-question-paper';
import { env } from '@campuspilot/env/assistant';
import type { QuestionPaperIssue } from '@campuspilot/question-paper/normalize';
import { questionPaperProviderJsonSchema } from '@campuspilot/question-paper/provider-schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { resolveAssistantAccess } from '../../assistant/access';
import type { PaperKey } from '../../routers/school/question-paper/question-paper.dto';
import { hasSelectedQuestionPaperTemplate } from '../../routers/school/question-paper/question-paper.render';
import { assertPaperWritable, isPaperLockedError, isPlanModeRemovedError, resolvePaperScope, type PaperScope } from '../../routers/school/question-paper/question-paper.scope';
import { unreadablePageMessage } from '../../routers/school/question-paper/question-paper.service';
import { getObjectBytes } from '../../routers/school/question-paper/question-paper.storage';
import { checkQuestionPaperDraft, saveQuestionPaperVersion, SourceJobEndedError } from '../../routers/school/question-paper/question-paper.version.service';
import { QUESTION_PAPER_JOB_FAILURES, type QuestionPaperJobErrorCode } from './constants';
import { nextQuestionPaperRequestKey, recordQuestionPaperRequest } from './cost';
import type { QuestionPaperJobInput } from './input';
import { log } from './log';
import { getQuestionPaperModel, type QuestionPaperModel, type StructuredPart, type StructuredResult } from './model';
import { describeError } from './error-detail';
import { buildGenerationParts, buildRepairParts, QUESTION_PAPER_JOB_SYSTEM_PROMPT } from './prompt';

/**
 * The body of the generation job, shared by the Restate workflow
 * (`workflow.ts`) and the integration tests so both run exactly the same
 * sequence. Every unit of work goes through `step`, which Restate journals;
 * only small values (ids, counts, the model's JSON text) are returned from
 * steps. Images are read inside the model step and never journaled.
 *
 * Sequence (design F6): begin, access, inputs, model call, cost, validate,
 * at most one repair (call, cost, validate), save, succeed. Anything that
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
export const QUESTION_PAPER_MAX_REQUEST_IMAGE_BYTES = MODEL_REQUEST_IMAGE_BUDGET_BYTES;
/** Most findings kept from a validation (they are journaled and sent to the repair call). */
const MAX_ISSUES = 50;

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
    readObject: getObjectBytes,
    save: saveQuestionPaperVersion,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
    maxOutputTokens: env.QUESTION_PAPER_MAX_OUTPUT_TOKENS,
  };
}

/** What the begin step returns: the job's facts, none of them large. */
type BegunJob = { key: PaperKey; paperId: string; schoolId: string; requestedBy: string; pageIds: string[] };

type PlannedPage = { id: string; position: number; name: string; key: string; mimeType: string };
type Plan = { scope: PaperScope; pages: PlannedPage[] };

/** A model answer as journaled. */
type ModelAnswer = Pick<StructuredResult, 'text' | 'usage' | 'answeredModel' | 'refusal' | 'truncated'>;

type Validation = { ok: true } | { ok: false; issues: QuestionPaperIssue[] };

/** How a refusal by the assistant gate maps to a job failure. */
function accessFailure(code: string): QuestionPaperJobErrorCode {
  if (code === 'limit_reached') return 'limit_reached';
  if (code === 'feature_disabled') return 'feature_disabled';
  return 'role_not_enabled';
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
    const first = await runModelRequest({ deps, run, model, input, begun, plan, n: 1, parts: null });
    if (first.refusal) throw new QuestionPaperJobFailure('model_rejected', undefined, 'The model declined to answer.');
    if (first.truncated) throw new QuestionPaperJobFailure('output_too_long', undefined, 'The answer stopped on the output limit.');

    let text = first.text;
    let validation = await run('validate:1', () => validateAnswer(deps, plan, text));
    if (!validation.ok) {
      // One repair, text only; a second failure ends the job (no loop).
      await run('access:2', () => assertAccess(deps, begun));
      const repair = await runModelRequest({ deps, run, model, input, begun, plan, n: 2, parts: buildRepairParts(text, validation.issues) });
      if (repair.refusal) throw new QuestionPaperJobFailure('model_rejected', undefined, 'The model declined the repair request.');
      if (repair.truncated) throw new QuestionPaperJobFailure('output_too_long', undefined, 'The repaired answer stopped on the output limit.');
      text = repair.text;
      validation = await run('validate:2', () => validateAnswer(deps, plan, text));
      if (!validation.ok) {
        throw new QuestionPaperJobFailure('invalid_output', undefined, validation.issues.slice(0, 10).map((issue) => `${issue.path || '(document)'}: ${issue.message}`).join('; '));
      }
    }

    phase = 'save';
    const saved = await run('save', () => savePaper(deps, input, begun, plan, text), { maxRetryAttempts: 4 });
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
    key: {
      schoolId: paper.schoolId,
      sessionId: paper.sessionId,
      examSlug: paper.examSlug,
      classId: paper.classId,
      subjectSlug: paper.subjectSlug,
      modeSlug: paper.modeSlug,
    },
    paperId: paper.id,
    schoolId: job.schoolId,
    requestedBy: job.requestedBy,
    pageIds: job.pageIds,
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
 * marks, a writable paper, a chosen template, and for every page a source the
 * model can read (D46: a page is never dropped silently). Nothing here is
 * large; the images themselves are read in the model step.
 */
async function planInputs(deps: GenerationDeps, begun: BegunJob, model: QuestionPaperModel): Promise<Plan> {
  const { db } = deps;
  let scope: PaperScope;
  try {
    scope = await resolvePaperScope(db, begun.key);
    assertPaperWritable(scope);
  } catch (error) {
    if (error instanceof ORPCError) throw new QuestionPaperJobFailure('paper_locked', undefined, `${error.status}: ${error.message}`);
    throw error;
  }
  if (!(await hasSelectedQuestionPaperTemplate(db, begun.schoolId))) throw new QuestionPaperJobFailure('template_missing');

  const rows = await db
    .select()
    .from(examQuestionPaperPageTable)
    .where(and(eq(examQuestionPaperPageTable.paperId, begun.paperId), inArray(examQuestionPaperPageTable.id, begun.pageIds)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pages = begun.pageIds.map((id) => byId.get(id));
  if (pages.some((page) => !page)) throw new QuestionPaperJobFailure('page_unreadable', 'A page of this paper was removed. Upload it again.', 'A page of the job snapshot no longer exists.');
  const present = pages as NonNullable<(typeof pages)[number]>[];

  const unreadable = unreadablePageMessage(present, model.imageMimeTypes);
  if (unreadable) throw new QuestionPaperJobFailure('unsupported_page_format', unreadable);
  const totalBytes = present.reduce((sum, page) => sum + encodedImageBytes(page.modelByteSize ?? page.byteSize), 0);
  if (totalBytes > QUESTION_PAPER_MAX_REQUEST_IMAGE_BYTES) {
    throw new QuestionPaperJobFailure('images_too_large', undefined, `${totalBytes} encoded bytes of page images.`);
  }
  return {
    scope,
    pages: present.map((page): PlannedPage => ({
      id: page.id,
      position: page.position,
      name: page.originalName,
      // A ready page has a JPEG model copy; otherwise the original, which the check above proved readable.
      key: page.modelS3Key ?? page.originalS3Key,
      mimeType: page.modelS3Key ? (page.modelContentType ?? 'image/jpeg') : page.contentType,
    })),
  };
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
 * the pages inside the step; the images are never journaled.
 */
async function runModelRequest(options: {
  deps: GenerationDeps;
  run: <T>(name: string, action: () => Promise<T>, options?: StepOptions) => Promise<T>;
  model: QuestionPaperModel;
  input: QuestionPaperJobInput;
  begun: BegunJob;
  plan: Plan;
  n: number;
  parts: StructuredPart[] | null;
}): Promise<ModelAnswer> {
  const { run, n } = options;
  return run(`model:${n}`, () => callModel(options), { maxRetryAttempts: 3 });
}

async function callModel({
  deps,
  model,
  input,
  begun,
  plan,
  n,
  parts,
}: Parameters<typeof runModelRequest>[0]): Promise<ModelAnswer> {
  if (!(await jobIsLive(deps.db, input))) throw new JobStopped();
  const requestParts =
    parts ??
    buildGenerationParts(
      { className: plan.scope.className, subjectName: plan.scope.subjectName, modeName: plan.scope.modeName, planMaxMarks: plan.scope.planMaxMarks },
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
    );

  for (let attempt = 1; ; attempt += 1) {
    let result: StructuredResult;
    try {
      result = await model.generate({
        system: QUESTION_PAPER_JOB_SYSTEM_PROMPT,
        parts: requestParts,
        jsonSchema: questionPaperProviderJsonSchema(),
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
    return { text: result.text, usage: result.usage, answeredModel: result.answeredModel, refusal: result.refusal, truncated: result.truncated };
  }
}

/** Parses and checks the model's answer with the same function the save uses. */
async function validateAnswer(deps: GenerationDeps, plan: Plan, text: string): Promise<Validation> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'The answer is not valid JSON.' }] };
  }
  const checked = await checkQuestionPaperDraft(deps.db, plan.scope, raw);
  return checked.ok ? { ok: true } : { ok: false, issues: checked.errors.slice(0, MAX_ISSUES) };
}

/** Saves the version through the one function chat uses; idempotent per job id. */
async function savePaper(deps: GenerationDeps, input: QuestionPaperJobInput, begun: BegunJob, plan: Plan, text: string) {
  if (!(await jobIsLive(deps.db, input))) throw new JobStopped();
  try {
    const saved = await deps.save(deps.db, {
      scope: plan.scope,
      userId: begun.requestedBy,
      expectedVersionNo: null,
      content: JSON.parse(text),
      source: { kind: 'ai_job', jobId: input.jobId, pageIds: begun.pageIds },
    });
    return { versionNo: saved.versionNo };
  } catch (error) {
    // The sweep ended this job while the version was rendering: nothing was committed, stop quietly.
    if (error instanceof SourceJobEndedError) throw new JobStopped();
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
