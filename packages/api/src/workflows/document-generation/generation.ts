import { ORPCError } from '@orpc/server';
import { db as defaultDb, type Database } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { documentGenerationJobTable, type DocumentLedgerCutoff } from '@campuspilot/db/schema/document-generation-job';
import { withTimingScope, measure, annotateTiming } from '@campuspilot/logger/perf';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  documentSourceSchema,
  documentTypeSchema,
  MAX_DOCUMENT_SOURCE_ITEMS,
  type DocumentSource,
  type DocumentTemplatePageSize,
  type DocumentType,
} from '../../routers/school/document/document.dto';
import {
  contextImageKeys,
  DOCUMENT_BATCH_IMAGE_MAX_BYTES,
  documentAssetName,
  DocumentImageError,
  headDocumentImage,
  LONGEST_DOCUMENT_ASSET_NAME,
  loadDocumentImage,
  withResolvedImages,
  type DocumentImageHead,
  type LoadedDocumentImage,
} from '../../routers/school/document/document.images';
import {
  combineDocuments,
  convertDocumentPdf,
  DocumentConversionRefused,
  documentsPerSheet,
  measureDocumentSizes,
  renderDocuments,
} from '../../routers/school/document/document.render';
import { readDocumentTemplate } from '../../routers/school/document/document.storage';
import { resolveDocumentSource, sourceProvenance } from '../../routers/school/document/document.source';
import { DOCUMENT_BATCH_LIMITS, DocumentBatchPlanError, planDocumentBatches, type DocumentBatchLimits } from './batches';
import { DOCUMENT_GENERATION_JOB_FAILURES, type DocumentGenerationJobErrorCode } from './constants';
import { SlotWaitTimeout, withConversionSlot, withPrepareSlot, type SlotLimiter } from './conversion-slots';
import type { DocumentGenerationJobInput } from './input';
import { SCHOOL_SUSPENDED_REASON, schoolWriteRefusalMessageOf } from '../../school-access/school-access.contract';
import { readSchoolWriteFacts, resolveSchoolWriteRefusal } from '../../school-access/school-access.service';
import { log } from './log';
import {
  batchContextsKey,
  batchPdfKey,
  batchPdfName,
  deleteObject,
  deletePrefix,
  documentJobPrefix,
  documentPdfKey,
  getJson,
  manifestKey,
  mergeBatchPdfs,
  MERGED_PDF_MAX_BYTES,
  putJson,
  putObject,
} from './storage';

/**
 * The body of a document generation job, shared by the Restate object
 * (`object.ts`) and the integration tests, so both run exactly the same
 * sequence. Every unit of work goes through `step`, which Restate journals;
 * steps return only keys, counts, sizes and hashes, never document bytes,
 * contexts or names.
 *
 * Sequence (docs/document-system.md "Generation jobs"):
 * 1. `claim`: the queued job becomes `running` (at most one per school).
 * 2. `prepare`: every context, in one repeatable-read read-only transaction
 *    (finance documents read the ledger only up to the cutoff pinned at
 *    start), checked against what was accepted, measured, split into
 *    batches, and written as JSON to the job's temporary prefix.
 * 3. `batch:N`: one step per batch renders it with the pinned template
 *    revision, sends the images as Gotenberg assets, converts it and stores
 *    `batch-NNNN.pdf` (a single batch goes straight to the final key).
 * 4. `merge`: Gotenberg merges the batch PDFs in order into the final PDF,
 *    streamed both ways.
 * 5. `finish`: one artifact row under the reserved id, and the job
 *    `succeeded`, in one transaction.
 * 6. `cleanup`: the temporary prefix is removed.
 *
 * Anything that cannot succeed ends the job `failed` with a code and a safe
 * message (`DOCUMENT_GENERATION_JOB_FAILURES`); the handler then returns
 * normally, because the job row, not the invocation, is where the user
 * reads the outcome.
 */

