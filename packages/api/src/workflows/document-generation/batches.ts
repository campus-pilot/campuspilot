import { DOCUMENT_BATCH_IMAGE_MAX_BYTES } from '../../routers/school/document/document.images';
import { DOCUMENT_RENDER_MAX_CHARS } from '../../routers/school/document/document.render';

/**
 * How a generation job splits its documents into conversion batches. Each
 * batch is rendered and converted by one journaled step and becomes one PDF;
 * the PDFs are merged in order. A batch closes at the first limit it would
 * pass:
 *
 * - `maxDocuments`: about 200 documents;
 * - `maxHtmlBytes`: about 5 MB of rendered HTML (images are referenced by
 *   name, so this is text);
 * - `maxBudget`: the render budget one batch shares (`DOCUMENT_RENDER_MAX_CHARS`);
 * - `maxImageBytes`: the distinct image bytes sent with the batch, each image
 *   counted once however many documents show it (the logo once per batch).
 *
 * A batch always holds whole physical sheets (two half-A4 documents, eight
 * student IDs, one of anything else), so the merged PDF has exactly the
 * pages one conversion of every document would have, in the same order.
 */
export const DOCUMENT_BATCH_LIMITS = {
  maxDocuments: 200,
  maxHtmlBytes: 5_000_000,
  maxBudget: DOCUMENT_RENDER_MAX_CHARS,
  maxImageBytes: DOCUMENT_BATCH_IMAGE_MAX_BYTES,
} as const;

/** The hard ceiling of one sheet's HTML, the renderer's own (a sheet cannot be split further). */
const SHEET_MAX_HTML_BYTES = 25_000_000;

export type DocumentBatchLimits = { [K in keyof typeof DOCUMENT_BATCH_LIMITS]: number };

/** What the planner knows about one document, in output order. */
export type PlannedDocument = {
  htmlBytes: number;
  budget: number;
  images: ReadonlyArray<{ key: string; byteSize: number }>;
};

/** A half-open range of document indexes, `[start, end)`. */
export type PlannedBatch = { start: number; end: number };

/** A sheet that cannot be printed within one batch's limits; the message is safe to show. */
export class DocumentBatchPlanError extends Error {
  constructor(
    readonly code: 'images_too_large' | 'document_too_large',
    message: string,
  ) {
    super(message);
  }
}

type Totals = { documents: number; htmlBytes: number; budget: number; imageBytes: number; images: Map<string, number> };

const emptyTotals = (): Totals => ({ documents: 0, htmlBytes: 0, budget: 0, imageBytes: 0, images: new Map() });

/** The totals of `current` with `sheet` added (images counted once). */
function withSheet(current: Totals, sheet: readonly PlannedDocument[]): Totals {
  const next: Totals = { ...current, images: new Map(current.images) };
  for (const document of sheet) {
    next.documents += 1;
    next.htmlBytes += document.htmlBytes;
    next.budget += document.budget;
    for (const image of document.images) {
      if (next.images.has(image.key)) continue;
      next.images.set(image.key, image.byteSize);
      next.imageBytes += image.byteSize;
    }
  }
  return next;
}

function fits(totals: Totals, limits: DocumentBatchLimits) {
  return (
    totals.documents <= limits.maxDocuments &&
    totals.htmlBytes <= limits.maxHtmlBytes &&
    totals.budget <= limits.maxBudget &&
    totals.imageBytes <= limits.maxImageBytes
  );
}

/**
 * Splits `documents` into batches of whole sheets of `sheetSize` (the last
 * sheet may be partial, as in a single conversion). Throws
 * {@link DocumentBatchPlanError} for a sheet that cannot fit any batch.
 */
export function planDocumentBatches(
  documents: readonly PlannedDocument[],
  sheetSize: number,
  limits: DocumentBatchLimits = DOCUMENT_BATCH_LIMITS,
): PlannedBatch[] {
  if (!Number.isInteger(sheetSize) || sheetSize < 1) throw new Error('A sheet holds at least one document.');
  if (limits.maxDocuments < sheetSize) throw new Error('A batch must hold at least one whole sheet.');
  const batches: PlannedBatch[] = [];
  let start = 0;
  let totals = emptyTotals();
  for (let sheetStart = 0; sheetStart < documents.length; sheetStart += sheetSize) {
    const sheet = documents.slice(sheetStart, sheetStart + sheetSize);
    const alone = withSheet(emptyTotals(), sheet);
    if (alone.imageBytes > limits.maxImageBytes)
      throw new DocumentBatchPlanError(
        'images_too_large',
        'The photos on one printed sheet are too large together. Use smaller photos (at most a few hundred KB each).',
      );
    if (alone.budget > limits.maxBudget || alone.htmlBytes > SHEET_MAX_HTML_BYTES)
      throw new DocumentBatchPlanError(
        'document_too_large',
        'One printed sheet exceeds the rendering limit. Use a shorter template or fewer repeated blocks.',
      );
    const combined = withSheet(totals, sheet);
    if (totals.documents > 0 && !fits(combined, limits)) {
      batches.push({ start, end: sheetStart });
      start = sheetStart;
      totals = alone;
    } else {
      totals = combined;
    }
  }
  if (totals.documents > 0) batches.push({ start, end: documents.length });
  return batches;
}
