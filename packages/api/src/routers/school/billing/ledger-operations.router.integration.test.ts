import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { and, eq } from "drizzle-orm";
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
    reason: `Ledger test ${input.suffix}`,
    idempotencyKey: createFinanceIdempotencyKey(`bill-${input.suffix}`),
    lines: [{ title: "Tuition charge", amountMinor: input.amountMinor }],
  });
}

function paymentInput(scenario: FinanceScenario, suffix: string, amountMinor = "500") {
  return {
    schoolId: scenario.school.id,
    admissionId: scenario.admission.id,
    sessionId: scenario.activeSession.id,
    amountMinor,
    currency: "INR",
    method: "cash" as const,
    receivedAt: new Date("2040-05-02T10:00:00Z"),
    effectiveAt: new Date("2040-05-02T10:00:00Z"),
    idempotencyKey: createFinanceIdempotencyKey(suffix),
  };
}

describe("school finance ledger operations", () => {
  let scenario: FinanceScenario;

  beforeEach(async () => {
    scenario = await createFinanceScenario();
  });

  it("records payments as account credits without changing individual bill state", async () => {
    const historical = await createBill(scenario, { sessionId: scenario.historicalSession.id, issueDate: "2039-05-01", amountMinor: "5000", suffix: "historical" });
    await createBill(scenario, { sessionId: scenario.activeSession.id, issueDate: "2040-05-01", amountMinor: "10000", suffix: "current" });
    const command = paymentInput(scenario, "account-credit", "12000");
    const payment = await scenario.actors.accountant.client.school.recordPayment(command);
    expect(payment).toMatchObject({ amountMinor: "12000", receiptNumber: expect.any(String) });
    await expect(scenario.actors.accountant.client.school.recordPayment(command)).resolves.toMatchObject({ id: payment.id });

    const summary = await scenario.actors.platformAdmin.client.school.getAdmissionFinanceSummary({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id });
    expect(summary.currencies).toEqual([expect.objectContaining({ currency: "INR", balanceMinor: "3000", dueMinor: "3000", creditMinor: "0", billedMinor: "10000", collectedMinor: "12000", billCounts: { posted: 1, reversed: 0 } })]);

    const ledger = await scenario.actors.manager.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, limit: 20 });
    expect(ledger.entries.items.map((entry: { type: string }) => entry.type)).toEqual(["manual_debit_adjustment", "manual_debit_adjustment", "payment"]);
    expect(ledger.entries.items.at(-1)).toMatchObject({ detail: expect.objectContaining({ kind: "payment", paymentId: payment.id }), runningBalanceMinor: "3000" });
    expect((ledger.entries.items.at(-1)?.detail as Record<string, unknown>)).not.toHaveProperty("allocations");

    await expect(scenario.actors.manager.client.school.getPayment({ schoolId: scenario.school.id, admissionId: scenario.admission.id, paymentId: payment.id })).resolves.toMatchObject({ id: payment.id, refundedMinor: "0", refundableMinor: "12000", status: "recorded" });
    await expect(scenario.actors.manager.client.school.getAdmissionBill({ schoolId: scenario.school.id, admissionId: scenario.admission.id, billId: historical.id })).resolves.toMatchObject({ netAmountMinor: "5000", adjustedMinor: "0", reversed: false });
    await expect(scenario.actors.manager.client.school.listAdmissionBills({ schoolId: scenario.school.id, filters: { admissionId: scenario.admission.id, status: "posted" }, limit: 20 })).resolves.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: historical.id, status: "posted", netAmountMinor: "5000" })]) });
    await expect(scenario.actors.manager.client.school.getClassFinanceSnapshot({ schoolId: scenario.school.id, filters: { sessionId: scenario.activeSession.id }, limit: 20 })).resolves.toMatchObject({ items: [expect.objectContaining({ billedMinor: "10000", netChargeMinor: "10000" })] });
  });

  it("enforces exact idempotency under retries and concurrent payload drift", async () => {
    const command = paymentInput(scenario, "exact-payment", "100");
    const payment = await scenario.actors.accountant.client.school.recordPayment(command);
    await expect(scenario.actors.accountant.client.school.recordPayment(command)).resolves.toMatchObject({ id: payment.id });
    await expect(scenario.actors.accountant.client.school.recordPayment({ ...command, amountMinor: "101" })).rejects.toMatchObject({ code: "CONFLICT" });

    const sameCommand = paymentInput(scenario, "concurrent-payment", "200");
    const sameResults = await Promise.all([scenario.actors.accountant.client.school.recordPayment(sameCommand), scenario.actors.accountant.client.school.recordPayment(sameCommand)]);
    expect(new Set(sameResults.map(({ id }) => id)).size).toBe(1);

    const driftKey = createFinanceIdempotencyKey("concurrent-drift");
    const different = await Promise.allSettled([
      scenario.actors.accountant.client.school.recordPayment({ ...sameCommand, idempotencyKey: driftKey, amountMinor: "201" }),
      scenario.actors.accountant.client.school.recordPayment({ ...sameCommand, idempotencyKey: driftKey, amountMinor: "202" }),
    ]);
    expect(different.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(different.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  it("keeps bill adjustments independent and caps refunds at the unrefunded payment amount", async () => {
    const bill = await createBill(scenario, { sessionId: scenario.activeSession.id, issueDate: "2040-05-01", amountMinor: "1001", suffix: "rounding" });
    const adjustment = await scenario.actors.principal.client.school.recordAdjustment({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, currency: "INR", kind: "discount", billId: bill.id, calculation: { kind: "percentage", percentage: "50" }, reasonCode: "MERIT", reasonNote: "Approved merit discount", effectiveAt: new Date("2040-05-02T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("discount") });
    expect(adjustment.amountMinor).toBe("501");
    await expect(scenario.actors.manager.client.school.getAdmissionBill({ schoolId: scenario.school.id, admissionId: scenario.admission.id, billId: bill.id })).resolves.toMatchObject({ totalAmountMinor: "1001", adjustedMinor: "501", netAmountMinor: "500" });

    const payment = await scenario.actors.accountant.client.school.recordPayment(paymentInput(scenario, "refundable-credit", "700"));
    await expect(scenario.actors.accountant.client.school.recordRefund({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, paymentId: payment.id, amountMinor: "300", method: "cash", reason: "Returned cash", effectiveAt: new Date("2040-05-04T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("refund") })).resolves.toMatchObject({ amountMinor: "300" });
    await expect(scenario.actors.manager.client.school.getPayment({ schoolId: scenario.school.id, paymentId: payment.id })).resolves.toMatchObject({ refundedMinor: "300", refundableMinor: "400", status: "partially_refunded" });
    await expect(scenario.actors.accountant.client.school.recordRefund({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, paymentId: payment.id, amountMinor: "401", method: "cash", reason: "Too much", effectiveAt: new Date("2040-05-04T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("refund-too-much") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("restores refundable credit after refund reversal and then permits payment reversal", async () => {
    const payment = await scenario.actors.accountant.client.school.recordPayment(paymentInput(scenario, "reversible-payment", "500"));
    const refund = await scenario.actors.accountant.client.school.recordRefund({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, paymentId: payment.id, amountMinor: "200", method: "cash", reason: "Temporary refund", effectiveAt: new Date("2040-05-03T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("temporary-refund") });
    await expect(scenario.actors.accountant.client.school.reverseLedgerEntry({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, ledgerEntryId: payment.ledgerEntryId, reason: "Payment error", effectiveAt: new Date("2040-05-03T12:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("blocked-payment-reversal") })).rejects.toMatchObject({ code: "CONFLICT" });
    await scenario.actors.accountant.client.school.reverseLedgerEntry({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, ledgerEntryId: refund.ledgerEntryId, reason: "Refund cancelled", effectiveAt: new Date("2040-05-04T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("refund-reversal") });
    await expect(scenario.actors.manager.client.school.getPayment({ schoolId: scenario.school.id, paymentId: payment.id })).resolves.toMatchObject({ refundedMinor: "0", refundableMinor: "500", status: "recorded" });
    await expect(scenario.actors.accountant.client.school.reverseLedgerEntry({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, ledgerEntryId: payment.ledgerEntryId, reason: "Payment entered in error", effectiveAt: new Date("2040-05-05T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("payment-reversal") })).resolves.toMatchObject({ type: "reversal", direction: "debit", amountMinor: "500" });
  });

  it("allows unregistered account operations and enforces finance permissions", async () => {
    await db.update(admissionTable).set({ registered: false, unregisteredAt: new Date() }).where(eq(admissionTable.id, scenario.admission.id));
    const input = paymentInput(scenario, "unregistered-payment", "100");
    const payment = await scenario.actors.accountant.client.school.recordPayment(input);
    await expect(scenario.actors.accountant.client.school.recordRefund({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, paymentId: payment.id, amountMinor: "10", method: "cash", reason: "Unregistered account refund", effectiveAt: new Date("2040-05-05T00:00:00Z"), idempotencyKey: createFinanceIdempotencyKey("unregistered-refund") })).resolves.toMatchObject({ amountMinor: "10" });
    await expect(scenario.actors.platformAdmin.client.school.recordPayment({ ...input, idempotencyKey: createFinanceIdempotencyKey("admin-denied") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.teacher.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, limit: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps account balances isolated by currency without payment-to-bill links", async () => {
    await db.update(schoolSessionTable).set({ financeConfig: { ...scenario.financeConfig, currency: "USD" } }).where(and(eq(schoolSessionTable.schoolId, scenario.school.id), eq(schoolSessionTable.id, scenario.historicalSession.id)));
    await createBill(scenario, { sessionId: scenario.historicalSession.id, issueDate: "2039-05-01", amountMinor: "4000", suffix: "usd" });
    await createBill(scenario, { sessionId: scenario.activeSession.id, issueDate: "2040-05-01", amountMinor: "6000", suffix: "inr" });
    await scenario.actors.accountant.client.school.recordPayment({ ...paymentInput(scenario, "inr-payment", "2500"), method: "bank_transfer", externalReference: "BANK-CREDIT-1" });
    const summary = await scenario.actors.manager.client.school.getAdmissionFinanceSummary({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id });
    expect(summary.currencies).toEqual([expect.objectContaining({ currency: "INR", balanceMinor: "3500" }), expect.objectContaining({ currency: "USD", balanceMinor: "4000" })]);
    await expect(scenario.actors.platformAdmin.client.school.listPayments({ schoolId: scenario.school.id, filters: { method: "bank_transfer", externalReference: "CREDIT", status: "recorded" }, limit: 20 })).resolves.toMatchObject({ items: [expect.objectContaining({ refundableMinor: "2500", status: "recorded" })] });
  });

  it("rejects inverted ledger and report date ranges", async () => {
    await expect(scenario.actors.manager.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, filters: { effectiveFrom: new Date("2040-02-01"), effectiveTo: new Date("2040-01-01") }, limit: 20 })).rejects.toBeDefined();
    await expect(scenario.actors.manager.client.school.listAdmissionBills({ schoolId: scenario.school.id, filters: { issueFrom: "2040-02-01", issueTo: "2040-01-01" }, limit: 20 })).rejects.toBeDefined();
    await expect(scenario.actors.manager.client.school.listPayments({ schoolId: scenario.school.id, filters: { receivedFrom: new Date("2040-02-01"), receivedTo: new Date("2040-01-01") }, limit: 20 })).rejects.toBeDefined();
    await expect(scenario.actors.manager.client.school.getCollectionRegister({ schoolId: scenario.school.id, filters: { from: new Date("2040-02-01"), to: new Date("2040-01-01") }, limit: 20 })).rejects.toBeDefined();
  });
});