/** A job outcome that is a failure the user should read. */
export class DocumentJobFailure extends Error {
  constructor(
    readonly code: DocumentGenerationJobErrorCode,
    /** Safe user-facing text. */
    message: string = DOCUMENT_GENERATION_JOB_FAILURES[code],
    /** Raw detail for developers; stored in `error_detail`, never shown. */
    readonly detail: string | null = null,
  ) {
    super(message);
  }
}

/** The job is no longer running (failed by the sweep, or deleted with its school): stop quietly. */
class JobStopped extends Error {}

/** A journaled step's result: a value, a failure to report, a stop, or a slot wait that ran out. */
type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: { code: DocumentGenerationJobErrorCode; message: string; detail: string | null } }
  | { ok: false; stopped: true }
  | { ok: false; slotWaitTimedOut: true };

export type StepOptions = { maxRetryAttempts?: number };
/**
 * Runs one named, idempotent unit of work; Restate journals it, tests call it
 * directly. `signal` aborts when the Restate attempt running the step ends,
 * so a step still waiting for a slot stops waiting.
 */
export type StepRunner = <T>(name: string, action: (signal?: AbortSignal) => Promise<T>, options?: StepOptions) => Promise<T>;

/**
 * How many times a step waits `SLOT_WAIT_LIMIT_MS` for a slot before the job
 * fails as `worker_busy` (an hour in all, the running deadline). Each wait
 * is its own journaled step, so waiting never uses a step's retries.
 */
const MAX_SLOT_WAITS = 6;

export type DocumentGenerationOutcome =
  | { status: 'succeeded'; artifactId: string }
  | { status: 'failed'; code: DocumentGenerationJobErrorCode }
  | { status: 'skipped' };

/** The seams a test replaces; the defaults are the real database, storage and converter. */
export type DocumentGenerationDeps = {
  db: Database;
  convert: typeof convertDocumentPdf;
  merge: typeof mergeBatchPdfs;
  /** Tests lower these to make a few documents span several batches. */
  batchLimits: DocumentBatchLimits;
  /** The process's slots (tests pass their own to observe them). */
  conversionSlots: SlotLimiter;
  prepareSlots: SlotLimiter;
};

export function defaultDocumentGenerationDeps(): DocumentGenerationDeps {
  return {
    db: defaultDb,
    convert: convertDocumentPdf,
    merge: mergeBatchPdfs,
    batchLimits: DOCUMENT_BATCH_LIMITS,
    conversionSlots: withConversionSlot,
    prepareSlots: withPrepareSlot,
  };
}

/**
 * What the claim step journals: ids only. The source, the pinned cutoff and
 * the other inputs can hold thousands of ids, so each step that needs them
 * reads them from the job row ({@link loadJobInputs}); they never change
 * after the job is created.
 */
type ClaimedJob = {
  jobId: string;
  schoolId: string;
  documentType: DocumentType;
  templateRevisionId: string;
  artifactId: string;
};

/** The job's pinned inputs, read from its row by the steps that need them. */
type JobInputs = {
  source: DocumentSource;
  generatedAt: Date;
  reviewHash: string | null;
  ledgerCutoff: DocumentLedgerCutoff[] | null;
  requestedBy: string;
};

/**
 * PDF size one batch conversion may return. Above the converter's default
 * (30 MB, one request's PDF) because a batch may carry 20 MB of photos; the
 * merged PDF has its own limit (`MERGED_PDF_MAX_BYTES`).
 */
export const BATCH_PDF_MAX_BYTES = 150_000_000;

/** What the prepare step journals: where the batches are and how the documents print. */
type PreparedJob = {
  pageSize: DocumentTemplatePageSize;
  documentCount: number;
  batches: Array<{ documents: number }>;
};

/** The most batches a job of the largest size has (one batch per `maxDocuments`). */
function maxJobBatches(limits: DocumentBatchLimits) {
  return Math.ceil(MAX_DOCUMENT_SOURCE_ITEMS / limits.maxDocuments);
}

/** The manifest the prepare step stores for the finish step (ids can be many, so they are not journaled). */
const manifestSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  studentIds: z.array(z.string()),
  warnings: z.array(z.string()),
  financeSource: z.unknown(),
});

