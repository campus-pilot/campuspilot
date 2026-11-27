import { describe, expect, it } from 'vitest';

import { DOCUMENT_BATCH_LIMITS, DocumentBatchPlanError, planDocumentBatches, type PlannedDocument } from './batches';

const doc = (htmlBytes = 1_000, images: PlannedDocument['images'] = []): PlannedDocument => ({ htmlBytes, budget: htmlBytes, images });
const docs = (count: number, make: (index: number) => PlannedDocument = () => doc()) => Array.from({ length: count }, (_, index) => make(index));
/** Every batch boundary as a document index. */
const boundaries = (batches: Array<{ start: number; end: number }>) => batches.map((batch) => batch.start);

describe('planDocumentBatches', () => {
  it('covers every document once, in order, without gaps', () => {
    const batches = planDocumentBatches(docs(1_500), 1);
    expect(batches[0]!.start).toBe(0);
    expect(batches.at(-1)!.end).toBe(1_500);
    for (const [index, batch] of batches.entries()) {
      expect(batch.end).toBeGreaterThan(batch.start);
      if (index > 0) expect(batch.start).toBe(batches[index - 1]!.end);
    }
    expect(batches).toHaveLength(Math.ceil(1_500 / DOCUMENT_BATCH_LIMITS.maxDocuments));
  });

  it('never splits a physical sheet: half A4 in pairs, ID cards in eights, the last sheet may be partial', () => {
    const limits = { ...DOCUMENT_BATCH_LIMITS, maxDocuments: 7 };
    const half = planDocumentBatches(docs(15), 2, limits);
    expect(half.every((batch) => batch.start % 2 === 0)).toBe(true);
    expect(half.map((batch) => batch.end - batch.start)).toEqual([6, 6, 3]);
    const ids = planDocumentBatches(docs(17), 8, { ...DOCUMENT_BATCH_LIMITS, maxDocuments: 8 });
    expect(boundaries(ids)).toEqual([0, 8, 16]);
    expect(ids.at(-1)).toEqual({ start: 16, end: 17 });
    expect(() => planDocumentBatches(docs(4), 8, { ...DOCUMENT_BATCH_LIMITS, maxDocuments: 7 })).toThrow();
  });

  it('closes a batch at the HTML byte cap, on a sheet boundary', () => {
    const limits = { ...DOCUMENT_BATCH_LIMITS, maxHtmlBytes: 10_000 };
    const batches = planDocumentBatches(docs(10, () => doc(3_000)), 2, limits);
    // Two sheets (12 KB) would pass 10 KB: one sheet (6 KB) per batch.
    expect(batches.map((batch) => batch.end - batch.start)).toEqual([2, 2, 2, 2, 2]);
    expect(planDocumentBatches(docs(10, () => doc(3_000)), 1, limits).map((batch) => batch.end - batch.start)).toEqual([3, 3, 3, 1]);
  });

  it('counts each image once per batch: the shared logo does not fill a batch', () => {
    const limits = { ...DOCUMENT_BATCH_LIMITS, maxImageBytes: 1_000 };
    const logo = { key: 'logo', byteSize: 400 };
    const withLogo = planDocumentBatches(docs(50, () => doc(100, [logo])), 1, limits);
    expect(withLogo).toHaveLength(1);
    const photos = planDocumentBatches(docs(6, (index) => doc(100, [logo, { key: `photo-${index}`, byteSize: 250 }])), 1, limits);
    // 400 for the logo, then two photos of 250 fit (900); a third would pass 1,000.
    expect(photos.map((batch) => batch.end - batch.start)).toEqual([2, 2, 2]);
  });

  it('refuses a sheet whose images alone pass the cap, and one that passes the render budget', () => {
    const limits = { ...DOCUMENT_BATCH_LIMITS, maxImageBytes: 1_000 };
    expect(() => planDocumentBatches(docs(2, (index) => doc(100, [{ key: `photo-${index}`, byteSize: 600 }])), 2, limits)).toThrow(DocumentBatchPlanError);
    try {
      planDocumentBatches([{ htmlBytes: 10, budget: DOCUMENT_BATCH_LIMITS.maxBudget + 1, images: [] }], 1);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'document_too_large' });
    }
  });

  it('keeps a timetable, a single document, in one batch', () => {
    expect(planDocumentBatches([doc(4_000_000)], 1)).toEqual([{ start: 0, end: 1 }]);
  });
});
