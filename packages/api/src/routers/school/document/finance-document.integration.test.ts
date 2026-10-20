import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { artifactTable } from "@campuspilot/db/schema/artifact";
import { studentTable } from "@campuspilot/db/schema/student";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { createFinanceConfig, createFinanceIdempotencyKey } from "../../../../test/finance/factories";
import { createFinanceScenario, type FinanceScenario } from "../../../../test/finance/scenario";
import { buildFinanceDocumentContexts } from "./finance-document.context";

async function expectA4Pdf(url: string, expectedPages: number) {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(expectedPages);
  for (const page of pdf.getPages()) {
    expect(page.getWidth()).toBeCloseTo(595, 0);
    expect(page.getHeight()).toBeCloseTo(842, 0);
  }
}

describe("immutable finance document contexts", () => {
  let scenario: FinanceScenario;
  beforeEach(async () => {
    scenario = await createFinanceScenario({ activeStartYear: 2026 });
  });
  afterEach(() => vi.useRealTimers());

  it("regenerates an old receipt from its posting snapshot after later activity and enrollment removal", async () => {
    const payment = await scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: "12500",
      currency: "INR",
      allocationMode: "unallocated",
      method: "cash",
      payerName: "Original payer",
      receivedAt: new Date("2026-10-02T10:00:00Z"),
      effectiveAt: new Date("2026-10-02T10:00:00Z"),
      confirmUnallocatedCredit: true,
      idempotencyKey: createFinanceIdempotencyKey("document-old-receipt"),
    });
    const source = { documentType: "receipt" as const, sessionId: scenario.activeSession.id, transactions: [{ kind: "payment" as const, id: payment.id }] };
    const before = await buildFinanceDocumentContexts(db, scenario.school.id, source);

    await db.update(admissionTable).set({ name: "Renamed admission", admissionNo: `RENAMED-${Date.now()}` }).where(eq(admissionTable.id, scenario.admission.id));
    await db.delete(studentTable).where(eq(studentTable.id, scenario.activeStudent.id));
    await scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id,
      amountMinor: "500", currency: "INR", allocationMode: "unallocated", method: "cash",
      receivedAt: new Date("2026-10-03T10:00:00Z"), effectiveAt: new Date("2026-10-03T10:00:00Z"),
      confirmUnallocatedCredit: true, idempotencyKey: createFinanceIdempotencyKey("document-later-payment"),
    });
    const after = await buildFinanceDocumentContexts(db, scenario.school.id, source);
    const stable = (value: typeof before) => value.contexts.map(({ generatedAt: _generatedAt, ...context }) => context);
    expect(stable(after)).toEqual(stable(before));
    expect(after.contexts[0]).toMatchObject({
      admission: { name: scenario.admission.name, number: scenario.admission.admissionNo },
      payment: { receiptNumber: payment.receiptNumber, amountMinor: "12500", payerName: "Original payer" },
      previousBalance: "0.00",
      remainingBalance: "-125.00",
    });
  });

  it("enforces finance-specific template and artifact permissions", async () => {
    const scope = { schoolId: scenario.school.id, documentType: "receipt" as const };
    await expect(scenario.actors.accountant.client.school.listMarketplaceTemplates(scope)).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(scenario.actors.platformAdmin.client.school.listMarketplaceTemplates(scope)).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(scenario.actors.teacher.client.school.listMarketplaceTemplates(scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.examCoordinator.client.school.listMarketplaceTemplates(scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.platformAdmin.client.school.selectMarketplaceTemplate({ ...scope, slug: "receipt-modern", expectedRevisionId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [template] = await db.insert(artifactTable).values({ schoolId: scenario.school.id, kind: "template", documentType: "receipt", name: "Receipt template", s3Key: `test/finance-template-${Date.now()}.hbs`, contentType: "text/x-handlebars-template", byteSize: 8, sha256: "b".repeat(64), createdBy: scenario.actors.accountant.session.user.id }).returning();
    await db.insert(artifactTable).values({ schoolId: scenario.school.id, kind: "pdf", documentType: "receipt", name: "Immutable receipt", s3Key: `test/finance-document-${Date.now()}.pdf`, contentType: "application/pdf", byteSize: 8, sha256: "a".repeat(64), templateRevisionId: template!.id, sessionId: scenario.activeSession.id, financeSource: { kind: "receipt", admissionIds: [scenario.admission.id], transactions: [{ kind: "payment", id: "payment" }] }, createdBy: scenario.actors.accountant.session.user.id });
    await db.insert(artifactTable).values(["Older receipt", "Oldest receipt"].map((name, index) => ({ schoolId: scenario.school.id, kind: "pdf" as const, documentType: "receipt" as const, name, s3Key: `test/finance-history-${Date.now()}-${index}.pdf`, contentType: "application/pdf", byteSize: 8, sha256: String(index + 1).repeat(64), templateRevisionId: template!.id, sessionId: scenario.activeSession.id, financeSource: { kind: "receipt" as const, admissionIds: [scenario.admission.id], transactions: [{ kind: "payment" as const, id: `payment-${index}` }] }, createdBy: scenario.actors.accountant.session.user.id })));
    const platformReceiptHistory = await scenario.actors.platformAdmin.client.school.listDocumentArtifacts({ schoolId: scenario.school.id, filters: { documentType: "receipt", sessionId: scenario.activeSession.id } });
    expect(platformReceiptHistory.items.some((item) => item.documentType === "receipt")).toBe(true);
    await expect(scenario.actors.teacher.client.school.listDocumentArtifacts({ schoolId: scenario.school.id, filters: { documentType: "receipt", sessionId: scenario.activeSession.id } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const financePage = await scenario.actors.platformAdmin.client.school.listDocumentArtifacts({ schoolId: scenario.school.id, filters: { documentDomain: "finance", sessionId: scenario.activeSession.id }, limit: 1, page: 2 });
    expect(financePage).toMatchObject({ items: [expect.objectContaining({ documentType: "receipt" })], pagination: { currentPage: 2, totalItems: 3, totalPages: 3 } });
    await expect(scenario.actors.teacher.client.school.listDocumentArtifacts({ schoolId: scenario.school.id, filters: { documentDomain: "finance", sessionId: scenario.activeSession.id } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.platformAdmin.client.school.listDocumentArtifacts({ schoolId: scenario.school.id, filters: { documentDomain: "finance", sessionId: scenario.activeSession.id }, searchQuery: "Immutable receipt" })).resolves.toMatchObject({ items: [expect.objectContaining({ name: "Immutable receipt" })], pagination: { totalItems: 1 } });
    const academicHistory = await scenario.actors.teacher.client.school.listDocumentArtifacts({ schoolId: scenario.school.id });
    expect(academicHistory.items.some((item) => item.documentType === "receipt")).toBe(false);
  });

  it("rejects mismatched or incomplete finance artifact provenance in PostgreSQL", async () => {
    const common = { schoolId: scenario.school.id, name: "Invalid", contentType: "application/pdf", byteSize: 1, sha256: "c".repeat(64), createdBy: scenario.actors.accountant.session.user.id };
    await expect(db.insert(artifactTable).values({ ...common, kind: "pdf", documentType: "bill", s3Key: `invalid-no-template-${Date.now()}`, sessionId: scenario.activeSession.id, financeSource: { kind: "bill", admissionIds: [scenario.admission.id], billIds: ["bill"], billRunId: null } })).rejects.toBeDefined();
    const [template] = await db.insert(artifactTable).values({ ...common, kind: "template", documentType: "bill", contentType: "text/x-handlebars-template", s3Key: `invalid-shape-template-${Date.now()}` }).returning();
    await expect(db.insert(artifactTable).values({ ...common, kind: "pdf", documentType: "bill", s3Key: `invalid-kind-${Date.now()}`, sessionId: scenario.activeSession.id, templateRevisionId: template!.id, financeSource: { kind: "receipt", admissionIds: [scenario.admission.id], transactions: [{ kind: "payment", id: "payment" }] } })).rejects.toBeDefined();
  });

  it("pins statement review to currency, local cutoff, and each account high-water sequence", async () => {
    vi.setSystemTime(new Date("2026-10-20T06:00:00.000Z"));
    const post = (suffix: string, at: string) => scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id,
      amountMinor: "100", currency: "INR", allocationMode: "unallocated" as const, method: "cash" as const,
      receivedAt: new Date(at), effectiveAt: new Date(at), confirmUnallocatedCredit: true,
      idempotencyKey: createFinanceIdempotencyKey(suffix),
    });
    await post("statement-first", "2026-10-02T10:00:00Z");
    const source = { documentType: "statement" as const, sessionId: scenario.activeSession.id, admissionIds: [scenario.admission.id], throughDate: "2026-10-03" };
    const first = await buildFinanceDocumentContexts(db, scenario.school.id, source);
    expect(first.financeSource).toMatchObject({ kind: "statement", currency: "INR", throughDate: "2026-10-03", accounts: [{ admissionId: scenario.admission.id, highWaterSequence: "1" }] });
    await post("statement-second", "2026-10-04T10:00:00Z");
    const sameCutoff = await buildFinanceDocumentContexts(db, scenario.school.id, source);
    expect(sameCutoff.reviewHash).toBe(first.reviewHash);
    const later = await buildFinanceDocumentContexts(db, scenario.school.id, { ...source, throughDate: "2026-10-05" });
    expect(later.reviewHash).not.toBe(first.reviewHash);
    expect(later.financeSource).toMatchObject({ accounts: [{ highWaterSequence: "2" }] });
    await expect(buildFinanceDocumentContexts(db, scenario.school.id, { ...source, throughDate: "2026-03-31" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(buildFinanceDocumentContexts(db, scenario.school.id, { ...source, throughDate: "2026-10-21" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renders a correction-only account from its durable ledger identity snapshot", async () => {
    await scenario.actors.accountant.client.school.recordAdjustment({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      currency: "INR",
      kind: "credit_correction",
      calculation: { kind: "fixed", amountMinor: "250" },
      reasonCode: "OPENING_CORRECTION",
      reasonNote: "Opening correction",
      effectiveAt: new Date("2026-10-02T10:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("statement-correction-only"),
    });
    const result = await buildFinanceDocumentContexts(db, scenario.school.id, {
      documentType: "statement",
      sessionId: scenario.activeSession.id,
      admissionIds: [scenario.admission.id],
      throughDate: "2026-10-03",
    });
    expect(result.contexts[0]).toMatchObject({
      admission: { name: scenario.admission.name, number: scenario.admission.admissionNo },
      statement: { openingBalanceMinor: "0", closingBalanceMinor: "-250" },
      entries: [expect.objectContaining({ reference: "OPENING_CORRECTION", credit: "2.50", balance: "-2.50" })],
    });
  });

  it("enforces the public finance PDF lifecycle across role and tenant boundaries", async () => {
    const payment = await scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id,
      amountMinor: "500", currency: "INR", allocationMode: "unallocated", method: "cash",
      receivedAt: new Date("2026-10-02T10:00:00Z"), effectiveAt: new Date("2026-10-02T10:00:00Z"),
      confirmUnallocatedCredit: true, idempotencyKey: createFinanceIdempotencyKey("receipt-lifecycle"),
    });
    const selected = await scenario.actors.accountant.client.school.selectMarketplaceTemplate({
      schoolId: scenario.school.id, documentType: "receipt", slug: "receipt-modern", expectedRevisionId: null,
    });
    const input = {
      schoolId: scenario.school.id,
      source: { documentType: "receipt" as const, sessionId: scenario.activeSession.id, transactions: [{ kind: "payment" as const, id: payment.id }] },
      templateRevisionId: selected.artifact.id,
    };
    await expect(scenario.actors.teacher.client.school.generateDocument(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.platformAdmin.client.school.generateDocument(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const generated = await scenario.actors.accountant.client.school.generateDocument(input);
    expect(generated.artifact).toMatchObject({ documentType: "receipt", studentCount: 0, financeSource: { kind: "receipt" } });
    const downloadInput = { schoolId: scenario.school.id, artifactId: generated.artifact.id, documentType: "receipt" as const };
    const signed = await scenario.actors.platformAdmin.client.school.getDocumentDownload(downloadInput);
    const response = await fetch(signed.url);
    expect(response.ok).toBe(true);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(scenario.actors.teacher.client.school.getDocumentDownload(downloadInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.accountant.client.school.getDocumentDownload({ ...downloadInput, documentType: "bill" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(scenario.actors.outsiderManager.client.school.getDocumentDownload({ ...downloadInput, schoolId: scenario.outsiderSchool.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(scenario.actors.platformAdmin.client.school.deleteDocumentArtifact(downloadInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.accountant.client.school.deleteDocumentArtifact(downloadInput)).resolves.toEqual({ deleted: true });
    await expect(scenario.actors.accountant.client.school.getDocumentDownload(downloadInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("generates a full billing-run PDF from immutable bill snapshots on A4", async () => {
    const financeConfig = createFinanceConfig({
      recurring: "monthly",
      elements: {
        tuition: { name: "Tuition", scopes: ["class", "student"], requiredAtLevel: "class", defaultAmountMinor: 10_000 },
        transport: { name: "Transport", scopes: ["school", "student"], requiredAtLevel: "bill_generation" },
      },
    });
    await db.update(schoolSessionTable).set({ financeConfig, financeClassOverrides: { [scenario.schoolClass.slug]: { tuition: 12_000 } } }).where(and(eq(schoolSessionTable.schoolId, scenario.school.id), eq(schoolSessionTable.id, scenario.activeSession.id)));
    const draft = { schoolId: scenario.school.id, sessionId: scenario.activeSession.id, billingDate: "2026-10-10", runValues: { session: { transport: "500" }, classes: {} } };
    const runPreview = await scenario.actors.accountant.client.school.previewBillingRun({ ...draft, page: 1, limit: 20 });
    const run = await scenario.actors.accountant.client.school.postBillingRun({ ...draft, expectedConfigurationHash: runPreview.configurationHash, idempotencyKey: createFinanceIdempotencyKey("document-full-run"), kind: "regular" });
    const detail = await scenario.actors.accountant.client.school.getBillingRun({ schoolId: scenario.school.id, sessionId: scenario.activeSession.id, billRunId: run.id, page: 1, limit: 20 });
    expect(detail.bills.items).toHaveLength(1);
    const bill = detail.bills.items[0]!;
    const selected = await scenario.actors.accountant.client.school.selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: "bill", slug: "bill-modern", expectedRevisionId: null });
    const input = { schoolId: scenario.school.id, source: { documentType: "bill" as const, sessionId: scenario.activeSession.id, billRunId: run.id }, templateRevisionId: selected.artifact.id };
    const before = await scenario.actors.accountant.client.school.previewDocument(input);
    expect(before.html).toContain(bill.billNumber);
    expect(before.html).toContain(scenario.admission.name);
    expect(before.html).toContain("125.00");

    const renamed = `Later name ${Date.now()}`;
    await db.update(admissionTable).set({ name: renamed, admissionNo: `LATER-${Date.now()}` }).where(eq(admissionTable.id, scenario.admission.id));
    await db.delete(studentTable).where(eq(studentTable.id, scenario.activeStudent.id));
    const after = await scenario.actors.accountant.client.school.previewDocument(input);
    expect(after.html).toContain(scenario.admission.name);
    expect(after.html).not.toContain(renamed);

    const generated = await scenario.actors.accountant.client.school.generateDocument(input);
    expect(generated.artifact.financeSource).toEqual({ kind: "bill", admissionIds: [scenario.admission.id], billIds: [bill.id], billRunId: run.id });
    const signed = await scenario.actors.accountant.client.school.getDocumentDownload({ schoolId: scenario.school.id, artifactId: generated.artifact.id, documentType: "bill" });
    await expectA4Pdf(signed.url, 1);
  });

  it("generates semantically distinct refund and as-of statement PDFs on A4", async () => {
    const payment = await scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id,
      amountMinor: "900", currency: "INR", allocationMode: "unallocated", method: "cash",
      receivedAt: new Date("2026-10-02T10:00:00Z"), effectiveAt: new Date("2026-10-02T10:00:00Z"),
      confirmUnallocatedCredit: true, idempotencyKey: createFinanceIdempotencyKey("pdf-refund-payment"),
    });
    const refund = await scenario.actors.accountant.client.school.recordRefund({
      schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id,
      paymentId: payment.id, amountMinor: "300", method: "cash", reason: "Returned excess cash",
      effectiveAt: new Date("2026-10-03T10:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("pdf-refund"),
    });
    const receiptTemplate = await scenario.actors.accountant.client.school.selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: "receipt", slug: "receipt-modern", expectedRevisionId: null });
    const receiptInput = { schoolId: scenario.school.id, source: { documentType: "receipt" as const, sessionId: scenario.activeSession.id, transactions: [{ kind: "refund" as const, id: refund.id }] }, templateRevisionId: receiptTemplate.artifact.id };
    const receiptPreview = await scenario.actors.accountant.client.school.previewDocument(receiptInput);
    expect(receiptPreview.html).toContain("REFUND RECEIPT");
    expect(receiptPreview.html).toContain("Amount returned");
    expect(receiptPreview.html).toContain(refund.refundNumber);
    expect(receiptPreview.html).not.toContain("PAYMENT RECEIPT");
    const receipt = await scenario.actors.accountant.client.school.generateDocument(receiptInput);
    const receiptDownload = await scenario.actors.accountant.client.school.getDocumentDownload({ schoolId: scenario.school.id, artifactId: receipt.artifact.id, documentType: "receipt" });
    await expectA4Pdf(receiptDownload.url, 1);

    const statementTemplate = await scenario.actors.accountant.client.school.selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: "statement", slug: "statement-modern", expectedRevisionId: null });
    const statementSource = { documentType: "statement" as const, sessionId: scenario.activeSession.id, admissionIds: [scenario.admission.id], throughDate: "2026-10-03" };
    const statementPreview = await scenario.actors.accountant.client.school.previewDocument({ schoolId: scenario.school.id, source: statementSource, templateRevisionId: statementTemplate.artifact.id });
    expect(statementPreview.html).toContain("ACCOUNT STATEMENT");
    expect(statementPreview.html).toContain(payment.receiptNumber);
    expect(statementPreview.html).toContain(refund.refundNumber);
    expect(statementPreview.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    const statement = await scenario.actors.accountant.client.school.generateDocument({ schoolId: scenario.school.id, source: { ...statementSource, expectedReviewHash: statementPreview.reviewHash! }, templateRevisionId: statementTemplate.artifact.id });
    const statementDownload = await scenario.actors.accountant.client.school.getDocumentDownload({ schoolId: scenario.school.id, artifactId: statement.artifact.id, documentType: "statement" });
    await expectA4Pdf(statementDownload.url, 1);
  });

  it("rejects statement generation when a posting changes the reviewed cutoff", async () => {
    const post = (suffix: string) => scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id,
      amountMinor: "100", currency: "INR", allocationMode: "unallocated" as const, method: "cash" as const,
      receivedAt: new Date("2026-10-02T10:00:00Z"), effectiveAt: new Date("2026-10-02T10:00:00Z"),
      confirmUnallocatedCredit: true, idempotencyKey: createFinanceIdempotencyKey(suffix),
    });
    await post("statement-stale-first");
    const selected = await scenario.actors.accountant.client.school.selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: "statement", slug: "statement-modern", expectedRevisionId: null });
    const source = { documentType: "statement" as const, sessionId: scenario.activeSession.id, admissionIds: [scenario.admission.id], throughDate: "2026-10-03" };
    const preview = await scenario.actors.accountant.client.school.previewDocument({ schoolId: scenario.school.id, source, templateRevisionId: selected.artifact.id });
    expect(preview.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    await post("statement-stale-second");
    await expect(scenario.actors.accountant.client.school.generateDocument({ schoolId: scenario.school.id, source: { ...source, expectedReviewHash: preview.reviewHash! }, templateRevisionId: selected.artifact.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