const batchContextsSchema = z.object({ version: z.literal(1), contexts: z.array(z.record(z.string(), z.unknown())) });

/**
 * Runs a job. Never throws for a job that cannot succeed (that is a recorded
 * failure); throws only when recording itself fails, which Restate retries.
 * `expectedSchoolId` is the key of the Restate object the job runs under: a
 * job of another school is refused, so one school's queue never runs
 * another's job.
 */
export async function runDocumentGeneration(
  input: DocumentGenerationJobInput,
  step: StepRunner,
  options: { expectedSchoolId?: string; deps?: DocumentGenerationDeps } = {},
): Promise<DocumentGenerationOutcome> {
  const deps = options.deps ?? defaultDocumentGenerationDeps();

  /**
   * A step whose business failures are values, so Restate never retries
   * them. With `slot`, the closure takes the slot first and returns it when
   * it settles; a wait that runs out is journaled and waited again under the
   * next name (`name:wait-N`).
   */
  const run = async <T>(name: string, action: () => Promise<T>, stepOptions?: StepOptions & { slot?: SlotLimiter }): Promise<T> => {
    const { slot, ...runOptions } = stepOptions ?? {};
    for (let wait = 0; ; wait += 1) {
      const result = await step<StepResult<T>>(
        wait === 0 ? name : `${name}:wait-${wait}`,
        async (signal) => {
          try {
            return { ok: true, value: slot ? await slot(action, signal) : await action() };
          } catch (error) {
            if (error instanceof SlotWaitTimeout) return { ok: false, slotWaitTimedOut: true };
            if (error instanceof JobStopped) return { ok: false, stopped: true };
            if (error instanceof DocumentJobFailure) return { ok: false, failure: { code: error.code, message: error.message, detail: error.detail } };
            throw error;
          }
        },
        runOptions,
      );
      if (result.ok) return result.value;
      if ('slotWaitTimedOut' in result) {
        if (wait + 1 >= MAX_SLOT_WAITS) throw new DocumentJobFailure('worker_busy');
        continue;
      }
      if ('stopped' in result) throw new JobStopped();
      throw new DocumentJobFailure(result.failure.code, result.failure.message, result.failure.detail);
    }
  };

  let job: ClaimedJob | null;
  try {
    job = await run('claim', () => claimJob(deps.db, input.jobId, options.expectedSchoolId));
  } catch (error) {
    // Only a stored source that no longer parses ends here; nothing was written yet.
    if (!(error instanceof DocumentJobFailure)) throw error;
    log.warn({ jobId: input.jobId, code: error.code, phase: 'claim' }, 'document-generation.job.failed');
    await step('fail', () => markFailed(deps.db, input.jobId, error));
    return { status: 'failed', code: error.code };
  }
  if (!job) return { status: 'skipped' };
  let phase: 'prepare' | 'convert' = 'prepare';
  try {
    // Slots are taken inside the steps (see `conversion-slots.ts`).
    const prepared = await run(
      'prepare',
      () => withTimingScope(log, 'document-generation.prepare.timing', { jobId: job.jobId }, () => prepareJob(deps, job)),
      { slot: deps.prepareSlots },
    );
    phase = 'convert';
    const single = prepared.batches.length === 1;
    const finalKey = documentPdfKey(job.schoolId, job.artifactId);
    let pdf: { byteSize: number; sha256: string } | null = null;
    let batchBytes = 0;
    for (const [index, batch] of prepared.batches.entries()) {
      const stored = await run(
        `batch:${index + 1}`,
        () =>
          withTimingScope(log, 'document-generation.batch.timing', { jobId: job.jobId, batch: index + 1, documents: batch.documents }, () =>
            convertBatch(deps, job, prepared, index, single ? finalKey : batchPdfKey(documentJobPrefix(job.schoolId, job.jobId), index)),
          ),
        { slot: deps.conversionSlots },
      );
      batchBytes += stored.byteSize;
      if (single) pdf = stored;
    }
    if (!pdf) {
      // Decided from the journaled batch sizes, before anything is sent to Gotenberg.
      if (batchBytes > MERGED_PDF_MAX_BYTES)
        throw new DocumentJobFailure('pdf_too_large', undefined, `The batches hold ${batchBytes} bytes.`);
      pdf = await run(
        'merge',
        () =>
          withTimingScope(log, 'document-generation.merge.timing', { jobId: job.jobId, batches: prepared.batches.length }, () =>
            mergeJob(deps, job, prepared.batches.length, finalKey),
          ),
        { slot: deps.conversionSlots },
      );
    }
    const finished = pdf;
    await run('finish', () => finishJob(deps.db, job, prepared, finished));
    await step('cleanup', () => cleanupJob(deps.db, job));
    log.info({ jobId: job.jobId, documents: prepared.documentCount, batches: prepared.batches.length, pdfBytes: finished.byteSize }, 'document-generation.job.succeeded');
    return { status: 'succeeded', artifactId: job.artifactId };
  } catch (error) {
    if (error instanceof JobStopped) {
      await step('cleanup', () => cleanupJob(deps.db, job));
      return { status: 'skipped' };
    }
    const failure =
      error instanceof DocumentJobFailure
        ? error
        : new DocumentJobFailure(phase === 'convert' ? 'conversion_failed' : 'internal_error', undefined, describeError(error));
    log.warn({ jobId: job.jobId, code: failure.code, phase }, 'document-generation.job.failed');
    await step('fail', () => markFailed(deps.db, job.jobId, failure));
    await step('cleanup', () => cleanupJob(deps.db, job));
    return { status: 'failed', code: failure.code };
  }
}

