import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { createFinanceIdempotencyKey } from '../../../test/finance/factories';
import { createFinanceScenario } from '../../../test/finance/scenario';
import { createBillDocumentSource } from './bill';

describe('the bill PDF of a bill.issued WhatsApp message', () => {
  it("renders exactly the notification's bill with the selected template, and nothing for another admission, another session or a reversed bill", async () => {
    const scenario = await createFinanceScenario();
    const accountant = scenario.actors.accountant.client.school;
    const bill = await accountant.createManualBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      issueDate: '2040-05-01',
      reason: 'Notification bill',
      idempotencyKey: createFinanceIdempotencyKey('notification-bill'),
      lines: [{ title: 'Tuition charge', amountMinor: '10000' }],
    });
    const source = createBillDocumentSource();
    const context = { schoolId: scenario.school.id };
    const request = { kind: 'bill' as const, billId: bill.id, sessionId: scenario.activeSession.id, admissionId: scenario.admission.id, filename: 'Bill.pdf' };

    // No bill template selected yet: the message goes out as the bill_issued text.
    await expect(source.available(context)).resolves.toBe(false);
    await expect(source.produce(request, context)).resolves.toBe('template_unavailable');
    const template = await accountant.selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: 'bill', slug: 'bill-default', expectedRevisionId: null });
    await expect(source.available(context)).resolves.toBe(true);
    const artifactsBefore = await db.select().from(artifactTable).where(eq(artifactTable.schoolId, scenario.school.id));

    const document = await source.produce(request, context);
    expect(document).toMatchObject({ mimeType: 'application/pdf', templateRevisionId: template.artifact.id });
    if (!document || document === 'template_unavailable') throw new Error('Expected a bill PDF.');
    // Every bill differs: never shared between recipients.
    expect(document.shareKey).toBeUndefined();
    expect((await PDFDocument.load(document.bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    // An attachment, not a document of the school's history.
    await expect(db.select().from(artifactTable).where(eq(artifactTable.schoolId, scenario.school.id))).resolves.toHaveLength(artifactsBefore.length);
    // Never another admission's or session's bill, nor an unknown one.
    await expect(source.produce({ ...request, admissionId: 'adm_other' }, context)).resolves.toBeNull();
    await expect(source.produce({ ...request, sessionId: scenario.historicalSession.id }, context)).resolves.toBeNull();
    await expect(source.produce({ ...request, billId: 'fbill_unknown' }, context)).resolves.toBeNull();

    // A reversed bill keeps its row (`posted`) but never produces a valid-looking PDF.
    await accountant.reverseBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      billId: bill.id,
      effectiveAt: '2040-05-20T00:00:00.000Z',
      reason: 'Bill issued in error',
      idempotencyKey: createFinanceIdempotencyKey('notification-bill-reversal'),
    });
    await expect(source.produce(request, context)).resolves.toBeNull();
  });
});
