import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { financeBillLineTable, financeBillTable, financeLedgerEntryTable } from "@campuspilot/db/schema/finance";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createFinanceIdempotencyKey } from "../../../../test/finance/factories";
import { createFinanceScenario, type FinanceScenario } from "../../../../test/finance/scenario";

async function createBill(
  scenario: FinanceScenario,
  input: { sessionId: string; issueDate: string; amountMinor: string; suffix: string },
) {
  return scenario.actors.accountant.client.school.createManualBill({
    schoolId: scenario.school.id,
    sessionId: input.sessionId,
    admissionId: scenario.admission.id,
    issueDate: input.issueDate,
    reason: `Phase 4 ${input.suffix}`,
    idempotencyKey: createFinanceIdempotencyKey(`bill-${input.suffix}`),
    lines: [{ feeElementSlug: "tuition", amountMinor: input.amountMinor }],
  });
}

describe("school finance ledger operations", () => {
  let scenario: FinanceScenario;

  beforeEach(async () => {
    scenario = await createFinanceScenario();
  });

  it("proposes and records deterministic cross-session allocations with exact ledger summaries", async () => {
    const historical = await createBill(scenario, {
      sessionId: scenario.historicalSession.id,
      issueDate: "2039-05-01",
      amountMinor: "5000",
      suffix: "historical",
    });
    const current = await createBill(scenario, {
      sessionId: scenario.activeSession.id,
      issueDate: "2040-05-01",
      amountMinor: "10000",
      suffix: "current",
    });
    const command = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: "12000",
      currency: "INR",
      allocationMode: "proposal" as const,
    };
    const preview = await scenario.actors.accountant.client.school.previewPaymentAllocation(command);
    expect(preview).toMatchObject({
      allocations: [
        { billId: historical.id, billNumber: historical.billNumber, sessionId: scenario.historicalSession.id, sessionLabel: "2039–2040", outstandingMinor: "5000", amountMinor: "5000" },
        { billId: current.id, billNumber: current.billNumber, sessionId: scenario.activeSession.id, sessionLabel: "2040–2041", outstandingMinor: "10000", amountMinor: "7000" },
      ],
      unallocatedCreditMinor: "0",
    });
    const key = createFinanceIdempotencyKey("payment");
    const payment = await scenario.actors.accountant.client.school.recordPayment({
      ...command,
      method: "cash",
      receivedAt: new Date("2040-05-02T10:00:00Z"),
      effectiveAt: new Date("2040-05-02T10:00:00Z"),
      confirmUnallocatedCredit: false,
      expectedAllocationReviewHash: preview.allocationReviewHash!,
      idempotencyKey: key,
    });
    expect(payment).toMatchObject({ amountMinor: "12000", allocatedMinor: "12000" });
    await expect(
      scenario.actors.accountant.client.school.recordPayment({
        ...command,
        method: "cash",
        receivedAt: new Date("2040-05-02T10:00:00Z"),
        effectiveAt: new Date("2040-05-02T10:00:00Z"),
        confirmUnallocatedCredit: false,
        expectedAllocationReviewHash: preview.allocationReviewHash!,
        idempotencyKey: key,
      }),
    ).resolves.toMatchObject({ id: payment.id });
    const summary = await scenario.actors.platformAdmin.client.school.getAdmissionFinanceSummary({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    });
    expect(summary.currencies).toEqual([
      expect.objectContaining({
        currency: "INR",
        balanceMinor: "3000",
        dueMinor: "3000",
        creditMinor: "0",
        billedMinor: "10000",
        collectedMinor: "12000",
        creditAdjustmentMinor: "0",
        debitAdjustmentMinor: "0",
        refundMinor: "0",
        billCounts: { open: 1, settled: 0, reversed: 0 },
      }),
    ]);
    const ledger = await scenario.actors.manager.client.school.getAdmissionLedger({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      limit: 20,
    });
    expect(ledger.entries.items.map((entry: { type: string }) => entry.type)).toEqual([
      "manual_debit_adjustment",
      "manual_debit_adjustment",
      "payment",
    ]);
    expect(ledger.closingBalances).toEqual([
      expect.objectContaining({ currency: "INR", balanceMinor: "3000" }),
    ]);
    expect(ledger.entries.items.map(({ runningBalanceMinor }) => runningBalanceMinor)).toEqual(["5000", "15000", "3000"]);
    expect(ledger.pageOpeningBalances).toEqual([{ currency: "INR", balanceMinor: "0", dueMinor: "0", creditMinor: "0" }]);
    await expect(scenario.actors.manager.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, page: 2, limit: 1 })).resolves.toMatchObject({ pageOpeningBalances: [{ currency: "INR", balanceMinor: "5000" }], entries: { items: [expect.objectContaining({ runningBalanceMinor: "15000" })] } });
    await expect(scenario.actors.manager.client.school.getPayment({ schoolId: scenario.school.id, admissionId: scenario.admission.id, paymentId: payment.id, allocationPage: 2, allocationLimit: 1 })).resolves.toMatchObject({ allocations: { items: [expect.any(Object)], pagination: { currentPage: 2, totalItems: 2 } } });
    await expect(scenario.actors.manager.client.school.getPayment({ schoolId: scenario.school.id, paymentId: payment.id })).resolves.toMatchObject({ id: payment.id, admissionId: scenario.admission.id });
    await expect(scenario.actors.manager.client.school.getAdmissionBill({ schoolId: scenario.school.id, admissionId: scenario.admission.id, billId: historical.id, allocationLimit: 1 })).resolves.toMatchObject({ allocations: { items: [expect.objectContaining({ amountMinor: "5000" })], pagination: { totalItems: 1 } } });
    await expect(scenario.actors.platformAdmin.client.school.getSessionFinanceOverview({ schoolId: scenario.school.id, sessionId: scenario.activeSession.id })).resolves.toMatchObject({ currencies: [expect.objectContaining({ currency: "INR", billedMinor: "10000", paymentMinor: "12000", netCashMinor: "12000" })] });
    await expect(scenario.actors.manager.client.school.getCollectionRegister({ schoolId: scenario.school.id, filters: { sessionId: scenario.activeSession.id }, limit: 20 })).resolves.toMatchObject({ items: [expect.objectContaining({ kind: "payment", amountMinor: "12000" })] });
    await expect(scenario.actors.manager.client.school.getCollectionRegister({ schoolId: scenario.school.id, filters: { sessionId: scenario.activeSession.id, search: scenario.admission.admissionNo }, limit: 20 })).resolves.toMatchObject({ items: [expect.objectContaining({ admissionId: scenario.admission.id })] });
    await expect(scenario.actors.manager.client.school.getFeeElementFinanceReport({ schoolId: scenario.school.id, filters: { sessionId: scenario.activeSession.id }, limit: 20 })).resolves.toMatchObject({ items: [expect.objectContaining({ feeElementSlug: "tuition", billedMinor: "10000" })] });
    await expect(scenario.actors.manager.client.school.getClassFinanceSnapshot({ schoolId: scenario.school.id, filters: { sessionId: scenario.activeSession.id }, limit: 20 })).resolves.toMatchObject({ items: [expect.objectContaining({ billedMinor: "10000", allocatedMinor: "7000", outstandingMinor: "3000" })] });
  });

  it("rejects stale automatic allocation reviews and exact-idempotency payload drift", async () => {
    await createBill(scenario, { sessionId: scenario.activeSession.id, issueDate: "2040-06-01", amountMinor: "1000", suffix: "review-original" });
    const allocationInput = { schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, amountMinor: "500", currency: "INR", allocationMode: "proposal" as const };
    const preview = await scenario.actors.accountant.client.school.previewPaymentAllocation(allocationInput);
    await createBill(scenario, { sessionId: scenario.historicalSession.id, issueDate: "2039-06-01", amountMinor: "1000", suffix: "review-backdated" });
    await expect(scenario.actors.accountant.client.school.recordPayment({ ...allocationInput, expectedAllocationReviewHash: preview.allocationReviewHash!, method: "cash", receivedAt: new Date("2040-06-02T00:00:00Z"), effectiveAt: new Date("2040-06-02T00:00:00Z"), confirmUnallocatedCredit: false, idempotencyKey: createFinanceIdempotencyKey("stale-review") })).rejects.toMatchObject({ code: "CONFLICT" });
    const key = createFinanceIdempotencyKey("exact-unallocated");
    const exact = { schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, amountMinor: "100", currency: "INR", allocationMode: "unallocated" as const, method: "cash" as const, receivedAt: new Date("2040-06-03T00:00:00Z"), effectiveAt: new Date("2040-06-03T00:00:00Z"), confirmUnallocatedCredit: true, idempotencyKey: key };
    await expect(scenario.actors.accountant.client.school.recordPayment(exact)).resolves.toMatchObject({ amountMinor: "100" });
    await expect(scenario.actors.accountant.client.school.recordPayment({ ...exact, confirmUnallocatedCredit: false })).rejects.toMatchObject({ code: "CONFLICT" });
    const concurrentKey = createFinanceIdempotencyKey("concurrent-same");
    const concurrent = { ...exact, idempotencyKey: concurrentKey, receivedAt: new Date("2040-06-04T00:00:00Z"), effectiveAt: new Date("2040-06-04T00:00:00Z") };
    const sameResults = await Promise.all([scenario.actors.accountant.client.school.recordPayment(concurrent), scenario.actors.accountant.client.school.recordPayment(concurrent)]);
    expect(new Set(sameResults.map(({ id }) => id)).size).toBe(1);
    const differentKey = createFinanceIdempotencyKey("concurrent-different");
    const different = await Promise.allSettled([scenario.actors.accountant.client.school.recordPayment({ ...concurrent, idempotencyKey: differentKey, amountMinor: "101" }), scenario.actors.accountant.client.school.recordPayment({ ...concurrent, idempotencyKey: differentKey, amountMinor: "102" })]);
    expect(different.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(different.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  it("binds proposal idempotency to the reviewed hash while exact retries survive later settlement changes", async () => {
    await createBill(scenario, { sessionId: scenario.activeSession.id, issueDate: "2040-08-01", amountMinor: "1000", suffix: "review-idempotency" });
    const allocationInput = { schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, amountMinor: "500", currency: "INR", allocationMode: "proposal" as const };
    const preview = await scenario.actors.accountant.client.school.previewPaymentAllocation(allocationInput);
    const key = createFinanceIdempotencyKey("proposal-idempotency");
    const command = { ...allocationInput, expectedAllocationReviewHash: preview.allocationReviewHash!, method: "cash" as const, receivedAt: new Date("2040-08-02T00:00:00Z"), effectiveAt: new Date("2040-08-02T00:00:00Z"), confirmUnallocatedCredit: false, idempotencyKey: key };
    const payment = await scenario.actors.accountant.client.school.recordPayment(command);
    await createBill(scenario, { sessionId: scenario.historicalSession.id, issueDate: "2039-08-01", amountMinor: "100", suffix: "review-idempotency-later-state" });
    await expect(scenario.actors.accountant.client.school.recordPayment(command)).resolves.toMatchObject({ id: payment.id });
    const differentReviewHash = `${preview.allocationReviewHash!.slice(0, 63)}${preview.allocationReviewHash!.endsWith("0") ? "1" : "0"}`;
    await expect(scenario.actors.accountant.client.school.recordPayment({ ...command, expectedAllocationReviewHash: differentReviewHash })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects inverted finance list and report date ranges", async () => {
    await expect(scenario.actors.manager.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, filters: { effectiveFrom: new Date("2040-02-01"), effectiveTo: new Date("2040-01-01") }, limit: 20 })).rejects.toBeDefined();
    await expect(scenario.actors.manager.client.school.listAdmissionBills({ schoolId: scenario.school.id, filters: { issueFrom: "2040-02-01", issueTo: "2040-01-01" }, limit: 20 })).rejects.toBeDefined();
    await expect(scenario.actors.manager.client.school.listPayments({ schoolId: scenario.school.id, filters: { receivedFrom: new Date("2040-02-01"), receivedTo: new Date("2040-01-01") }, limit: 20 })).rejects.toBeDefined();
    await expect(scenario.actors.manager.client.school.getCollectionRegister({ schoolId: scenario.school.id, filters: { from: new Date("2040-02-01"), to: new Date("2040-01-01") }, limit: 20 })).rejects.toBeDefined();
  });

  it("returns a blocking proposal instead of scanning more than 500 outstanding bills", async () => {
    const entries = await db.insert(financeLedgerEntryTable).values(Array.from({ length: 501 }, (_, index) => ({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: BigInt(index + 1),
      type: "manual_debit_adjustment" as const,
      direction: "debit" as const,
      amountMinor: BigInt(1),
      currency: "INR",
      effectiveAt: new Date(`2040-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`),
      recordedBy: scenario.actors.accountant.session.user.id,
      idempotencyKey: createFinanceIdempotencyKey(`proposal-bound-ledger-${index}`),
    }))).returning({ id: financeLedgerEntryTable.id });
    const bills = await db.insert(financeBillTable).values(entries.map(({ id }, index) => ({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      ledgerEntryId: id,
      sourceKind: "manual" as const,
      manualReason: "Proposal bound fixture",
      billNumber: `BOUND/${String(index + 1).padStart(4, "0")}`,
      issueDate: "2040-07-01",
      currency: "INR",
      totalAmountMinor: BigInt(1),
      lineCount: 1,
      admissionNumberSnapshot: scenario.admission.admissionNo,
      admissionNameSnapshot: scenario.admission.name,
      sessionStartYearSnapshot: 2040,
      sessionEndYearSnapshot: 2041,
      recordedBy: scenario.actors.accountant.session.user.id,
    }))).returning({ id: financeBillTable.id });
    await db.insert(financeBillLineTable).values(bills.map(({ id }) => ({ schoolId: scenario.school.id, billId: id, lineOrder: 0, feeElementSlug: "bound", feeElementName: "Bound", amountMinor: BigInt(1), currency: "INR", pricingSourceKind: "manual" as const, pricingRuleSnapshot: {}, manualReason: "Proposal bound fixture" })));
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(and(eq(financeBillTable.schoolId, scenario.school.id), eq(financeBillTable.admissionId, scenario.admission.id)));
    await expect(scenario.actors.accountant.client.school.previewPaymentAllocation({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, amountMinor: "1", currency: "INR", allocationMode: "proposal" })).resolves.toMatchObject({ readyToRecord: false, allocationReviewHash: null, allocations: [], blockingIssues: [{ code: "candidate_limit_exceeded" }] });
    const plans = await db.transaction(async (transaction) => {
      // The bounded fixture is intentionally small; disabling sequential scans verifies
      // that the real proposal order is supported by the intended index shape.
      await transaction.execute(sql`set local enable_seqscan = off`);
      return transaction.execute<Record<string, unknown>>(sql`explain (format json) select id from finance_bill where school_id = ${scenario.school.id} and admission_id = ${scenario.admission.id} and currency = 'INR' and status = 'posted' order by issue_date, bill_number, id limit 501`);
    });
    expect(JSON.stringify(plans.rows)).toContain("finance_bill_allocation_proposal_idx");
    const searchIndex = await db.execute<{ indexdef: string }>(sql`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'finance_bill_number_trgm_idx'`);
    expect(searchIndex.rows[0]?.indexdef).toContain("gin_trgm_ops");
  });

  it("keeps discounts separate, rounds percentages half up, and refunds only unallocated credit", async () => {
    const bill = await createBill(scenario, {
      sessionId: scenario.activeSession.id,
      issueDate: "2040-05-01",
      amountMinor: "1001",
      suffix: "rounding",
    });
    const adjustment = await scenario.actors.principal.client.school.recordAdjustment({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      currency: "INR",
      kind: "discount",
      billId: bill.id,
      calculation: { kind: "percentage", percentage: "50" },
      reasonCode: "MERIT",
      reasonNote: "Approved merit discount",
      effectiveAt: new Date("2040-05-02T00:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("discount"),
    });
    expect(adjustment.amountMinor).toBe("501");
    await expect(
      scenario.actors.platformAdmin.client.school.getSessionFinanceOverview({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
      }),
    ).resolves.toMatchObject({
      currencies: [expect.objectContaining({ discountMinor: "501", waiverMinor: "0", writeOffMinor: "0", creditCorrectionMinor: "0" })],
    });
    await expect(
      scenario.actors.manager.client.school.getFeeElementFinanceReport({
        schoolId: scenario.school.id,
        filters: { sessionId: scenario.activeSession.id },
        limit: 20,
      }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ feeElementSlug: "tuition", billedMinor: "1001", creditAdjustmentMinor: "0" }),
        expect.objectContaining({ feeElementSlug: "__bill_unallocated_adjustments__", billedMinor: "0", creditAdjustmentMinor: "501", netChargeMinor: "-501" }),
      ]),
    });

    const paymentInput = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: "700",
      currency: "INR",
      allocationMode: "unallocated" as const,
      method: "cash" as const,
      receivedAt: new Date("2040-05-03T00:00:00Z"),
      effectiveAt: new Date("2040-05-03T00:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("credit"),
    };
    await expect(
      scenario.actors.accountant.client.school.recordPayment({
        ...paymentInput,
        confirmUnallocatedCredit: false,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const payment = await scenario.actors.accountant.client.school.recordPayment({
      ...paymentInput,
      confirmUnallocatedCredit: true,
    });
    const refund = await scenario.actors.accountant.client.school.recordRefund({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      paymentId: payment.id,
      amountMinor: "300",
      method: "cash",
      reason: "Returned excess cash",
      effectiveAt: new Date("2040-05-04T00:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("refund"),
    });
    expect(refund).toMatchObject({ amountMinor: "300" });
    await expect(
      scenario.actors.accountant.client.school.recordRefund({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        paymentId: payment.id,
        amountMinor: "401",
        method: "cash",
        reason: "Too much",
        effectiveAt: new Date("2040-05-04T00:00:00Z"),
        idempotencyKey: createFinanceIdempotencyKey("refund-too-much"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows unregistered settlement operations and enforces mutation permissions", async () => {
    await db.update(admissionTable).set({ registered: false, unregisteredAt: new Date() }).where(eq(admissionTable.id, scenario.admission.id));
    const input = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: "100",
      currency: "INR",
      allocationMode: "unallocated" as const,
      method: "cash" as const,
      receivedAt: new Date("2040-05-03T00:00:00Z"),
      effectiveAt: new Date("2040-05-03T00:00:00Z"),
      confirmUnallocatedCredit: true,
      idempotencyKey: createFinanceIdempotencyKey("unregistered-payment"),
    };
    const payment = await scenario.actors.accountant.client.school.recordPayment(input);
    expect(payment).toMatchObject({ amountMinor: "100" });
    const correction = await scenario.actors.accountant.client.school.recordAdjustment({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, currency: "INR", kind: "credit_correction", calculation: { kind: "fixed", amountMinor: "10" }, reasonCode: "MIGRATION", reasonNote: "Unregistered account correction", effectiveAt: new Date("2040-05-04T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("unregistered-correction") });
    await expect(scenario.actors.accountant.client.school.recordRefund({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, paymentId: payment.id, amountMinor: "10", method: "cash", reason: "Unregistered account refund", effectiveAt: new Date("2040-05-05T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("unregistered-refund") })).resolves.toMatchObject({ amountMinor: "10" });
    await expect(scenario.actors.accountant.client.school.reverseLedgerEntry({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, ledgerEntryId: correction.ledgerEntryId, reason: "Correction withdrawn", effectiveAt: new Date("2040-05-06T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("unregistered-reversal") })).resolves.toMatchObject({ type: "reversal" });
    await expect(scenario.actors.platformAdmin.client.school.recordPayment({ ...input, idempotencyKey: createFinanceIdempotencyKey("admin-denied") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.teacher.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, limit: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reverses adjustments once and keeps projections reconciled", async () => {
    const bill = await createBill(scenario, {
      sessionId: scenario.activeSession.id,
      issueDate: "2040-05-01",
      amountMinor: "1000",
      suffix: "reversal",
    });
    const adjustment = await scenario.actors.manager.client.school.recordAdjustment({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      currency: "INR",
      kind: "discount",
      billId: bill.id,
      calculation: { kind: "fixed", amountMinor: "100" },
      reasonCode: "COURTESY",
      reasonNote: "Courtesy discount",
      effectiveAt: new Date("2040-05-02T00:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("reversible-adjustment"),
    });
    const reversalInput = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      ledgerEntryId: adjustment.ledgerEntryId as string,
      reason: "Adjustment approved in error",
      effectiveAt: new Date("2040-05-03T00:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("adjustment-reversal"),
    };
    const reversal = await scenario.actors.accountant.client.school.reverseLedgerEntry(reversalInput);
    expect(reversal).toMatchObject({ type: "reversal", direction: "debit", amountMinor: "100" });
    await expect(
      scenario.actors.accountant.client.school.reverseLedgerEntry({
        ...reversalInput,
        idempotencyKey: createFinanceIdempotencyKey("duplicate-reversal"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(scenario.actors.accountant.client.school.reverseLedgerEntry({ ...reversalInput, ledgerEntryId: reversal.id, idempotencyKey: createFinanceIdempotencyKey("reversal-of-reversal") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(scenario.actors.manager.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, limit: 20 })).resolves.toMatchObject({ entries: { items: expect.arrayContaining([expect.objectContaining({ id: adjustment.ledgerEntryId, reversed: true })]) } });
    await expect(
      scenario.actors.platformAdmin.client.school.reconcileAdmissionProjection({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        currency: "INR",
      }),
    ).resolves.toMatchObject({ matches: true });
  });

  it("rejects bill postings on the generic ledger reversal path", async () => {
    const bill = await createBill(scenario, {
      sessionId: scenario.activeSession.id,
      issueDate: "2040-05-01",
      amountMinor: "1000",
      suffix: "dedicated-reversal",
    });

    await expect(
      scenario.actors.accountant.client.school.reverseLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        ledgerEntryId: bill.ledgerEntryId,
        reason: "Entered in error",
        effectiveAt: new Date("2040-05-02T00:00:00Z"),
        idempotencyKey: createFinanceIdempotencyKey("generic-bill-reversal"),
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("dedicated bill reversal"),
    });
  });

  it("honors explicit allocation choices and keeps different currencies isolated", async () => {
    await db
      .update(schoolSessionTable)
      .set({ financeConfig: { ...scenario.financeConfig, currency: "USD" } })
      .where(
        and(
          eq(schoolSessionTable.schoolId, scenario.school.id),
          eq(schoolSessionTable.id, scenario.historicalSession.id),
        ),
      );
    const usdBill = await createBill(scenario, {
      sessionId: scenario.historicalSession.id,
      issueDate: "2039-05-01",
      amountMinor: "4000",
      suffix: "usd",
    });
    const inrBill = await createBill(scenario, {
      sessionId: scenario.activeSession.id,
      issueDate: "2040-05-01",
      amountMinor: "6000",
      suffix: "inr",
    });
    const preview = await scenario.actors.accountant.client.school.previewPaymentAllocation({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: "2500",
      currency: "INR",
      allocationMode: "explicit",
      allocations: [{ billId: inrBill.id, amountMinor: "2000" }],
    });
    expect(preview).toMatchObject({
      allocations: [{ billId: inrBill.id, amountMinor: "2000" }],
      unallocatedCreditMinor: "500",
      requiresUnallocatedCreditConfirmation: true,
    });
    await expect(
      scenario.actors.accountant.client.school.previewPaymentAllocation({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        amountMinor: "100",
        currency: "INR",
        allocationMode: "explicit",
        allocations: [{ billId: usdBill.id, amountMinor: "100" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: "2500",
      currency: "INR",
      allocationMode: "explicit",
      allocations: [{ billId: inrBill.id, amountMinor: "2000" }],
      method: "bank_transfer",
      externalReference: "BANK-EXPLICIT-1",
      receivedAt: new Date("2040-05-02T00:00:00Z"),
      effectiveAt: new Date("2040-05-02T00:00:00Z"),
      confirmUnallocatedCredit: true,
      idempotencyKey: createFinanceIdempotencyKey("explicit-payment"),
    });
    const summary = await scenario.actors.manager.client.school.getAdmissionFinanceSummary({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    });
    expect(summary.currencies).toEqual([
      expect.objectContaining({ currency: "INR", balanceMinor: "3500", unallocatedCreditMinor: "500" }),
      expect.objectContaining({ currency: "USD", balanceMinor: "4000", unallocatedCreditMinor: "0" }),
    ]);
    const payments = await scenario.actors.platformAdmin.client.school.listPayments({
      schoolId: scenario.school.id,
      filters: { method: "bank_transfer", externalReference: "EXPLICIT" },
      limit: 20,
    });
    expect(payments.items).toHaveLength(1);
  });

  it("restores refundable credit after refund reversal and then permits payment reversal", async () => {
    const payment = await scenario.actors.accountant.client.school.recordPayment({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      amountMinor: "500",
      currency: "INR",
      allocationMode: "unallocated",
      method: "cash",
      receivedAt: new Date("2040-05-02T00:00:00Z"),
      effectiveAt: new Date("2040-05-02T00:00:00Z"),
      confirmUnallocatedCredit: true,
      idempotencyKey: createFinanceIdempotencyKey("refundable-payment"),
    });
    const refund = await scenario.actors.accountant.client.school.recordRefund({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      paymentId: payment.id,
      amountMinor: "200",
      method: "cash",
      reason: "Temporary refund",
      effectiveAt: new Date("2040-05-03T00:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("temporary-refund"),
    });
    await scenario.actors.accountant.client.school.reverseLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      ledgerEntryId: refund.ledgerEntryId,
      reason: "Refund cancelled",
      effectiveAt: new Date("2040-05-04T00:00:00Z"),
      idempotencyKey: createFinanceIdempotencyKey("refund-reversal"),
    });
    await expect(
      scenario.actors.accountant.client.school.getPayment({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        paymentId: payment.id,
      }),
    ).resolves.toMatchObject({ refundedMinor: "0", unallocatedCreditMinor: "500" });
    await expect(
      scenario.actors.accountant.client.school.reverseLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        ledgerEntryId: payment.ledgerEntryId,
        reason: "Payment entered in error",
        effectiveAt: new Date("2040-05-05T00:00:00Z"),
        idempotencyKey: createFinanceIdempotencyKey("payment-reversal"),
      }),
    ).resolves.toMatchObject({ type: "reversal", direction: "debit", amountMinor: "500" });
  });
});