/** A short developer description of an unexpected error (no parameters, which may hold data). */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error).slice(0, 500);
  return `${error.name}: ${error.message.split('\nparams:')[0]!.slice(0, 500)}`;
}

/**
 * Moves a queued job to `running` (a running one is resumed as it is) and
 * returns its facts; null for a job that ended or no longer exists. The
 * partial unique index on running jobs makes a second running job of the
 * school a unique violation, which Restate retries: the school's queue
 * already prevents it, the index only guarantees it.
 */
async function claimJob(db: Database, jobId: string, expectedSchoolId: string | undefined): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(documentGenerationJobTable)
      .where(eq(documentGenerationJobTable.id, jobId))
      .for('update');
    if (!row || (row.status !== 'queued' && row.status !== 'running')) return null;
    if (expectedSchoolId !== undefined && row.schoolId !== expectedSchoolId)
      throw new Error('A document job was queued under another school.');
    // Parsed before the status changes, so a refused source leaves the job queued for `markFailed`.
    const source = documentSourceSchema.safeParse(row.source);
    const documentType = documentTypeSchema.parse(row.documentType);
    if (!source.success || source.data.documentType !== documentType)
      throw new DocumentJobFailure('invalid_source', undefined, 'The stored source does not parse.');
    // A school suspended (or left without a plan) after the request gets no PDF.
    await assertSchoolStillWritable(tx, row.schoolId);
    if (row.status === 'queued')
      await tx
        .update(documentGenerationJobTable)
        .set({ status: 'running', startedAt: new Date() })
        .where(and(eq(documentGenerationJobTable.id, jobId), eq(documentGenerationJobTable.status, 'queued')));
    return {
      jobId: row.id,
      schoolId: row.schoolId,
      documentType,
      templateRevisionId: row.templateRevisionId,
      artifactId: row.artifactId,
    };
  });
}

/**
 * Fails the job when its school became read-only after the request
 * (suspended, or without a plan; docs/school-suspension.md). Checked when
 * the worker claims the job, before any work.
 */
