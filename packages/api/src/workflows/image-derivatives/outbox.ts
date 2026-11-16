import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { assistantAttachmentTable } from '@campuspilot/db/schema/assistant';
import { examQuestionPaperPageTable } from '@campuspilot/db/schema/exam-question-paper';
import { and, asc, eq, lt } from 'drizzle-orm';

import { IMAGE_DERIVATIVE_DEADLINE_MS, IMAGE_DERIVATIVE_RESEND_AFTER_MS, type ImageDerivativeTarget } from './constants';
import { log } from './log';
import { sendImageDerivativeJob } from './restate';

/**
 * The image derivative outbox. The row itself is the outbox entry: a stored
 * image whose `derivative_status` is `pending` is work the worker owes. The
 * upload request hands it over right after its commit
 * ({@link requestImageDerivatives}, never awaited by the request); the sweep
 * ({@link sweepImageDerivatives}, every 30 s in the API process) sends again
 * what is still pending, which the per-row idempotency key makes harmless,
 * and marks `failed` what passed {@link IMAGE_DERIVATIVE_DEADLINE_MS}, so an
 * image is never pending without either progressing or ending in a state the
 * screen can show.
 */

/** Rows handled per table and sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 50;

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/** Sends one image to the worker; a failure is logged and left to the sweep. */
async function dispatch(target: ImageDerivativeTarget, id: string): Promise<boolean> {
  try {
    await sendImageDerivativeJob({ target, id });
    return true;
  } catch (error) {
    log.warn({ target, id, reason: describeHandoverError(error) }, 'image-derivatives.handover.failed');
    return false;
  }
}

/**
 * Hands a stored image to the worker after the response is decided. The
 * promise is not awaited by the request; the sweep covers a failed send.
 */
export function requestImageDerivatives(target: ImageDerivativeTarget, id: string) {
  void dispatch(target, id);
}

/** Marks pending rows past the deadline `failed`; fenced on `pending`, so a row the worker finished meanwhile is left alone. */
async function failExpired(db: DatabaseExecutor, deadline: Date) {
  const pages = await db
    .update(examQuestionPaperPageTable)
    .set({ derivativeStatus: 'failed' })
    .where(
      and(
        eq(examQuestionPaperPageTable.uploadStatus, 'stored'),
        eq(examQuestionPaperPageTable.derivativeStatus, 'pending'),
        lt(examQuestionPaperPageTable.storedAt, deadline),
      ),
    )
    .returning({ id: examQuestionPaperPageTable.id });
  const attachments = await db
    .update(assistantAttachmentTable)
    .set({ derivativeStatus: 'failed' })
    .where(and(eq(assistantAttachmentTable.derivativeStatus, 'pending'), lt(assistantAttachmentTable.createdAt, deadline)))
    .returning({ id: assistantAttachmentTable.id });
  if (pages.length + attachments.length > 0) {
    log.warn({ pageIds: pages.map((row) => row.id), attachmentIds: attachments.map((row) => row.id) }, 'image-derivatives.expired');
  }
  return pages.length + attachments.length;
}

/**
 * One sweep, safe across API replicas: failing is a conditional update and a
 * repeated send joins the same Restate invocation. Returns counts for the log.
 */
export async function sweepImageDerivatives(db: DatabaseExecutor = defaultDb, now: Date = new Date()) {
  const deadline = new Date(now.getTime() - IMAGE_DERIVATIVE_DEADLINE_MS);
  const expired = await failExpired(db, deadline);
  const resendBefore = new Date(now.getTime() - IMAGE_DERIVATIVE_RESEND_AFTER_MS);
  const pages = await db
    .select({ id: examQuestionPaperPageTable.id })
    .from(examQuestionPaperPageTable)
    .where(
      and(
        eq(examQuestionPaperPageTable.uploadStatus, 'stored'),
        eq(examQuestionPaperPageTable.derivativeStatus, 'pending'),
        lt(examQuestionPaperPageTable.storedAt, resendBefore),
      ),
    )
    .orderBy(asc(examQuestionPaperPageTable.storedAt))
    .limit(SWEEP_LIMIT);
  const attachments = await db
    .select({ id: assistantAttachmentTable.id })
    .from(assistantAttachmentTable)
    .where(and(eq(assistantAttachmentTable.derivativeStatus, 'pending'), lt(assistantAttachmentTable.createdAt, resendBefore)))
    .orderBy(asc(assistantAttachmentTable.createdAt))
    .limit(SWEEP_LIMIT);
  let resent = 0;
  for (const page of pages) if (await dispatch('page', page.id)) resent += 1;
  for (const attachment of attachments) if (await dispatch('attachment', attachment.id)) resent += 1;
  return { expired, pending: pages.length + attachments.length, resent };
}
