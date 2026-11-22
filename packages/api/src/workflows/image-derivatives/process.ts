import type { DatabaseExecutor } from '@campuspilot/db';
import { assistantAttachmentTable } from '@campuspilot/db/schema/assistant';
import { examQuestionPaperPageTable } from '@campuspilot/db/schema/exam-question-paper';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import { makeImageDerivatives, type ImageDerivatives } from '../../files/image-derivative';
import {
  deleteObjectsBestEffort,
  getObjectBytes,
  putObject,
  questionPaperKeys,
} from '../../routers/school/question-paper/question-paper.storage';
import type { ImageDerivativeTarget } from './constants';
import { assistantAttachmentKeys } from './keys';

/**
 * What one run did, returned to Restate (and journaled, so it stays small).
 * `skipped`: the row is gone or no longer `pending` (made already, failed by
 * the sweep, or removed), so nothing was written.
 */
export type DerivativeOutcome = 'ready' | 'unsupported' | 'failed' | 'skipped';

/** A decode outcome, or `failed` for a JPEG, PNG or WebP that cannot be decoded (or declares too many pixels). */
type Derived = ImageDerivatives | { status: 'failed' };

/**
 * Decodes in the worker. A refusal about the file itself (415, 413) is a
 * fact about the upload, so it becomes `failed`, never a retry; anything
 * else (storage, memory) is thrown for Restate to retry.
 */
async function derive(bytes: Uint8Array, contentType: string): Promise<Derived> {
  try {
    return await makeImageDerivatives(bytes, contentType, { queue: 'unbounded' });
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'UNSUPPORTED_MEDIA_TYPE' || error.code === 'PAYLOAD_TOO_LARGE')) {
      return { status: 'failed' };
    }
    throw error;
  }
}

/** Writes the two derivatives in parallel; returns the keys written, for the caller to remove if the row is gone. */
async function storeDerivatives(derived: Extract<ImageDerivatives, { status: 'ready' }>, keys: { thumb: string; model: string }) {
  await Promise.all([
    putObject(keys.thumb, derived.thumb.bytes, derived.thumb.contentType),
    putObject(keys.model, derived.model.bytes, derived.model.contentType),
  ]);
  return [keys.thumb, keys.model];
}

/**
 * After a fence miss, whether the objects just written may be removed. The
 * keys are the same for every run on a row, so when an overlapping run (a
 * replayed demo seed beside the sweep's job, a Restate retry on a second
 * worker) has just recorded them, they are that run's live copies and stay.
 * A row that is gone, or failed without them, does not own them.
 */
function ownsWrittenCopies(row: { thumbS3Key: string | null } | undefined, keys: { thumb: string }) {
  return row?.thumbS3Key === keys.thumb;
}

/**
 * Makes the thumbnail and model copy of a stored page photo and records the
 * outcome. Only a `stored`, `pending` page is processed, and the final update
 * is fenced on `pending`: a page removed meanwhile, or failed by the sweep's
 * deadline, keeps its state and the objects just written are removed again
 * (unless an overlapping run recorded them, see {@link ownsWrittenCopies}).
 * Running it twice for the same page writes the same keys and changes nothing
 * the second time.
 *
 * No `rotation` is applied: a page can be turned only once it is `ready`
 * (`exam_question_paper_page_rotation_check`), so a `pending` page is always
 * unturned. A turn writes its copies under its own keys and is never undone
 * to `pending`, so a late run's fence miss finds the turn's keys on the row
 * and removes the upload keys it wrote again.
 */
export async function processPageDerivatives(db: DatabaseExecutor, pageId: string): Promise<DerivativeOutcome> {
  const [page] = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.id, pageId)).limit(1);
  if (!page || page.uploadStatus !== 'stored' || page.derivativeStatus !== 'pending' || !page.originalS3Key || !page.contentType) {
    return 'skipped';
  }
  const derived = await derive(await getObjectBytes(page.originalS3Key), page.contentType);
  const keys = { thumb: questionPaperKeys.thumb(page.schoolId, page.id), model: questionPaperKeys.model(page.schoolId, page.id) };
  const written = derived.status === 'ready' ? await storeDerivatives(derived, keys) : [];
  const updated = await db
    .update(examQuestionPaperPageTable)
    .set(
      derived.status === 'ready'
        ? {
            derivativeStatus: 'ready',
            width: derived.width,
            height: derived.height,
            thumbS3Key: keys.thumb,
            thumbByteSize: derived.thumb.bytes.byteLength,
            modelS3Key: keys.model,
            modelContentType: derived.model.contentType,
            modelByteSize: derived.model.bytes.byteLength,
          }
        : { derivativeStatus: derived.status },
    )
    .where(and(eq(examQuestionPaperPageTable.id, page.id), eq(examQuestionPaperPageTable.derivativeStatus, 'pending')))
    .returning({ id: examQuestionPaperPageTable.id });
  if (updated.length === 0) {
    const [now] = await db.select({ thumbS3Key: examQuestionPaperPageTable.thumbS3Key }).from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.id, page.id)).limit(1);
    if (!ownsWrittenCopies(now, keys)) await deleteObjectsBestEffort(written);
    return 'skipped';
  }
  return derived.status;
}

/**
 * The same for a chat image: only a `pending` image attachment is processed,
 * and the update is fenced on `pending`, so an attachment removed from the
 * composer meanwhile (or failed by the sweep) keeps nothing that was written.
 */
export async function processAttachmentDerivatives(db: DatabaseExecutor, attachmentId: string): Promise<DerivativeOutcome> {
  const [row] = await db.select().from(assistantAttachmentTable).where(eq(assistantAttachmentTable.id, attachmentId)).limit(1);
  if (!row || row.kind !== 'image' || row.derivativeStatus !== 'pending') return 'skipped';
  const derived = await derive(await getObjectBytes(row.s3Key), row.contentType);
  const keys = { thumb: assistantAttachmentKeys.thumb(row.schoolId, row.id), model: assistantAttachmentKeys.model(row.schoolId, row.id) };
  const written = derived.status === 'ready' ? await storeDerivatives(derived, keys) : [];
  const updated = await db
    .update(assistantAttachmentTable)
    .set(
      derived.status === 'ready'
        ? {
            derivativeStatus: 'ready',
            width: derived.width,
            height: derived.height,
            thumbS3Key: keys.thumb,
            modelS3Key: keys.model,
            modelContentType: derived.model.contentType,
            modelByteSize: derived.model.bytes.byteLength,
          }
        : { derivativeStatus: derived.status },
    )
    .where(and(eq(assistantAttachmentTable.id, row.id), eq(assistantAttachmentTable.derivativeStatus, 'pending')))
    .returning({ id: assistantAttachmentTable.id });
  if (updated.length === 0) {
    const [now] = await db.select({ thumbS3Key: assistantAttachmentTable.thumbS3Key }).from(assistantAttachmentTable).where(eq(assistantAttachmentTable.id, row.id)).limit(1);
    if (!ownsWrittenCopies(now, keys)) await deleteObjectsBestEffort(written);
    return 'skipped';
  }
  return derived.status;
}

/** Runs the job for one target row. */
export function processImageDerivatives(db: DatabaseExecutor, target: ImageDerivativeTarget, id: string): Promise<DerivativeOutcome> {
  return target === 'page' ? processPageDerivatives(db, id) : processAttachmentDerivatives(db, id);
}