async function assertSchoolStillWritable(db: Parameters<Parameters<Database['transaction']>[0]>[0], schoolId: string) {
  const facts = await readSchoolWriteFacts(db, schoolId);
  const refusal = facts ? resolveSchoolWriteRefusal(facts) : null;
  if (!refusal) return;
  throw new DocumentJobFailure(
    refusal === SCHOOL_SUSPENDED_REASON ? 'school_suspended' : 'no_plan',
    schoolWriteRefusalMessageOf(refusal, 'school'),
  );
}

/** The job's pinned inputs (see {@link JobInputs}); a job whose row is gone has stopped. */
async function loadJobInputs(db: Database, jobId: string): Promise<JobInputs> {
  const [row] = await db
    .select({
      source: documentGenerationJobTable.source,
      generatedAt: documentGenerationJobTable.generatedAt,
      reviewHash: documentGenerationJobTable.reviewHash,
      ledgerCutoff: documentGenerationJobTable.ledgerCutoff,
      requestedBy: documentGenerationJobTable.requestedBy,
    })
    .from(documentGenerationJobTable)
    .where(eq(documentGenerationJobTable.id, jobId))
    .limit(1);
  if (!row) throw new JobStopped();
  const source = documentSourceSchema.safeParse(row.source);
  if (!source.success) throw new DocumentJobFailure('invalid_source', undefined, 'The stored source does not parse.');
  return { source: source.data, generatedAt: row.generatedAt, reviewHash: row.reviewHash, ledgerCutoff: row.ledgerCutoff ?? null, requestedBy: row.requestedBy };
}

/** Refuses to continue a job that is no longer running (the sweep failed it, or its school was purged). */
async function assertRunning(db: Database, jobId: string) {
  const [row] = await db
    .select({ status: documentGenerationJobTable.status })
    .from(documentGenerationJobTable)
    .where(eq(documentGenerationJobTable.id, jobId))
    .limit(1);
  if (row?.status !== 'running') throw new JobStopped();
}

/**
 * The pinned template revision, read by its id, never through the school's
 * current selection: a template chosen after the request does not change
 * this job.
 */
async function loadPinnedTemplate(db: Database, job: ClaimedJob) {
  const [row] = await db
    .select()
    .from(artifactTable)
    .where(
      and(
        eq(artifactTable.id, job.templateRevisionId),
        eq(artifactTable.schoolId, job.schoolId),
        eq(artifactTable.documentType, job.documentType),
        eq(artifactTable.kind, 'template'),
        eq(artifactTable.status, 'ready'),
      ),
    )
    .limit(1);
  if (!row) throw new DocumentJobFailure('template_unavailable');
  return { row, content: await measure('doc.job.template.read', () => readDocumentTemplate(row.s3Key)) };
}

/** A context builder's refusal, as the failure the user reads (its message is already user-facing). */
function sourceFailure(error: unknown): never {
  if (error instanceof ORPCError) {
    throw new DocumentJobFailure(error.code === 'CONFLICT' ? 'source_changed' : 'invalid_source', error.message, `${error.code}: ${error.message}`);
  }
  throw error;
}

/** Whose image an image error is about, named for the user. */
function imageFailure(error: DocumentImageError, contexts: object[]): DocumentJobFailure {
  for (const context of contexts) {
    const student = (context as { student?: { name?: unknown; photoUrl?: unknown } }).student;
    const photo = student?.photoUrl as { documentImageKey?: unknown } | null | undefined;
    if (photo?.documentImageKey === error.key && typeof student?.name === 'string')
      return new DocumentJobFailure('images_invalid', `The photo of ${student.name} ${error.message}. Upload it again as a PNG, JPEG or WebP image of at most 5 MB.`);
  }
  return new DocumentJobFailure('images_invalid', `The school logo ${error.message}. Upload it again as a PNG, JPEG or WebP image of at most 5 MB.`);
}

/** Size and type of every distinct image, a few requests at a time. */
async function headImages(keys: string[]): Promise<Map<string, DocumentImageHead>> {
  const heads = new Map<string, DocumentImageHead>();
  const queue = [...keys];
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) heads.set(key, await headDocumentImage(key));
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return heads;
}

