import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@campuspilot/db";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { eq } from "drizzle-orm";

import { createFinanceConfig, createFinanceIdempotencyKey } from "../../../../test/finance/factories";
import { createFinanceScenario, type FinanceScenario } from "../../../../test/finance/scenario";
import { generateDocumentNow } from "../../../../test/documents";
import { createTestAdmission, createTestClass, createTestSession, createTestStudent } from "../../../../test/fixtures";
import { buildFinanceDocumentContexts } from "./finance-document.context";
import { renderDocument } from "./document.render";

/**
 * Bill due (docs/document-system.md "Bill due"): a bill for one admission as
 * of a chosen date, built from the ledger of the billing period containing
 * that date and printed with the school's bill template.
 */
describe("Bill due", () => {
  let scenario: FinanceScenario;
  beforeEach(async () => {
    // Session 2026-27, monthly, cycle from April, Asia/Kolkata (createFinanceConfig).
    scenario = await createFinanceScenario({ activeStartYear: 2026 });
    vi.setSystemTime(new Date("2026-11-24T06:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const scope = () => ({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id });
  const accountant = () => scenario.actors.accountant.client.school;
  const manualBill = (issueDate: string, lines: Array<{ title: string; amountMinor: string }>, key: string) =>
    accountant().createManualBill({ ...scope(), issueDate, reason: "Bill due test", idempotencyKey: createFinanceIdempotencyKey(key), lines });
  const payment = (amountMinor: string, at: string, key: string) =>
    accountant().recordPayment({ ...scope(), amountMinor, currency: "INR", method: "cash", receivedAt: at, effectiveAt: at, idempotencyKey: createFinanceIdempotencyKey(key) });
  const reverse = (ledgerEntryId: string, at: string, key: string) =>
    accountant().reverseLedgerEntry({ ...scope(), ledgerEntryId, reason: "Entered in error", effectiveAt: at, idempotencyKey: createFinanceIdempotencyKey(key) });
  const source = (throughDate: string) => ({
    documentType: "bill_due" as const,
    sessionId: scenario.activeSession.id,
    throughDate,
    recipients: { kind: "admissions" as const, admissionIds: [scenario.admission.id] },
  });
  const billDue = async (throughDate: string) => {
    const result = await buildFinanceDocumentContexts(db, scenario.school.id, source(throughDate));
    return result.contexts[0] as Record<string, any>;
  };

  it("prints the worked example: 800 carried in, a 1,300 bill, a 200 discount and an 800 payment leave 1,100 due", async () => {
    await manualBill("2026-10-05", [{ title: "October fee", amountMinor: "80000" }], "carried");
    const november = await manualBill("2026-11-01", [{ title: "Tuition", amountMinor: "100000" }, { title: "Transport", amountMinor: "30000" }], "november");
    await accountant().recordAdjustment({
      ...scope(), currency: "INR", kind: "discount", billId: november.id,
      calculation: { kind: "fixed", amountMinor: "20000" }, reasonCode: "SIBLING", reasonNote: "Sibling discount",
      effectiveAt: "2026-11-10T04:00:00Z", idempotencyKey: createFinanceIdempotencyKey("discount"),
    });
    const paid = await payment("80000", "2026-11-10T06:00:00Z", "payment");

    const context = await billDue("2026-11-24");
    expect(context).toMatchObject({
      bill: {
        id: null,
        number: null,
        issueDate: "2026-11-24",
        periodKey: "monthly:2026-11",
        period: { cadence: "monthly", start: { iso: "2026-11-01" }, end: { iso: "2026-11-30" } },
        total: "1300.00",
        totalMinor: "130000",
      },
      billDue: {
        date: { iso: "2026-11-24", day: "24", month: "11", year: "2026", monthName: "November" },
        period: { cadence: "monthly", start: { day: "01", month: "11" }, end: { day: "30", month: "11" } },
      },
      lines: [
        { kind: "bill_line", name: "Tuition", amount: "1000.00", billNumber: november.billNumber, issueDate: { iso: "2026-11-01" } },
        { kind: "bill_line", name: "Transport", amount: "300.00", billNumber: november.billNumber },
      ],
      credits: [
        { kind: "discount", label: "Discount", amount: "200.00", note: "Sibling discount", date: { iso: "2026-11-10" } },
        { kind: "payment", label: "Payment", amount: "800.00", reference: paid.receiptNumber },
      ],
      balanceBefore: "800.00",
      paidThisPeriod: "800.00",
      discountThisPeriod: "200.00",
      waiverThisPeriod: null,
      writeOffThisPeriod: null,
      creditCorrectionThisPeriod: null,
      refundThisPeriod: null,
      balanceAfter: "1100.00",
      admission: { name: scenario.admission.name, number: scenario.admission.admissionNo },
      session: { startYear: 2026, endYear: 2027 },
    });
    // The October bill is before the period: only its balance is carried in.
    expect(context.lines).toHaveLength(2);
  });

  it("lists every line of every bill of the period, manual bills included, one row per line", async () => {
    const first = await manualBill("2026-11-01", [{ title: "Tuition", amountMinor: "100000" }], "first");
    const second = await manualBill("2026-11-15", [{ title: "Back due", amountMinor: "50000" }, { title: "Exam fee", amountMinor: "20000" }], "second");
    const context = await billDue("2026-11-24");
    expect(context.lines.map((line: { name: string; billNumber: string }) => [line.name, line.billNumber])).toEqual([
      ["Tuition", first.billNumber],
      ["Back due", second.billNumber],
      ["Exam fee", second.billNumber],
    ]);
    expect(context.bill.total).toBe("1700.00");
    // A bill after the chosen date is not on it.
    await manualBill("2026-11-26", [{ title: "Late", amountMinor: "100" }], "late");
    expect((await billDue("2026-11-24")).lines).toHaveLength(3);
  });

  it("drops a reversal and what it reverses inside the period, and prints the reversal of an earlier fact as its own row", async () => {
    await manualBill("2026-10-01", [{ title: "October fee", amountMinor: "100000" }], "october");
    const october = await payment("50000", "2026-10-20T06:00:00Z", "october-payment");
    const november = await payment("30000", "2026-11-11T06:00:00Z", "november-payment");
    await reverse(november.ledgerEntryId, "2026-11-13T06:00:00Z", "november-reversal");
    await reverse(october.ledgerEntryId, "2026-11-12T06:00:00Z", "october-reversal");

    const context = await billDue("2026-11-24");
    expect(context.credits).toEqual([]);
    expect(context.paidThisPeriod).toBeNull();
    expect(context.lines).toEqual([
      expect.objectContaining({ kind: "reversal", name: "Payment reversal", reference: october.receiptNumber, amount: "500.00" }),
    ]);
    // 1,000 billed, 500 paid in October (so 500 carried in), the payment reversed in November.
    expect(context).toMatchObject({ balanceBefore: "500.00", bill: { total: "500.00" }, balanceAfter: "1000.00" });
  });

  it("prints a refund as a debit row and totals it", async () => {
    const paid = await payment("100000", "2026-11-05T06:00:00Z", "refund-payment");
    const refund = await accountant().recordRefund({
      ...scope(), paymentId: paid.id, amountMinor: "20000", method: "cash", reason: "Overpaid",
      effectiveAt: "2026-11-15T06:00:00Z", idempotencyKey: createFinanceIdempotencyKey("refund"),
    });
    const context = await billDue("2026-11-24");
    expect(context.lines).toEqual([expect.objectContaining({ kind: "refund", name: "Refund", reference: refund.refundNumber, note: "Overpaid", amount: "200.00" })]);
    expect(context).toMatchObject({ refundThisPeriod: "200.00", paidThisPeriod: "1000.00", balanceBefore: null, balanceAfter: "-800.00" });
  });

  it("passes zero amounts as null so templates hide them, but always the amount due", async () => {
    await manualBill("2026-10-01", [{ title: "October fee", amountMinor: "50000" }], "settled-bill");
    await payment("50000", "2026-10-02T06:00:00Z", "settled-payment");
    const context = await billDue("2026-11-24");
    expect(context).toMatchObject({
      lines: [],
      credits: [],
      balanceBefore: null,
      paidThisPeriod: null,
      discountThisPeriod: null,
      refundThisPeriod: null,
      balanceAfter: "0.00",
      bill: { total: "0.00" },
    });
    const html = renderDocument("{{#if balanceBefore}}OPENING{{/if}}{{#if paidThisPeriod}}PAID{{/if}}DUE {{balanceAfter}}", context);
    expect(html).toBe("DUE 0.00");
  });

  it("uses the session's anchored quarter as the period", async () => {
    await db
      .update(schoolSessionTable)
      .set({ financeConfig: createFinanceConfig({ recurring: "quarterly", cycleStartMonth: 4 }) })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    await manualBill("2026-09-30", [{ title: "Previous quarter", amountMinor: "10000" }], "q2");
    await manualBill("2026-10-01", [{ title: "This quarter", amountMinor: "20000" }], "q3");
    const context = await billDue("2026-11-24");
    expect(context).toMatchObject({
      bill: { periodKey: "quarterly:2026-10", period: { cadence: "quarterly", start: { iso: "2026-10-01" }, end: { iso: "2026-12-31" } } },
      lines: [expect.objectContaining({ name: "This quarter" })],
      balanceBefore: "100.00",
      balanceAfter: "300.00",
    });
  });

  it("accepts a future date and prints everyone in a class scope, a student with no activity from the current records", async () => {
    await manualBill("2026-11-01", [{ title: "Tuition", amountMinor: "100000" }], "class-bill");
    const quiet = await createTestAdmission({ schoolId: scenario.school.id });
    await createTestStudent({ schoolId: scenario.school.id, admissionId: quiet.id, sessionId: scenario.activeSession.id, classId: scenario.schoolClass.id, sectionId: scenario.section.id, rollNo: 2 });
    const both = await buildFinanceDocumentContexts(db, scenario.school.id, { ...source("2026-11-24"), recipients: { kind: "class", classId: scenario.schoolClass.id } });
    expect(both.contexts).toHaveLength(2);
    expect(both.contexts[1]).toMatchObject({
      admission: { name: quiet.name, number: quiet.admissionNo, classLabel: scenario.schoolClass.label, rollNumber: "2" },
      lines: [],
      credits: [],
      balanceBefore: null,
      balanceAfter: "0.00",
    });
    // The account with no fact is reviewed with no cutoff.
    expect(both.financeSource).toMatchObject({ accounts: expect.arrayContaining([{ admissionId: quiet.id, highWaterSequence: null }]) });
    const template = await accountant().selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: "bill", slug: "standard-bill", expectedRevisionId: null });
    const preview = await scenario.actors.accountant.client.school.previewDocument({
      schoolId: scenario.school.id,
      // Today is 24 November: a date in January is in the future, and still accepted.
      source: { documentType: "bill_due", sessionId: scenario.activeSession.id, throughDate: "2027-01-15", recipients: { kind: "class", classId: scenario.schoolClass.id } },
      templateRevisionId: template.revisionId,
    });
    expect(preview).toMatchObject({ documentCount: 2, warnings: [] });
    expect(preview.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.html).toContain("DUE/15/01/2027");
    // A statement still refuses the same future date.
    await expect(buildFinanceDocumentContexts(db, scenario.school.id, { documentType: "statement", sessionId: scenario.activeSession.id, admissionIds: [scenario.admission.id], throughDate: "2027-01-15" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A date outside the session is refused.
    await expect(billDue("2027-04-01")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is generated through the job pipeline, bound to the reviewed ledger, with the statement's permissions", async () => {
    await manualBill("2026-11-01", [{ title: "Tuition", amountMinor: "100000" }], "job-bill");
    const template = await accountant().selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: "bill", slug: "standard-bill", expectedRevisionId: null });
    const input = { schoolId: scenario.school.id, source: source("2026-11-24"), templateRevisionId: template.revisionId };
    await expect(scenario.actors.teacher.client.school.previewDocument(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.actors.platformAdmin.client.school.generateDocument(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Generation needs the preview's review hash.
    await expect(accountant().generateDocument(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const preview = await accountant().previewDocument(input);
    await payment("1000", "2026-11-20T06:00:00Z", "after-preview");
    await expect(accountant().generateDocument({ ...input, source: { ...input.source, expectedReviewHash: preview.reviewHash! } })).rejects.toMatchObject({ code: "CONFLICT" });

    const fresh = await accountant().previewDocument(input);
    const generated = await generateDocumentNow(scenario.actors.accountant.client, { ...input, source: { ...input.source, expectedReviewHash: fresh.reviewHash! } });
    expect(generated.artifact).toMatchObject({
      documentType: "bill_due",
      pageSize: "half",
      templateRevisionId: template.revisionId,
      financeSource: { kind: "bill_due", currency: "INR", throughDate: "2026-11-24", period: { cadence: "monthly", startDate: "2026-11-01", endDate: "2026-12-01" }, accounts: [{ admissionId: scenario.admission.id }] },
    });
    // Finance history lists it; a Bill due has no template of its own.
    const history = await accountant().listDocumentArtifacts({ schoolId: scenario.school.id, filters: { documentDomain: "finance", sessionId: scenario.activeSession.id } });
    expect(history.items.map((item) => item.documentType)).toContain("bill_due");
    await expect(accountant().getActiveDocumentTemplate({ schoolId: scenario.school.id, documentType: "bill_due" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a class, session or admissions of another school", async () => {
    const outsider = await createTestAdmission({ schoolId: scenario.outsiderSchool.id });
    const otherSession = await createTestSession({ schoolId: scenario.outsiderSchool.id, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true });
    const { schoolClass: otherClass } = await createTestClass({ schoolId: scenario.outsiderSchool.id });
    await expect(buildFinanceDocumentContexts(db, scenario.school.id, { ...source("2026-11-24"), recipients: { kind: "admissions", admissionIds: [scenario.admission.id, outsider.id] } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(buildFinanceDocumentContexts(db, scenario.school.id, { ...source("2026-11-24"), recipients: { kind: "class", classId: otherClass.id } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(buildFinanceDocumentContexts(db, scenario.school.id, { ...source("2026-11-24"), sessionId: otherSession.id, recipients: { kind: "session" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const template = await accountant().selectMarketplaceTemplate({ schoolId: scenario.school.id, documentType: "bill", slug: "standard-bill", expectedRevisionId: null });
    await expect(accountant().previewDocument({ schoolId: scenario.school.id, source: { ...source("2026-11-24"), recipients: { kind: "admissions", admissionIds: [outsider.id] } }, templateRevisionId: template.revisionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("totals the credits that are neither payments nor discounts, so a design printing only those two still adds up", async () => {
    const november = await manualBill("2026-11-01", [{ title: "Tuition", amountMinor: "100000" }], "other-credits");
    await payment("40000", "2026-11-05T06:00:00Z", "other-credits-payment");
    await accountant().recordAdjustment({
      ...scope(), currency: "INR", kind: "waiver", billId: november.id,
      calculation: { kind: "fixed", amountMinor: "10000" }, reasonCode: "SCHOLARSHIP", reasonNote: "Merit scholarship",
      effectiveAt: "2026-11-06T06:00:00Z", idempotencyKey: createFinanceIdempotencyKey("other-credits-waiver"),
    });
    const context = await billDue("2026-11-24");
    expect(context).toMatchObject({ paidThisPeriod: "400.00", discountThisPeriod: null, waiverThisPeriod: "100.00", otherCreditsThisPeriod: "100.00", balanceAfter: "500.00" });
    expect((await billDue("2026-10-31")).otherCreditsThisPeriod).toBeNull();
  });

  it("gives ordinary bills their run's period, null for a bill without one, and hides a zero opening balance", async () => {
    const manual = await manualBill("2026-11-01", [{ title: "Tuition", amountMinor: "100000" }], "ordinary-manual");
    const result = await buildFinanceDocumentContexts(db, scenario.school.id, { documentType: "bill", sessionId: scenario.activeSession.id, billIds: [manual.id] });
    expect(result.contexts[0]).toMatchObject({
      bill: { number: manual.billNumber, period: null, periodKey: null },
      billDue: null,
      credits: [],
      balanceBefore: null,
      balanceAfter: "1000.00",
      paidThisPeriod: null,
      lines: [{ kind: "bill_line", name: "Tuition", billNumber: manual.billNumber, issueDate: { iso: "2026-11-01" } }],
    });
  });
});