/**
 * Builds every context once, checks it against what the request accepted,
 * measures every document and stores the batches. Nothing is converted
 * yet, so a refused input costs no Gotenberg time.
 */
async function prepareJob(deps: DocumentGenerationDeps, job: ClaimedJob): Promise<PreparedJob> {
  await assertRunning(deps.db, job.jobId);
  const inputs = await loadJobInputs(deps.db, job.jobId);
  const template = await loadPinnedTemplate(deps.db, job);
  const data = await measure('doc.job.contexts', () =>
    resolveDocumentSource(deps.db, job.schoolId, inputs.source, {
      images: 'reference',
      generatedAt: inputs.generatedAt,
      ...(inputs.ledgerCutoff ? { ledgerCutoff: inputs.ledgerCutoff } : {}),
    }),
  ).catch(sourceFailure);
  if (job.documentType === 'statement' && data.reviewHash !== inputs.reviewHash)
    throw new DocumentJobFailure('source_changed', undefined, 'The statement review hash changed.');
  if (data.contexts.length === 0 || data.contexts.length > MAX_DOCUMENT_SOURCE_ITEMS)
    throw new DocumentJobFailure('invalid_source', undefined, `The source resolved to ${data.contexts.length} documents.`);
  const imageKeysByDocument = data.contexts.map(contextImageKeys);
  let heads: Map<string, DocumentImageHead>;
  try {
    heads = await measure('doc.job.images.head', () => headImages([...new Set(imageKeysByDocument.flat())]));
  } catch (error) {
    if (error instanceof DocumentImageError) throw imageFailure(error, data.contexts);
    throw error;
  }
  let sizes;
  try {
    // One budget for the whole job (a batch's budget times the most batches a
    // job may have), measured a document at a time with the loop free between.
    sizes = await measureDocumentSizes(
      template.content,
      data.contexts.map((context) => withResolvedImages(context, () => LONGEST_DOCUMENT_ASSET_NAME)),
      { documentBudget: deps.batchLimits.maxBudget, jobBudget: deps.batchLimits.maxBudget * maxJobBatches(deps.batchLimits) },
    );
  } catch (error) {
    if (error instanceof ORPCError) throw new DocumentJobFailure('document_too_large', error.message, `${error.code}: ${error.message}`);
    throw error;
  }
  let plan;
  try {
    plan = planDocumentBatches(
      sizes.map((size, index) => ({
        ...size,
        images: imageKeysByDocument[index]!.map((key) => ({ key, byteSize: heads.get(key)!.byteSize })),
      })),
      documentsPerSheet(job.documentType, template.row.pageSize),
      deps.batchLimits,
    );
  } catch (error) {
    if (error instanceof DocumentBatchPlanError) throw new DocumentJobFailure(error.code, error.message);
    throw error;
  }
  const prefix = documentJobPrefix(job.schoolId, job.jobId);
  await measure('doc.job.batches.store', async () => {
    for (const [index, batch] of plan.entries())
      await putJson(batchContextsKey(prefix, index), { version: 1, contexts: data.contexts.slice(batch.start, batch.end) });
    await putJson(manifestKey(prefix), {
      version: 1,
      name: data.name,
      studentIds: data.studentIds,
      warnings: data.warnings,
      financeSource: data.financeSource,
    } satisfies z.infer<typeof manifestSchema>);
  });
  annotateTiming({ documents: data.contexts.length, batches: plan.length, images: heads.size });
  const updated = await deps.db
    .update(documentGenerationJobTable)
    // What the PDF prints, its own fact next to the start's count (data may have changed since).
    .set({ batchCount: plan.length, batchesDone: 0, printedDocumentCount: data.contexts.length })
    .where(and(eq(documentGenerationJobTable.id, job.jobId), eq(documentGenerationJobTable.status, 'running')))
    .returning({ id: documentGenerationJobTable.id });
  if (updated.length === 0) throw new JobStopped();
  return {
    pageSize: template.row.pageSize,
    documentCount: data.contexts.length,
    batches: plan.map((batch) => ({ documents: batch.end - batch.start })),
  };
}

/**
 * Renders and converts one batch and stores its PDF at `outputKey`. Each
 * distinct image is read once and sent once as a form file; the documents
 * reference it by its generated name.
 */
async function convertBatch(
  deps: DocumentGenerationDeps,
  job: ClaimedJob,
  prepared: PreparedJob,
  index: number,
  outputKey: string,
): Promise<{ byteSize: number; sha256: string }> {
  await assertRunning(deps.db, job.jobId);
  const template = await loadPinnedTemplate(deps.db, job);
  const prefix = documentJobPrefix(job.schoolId, job.jobId);
  const { contexts } = batchContextsSchema.parse(await measure('doc.job.batch.read', () => getJson(batchContextsKey(prefix, index))));
  const keys = [...new Set(contexts.flatMap(contextImageKeys))];
  const images: LoadedDocumentImage[] = [];
  let imageBytes = 0;
  try {
    await measure('doc.job.images.read', async () => {
      for (const key of keys) {
        const image = await loadDocumentImage(key);
        imageBytes += image.bytes.length;
        if (imageBytes > DOCUMENT_BATCH_IMAGE_MAX_BYTES) throw new DocumentJobFailure('images_too_large');
        images.push(image);
      }
    });
  } catch (error) {
    if (error instanceof DocumentImageError) throw imageFailure(error, contexts);
    throw error;
  }
  const names = new Map(images.map((image) => [image.key, documentAssetName(image.sha256, image.contentType)]));
  const assets = new Map(images.map((image) => [names.get(image.key)!, image]));
  const assetNames = new Set(assets.keys());
  let html: string;
  try {
    html = combineDocuments(
      renderDocuments(
        template.content,
        contexts.map((context) => withResolvedImages(context, (key) => names.get(key) ?? null)),
        { assets: assetNames },
      ),
      job.documentType,
      prepared.pageSize,
      { assets: assetNames },
    );
  } catch (error) {
    if (error instanceof ORPCError) throw new DocumentJobFailure('document_too_large', error.message, `${error.code}: ${error.message}`);
    throw error;
  }
  annotateTiming({ htmlBytes: Buffer.byteLength(html, 'utf8'), assets: assets.size, assetBytes: imageBytes });
  let bytes: Buffer;
  try {
    bytes = await deps.convert(
      html,
      job.documentType,
      undefined,
      [...assets.entries()].map(([name, image]) => ({ name, contentType: image.contentType, bytes: image.bytes })),
      { maxPdfBytes: BATCH_PDF_MAX_BYTES },
    );
  } catch (error) {
    // Repeating these fails the same way: the job fails now, with its own message.
    if (error instanceof DocumentConversionRefused)
      throw new DocumentJobFailure(error.reason === 'too_large' ? 'pdf_too_large' : 'conversion_refused', undefined, error.message);
    throw error;
  }
  const stored = await measure('doc.job.batch.store', () => putObject(outputKey, bytes, 'application/pdf'));
  await deps.db
    .update(documentGenerationJobTable)
    .set({ batchesDone: sql`greatest(${documentGenerationJobTable.batchesDone}, ${index + 1})` })
    .where(and(eq(documentGenerationJobTable.id, job.jobId), eq(documentGenerationJobTable.status, 'running')));
  return stored;
}

/** Merges the stored batch PDFs, in batch order, into the final PDF. */
async function mergeJob(deps: DocumentGenerationDeps, job: ClaimedJob, batchCount: number, finalKey: string) {
  await assertRunning(deps.db, job.jobId);
  const prefix = documentJobPrefix(job.schoolId, job.jobId);
  const files = Array.from({ length: batchCount }, (_, index) => ({ key: batchPdfKey(prefix, index), name: batchPdfName(index) }));
  let merged: { byteSize: number; sha256: string };
  try {
    merged = await measure('doc.pdf.merge', () => deps.merge(files, finalKey));
  } catch (error) {
    // As for a batch: a refused merge or an oversized result fails the same way again.
    if (error instanceof DocumentConversionRefused)
      throw new DocumentJobFailure(error.reason === 'too_large' ? 'pdf_too_large' : 'conversion_refused', undefined, error.message);
    throw error;
  }
  annotateTiming({ pdfBytes: merged.byteSize });
  return merged;
}

/**
 * Creates the artifact and ends the job, in one transaction. The artifact
 * row is inserted under the id the job reserved and the insert does nothing
 * when it exists, so a repeated finish never creates a second artifact; the
 * job row is locked first, so a job the sweep failed meanwhile gets no
 * artifact (its PDF is removed by the cleanup step).
 */
async function finishJob(db: Database, job: ClaimedJob, prepared: PreparedJob, pdf: { byteSize: number; sha256: string }) {
  const manifest = manifestSchema.parse(await getJson(manifestKey(documentJobPrefix(job.schoolId, job.jobId))));
  const inputs = await loadJobInputs(db, job.jobId);
  const provenance = sourceProvenance(inputs.source);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: documentGenerationJobTable.status })
      .from(documentGenerationJobTable)
      .where(eq(documentGenerationJobTable.id, job.jobId))
      .for('update');
    if (row?.status === 'succeeded') return;
    if (row?.status !== 'running') throw new JobStopped();
    await tx
      .insert(artifactTable)
      .values({
        id: job.artifactId,
        schoolId: job.schoolId,
        kind: 'pdf',
        documentType: job.documentType,
        name: manifest.name,
        s3Key: documentPdfKey(job.schoolId, job.artifactId),
        contentType: 'application/pdf',
        byteSize: pdf.byteSize,
        sha256: pdf.sha256,
        pageSize: prepared.pageSize,
        templateRevisionId: job.templateRevisionId,
        ...provenance,
        studentIds: manifest.studentIds,
        studentCount: manifest.studentIds.length,
        financeSource: manifest.financeSource as (typeof artifactTable.$inferInsert)['financeSource'],
        createdBy: inputs.requestedBy,
      })
      .onConflictDoNothing({ target: artifactTable.id });
    await tx
      .update(documentGenerationJobTable)
      .set({
        status: 'succeeded',
        completedAt: new Date(),
        warnings: manifest.warnings,
        batchesDone: prepared.batches.length,
      })
      .where(eq(documentGenerationJobTable.id, job.jobId));
  });
}

/** Records a failure; a job that already ended is left alone. */
async function markFailed(db: Database, jobId: string, failure: DocumentJobFailure) {
  await db
    .update(documentGenerationJobTable)
    .set({ status: 'failed', errorCode: failure.code, errorMessage: failure.message, errorDetail: failure.detail, completedAt: new Date() })
    .where(and(eq(documentGenerationJobTable.id, jobId), inArray(documentGenerationJobTable.status, ['queued', 'running'])));
}

/**
 * Removes the job's temporary objects and, for a job that did not succeed,
 * a final PDF a merge or a single batch may already have stored (no
 * artifact references it). Idempotent.
 */
export async function cleanupJob(db: Database, job: { jobId: string; schoolId: string; artifactId: string }) {
  await deletePrefix(documentJobPrefix(job.schoolId, job.jobId));
  const [row] = await db
    .select({ status: documentGenerationJobTable.status })
    .from(documentGenerationJobTable)
    .where(eq(documentGenerationJobTable.id, job.jobId))
    .limit(1);
  if (row?.status !== 'succeeded') {
    const [artifact] = await db.select({ id: artifactTable.id }).from(artifactTable).where(eq(artifactTable.id, job.artifactId)).limit(1);
    if (!artifact) await deleteObject(documentPdfKey(job.schoolId, job.artifactId));
  }
  if (row) {
    await db
      .update(documentGenerationJobTable)
      .set({ temporaryObjectsDeletedAt: new Date() })
      .where(and(eq(documentGenerationJobTable.id, job.jobId), inArray(documentGenerationJobTable.status, ['succeeded', 'failed'])));
  }
}
