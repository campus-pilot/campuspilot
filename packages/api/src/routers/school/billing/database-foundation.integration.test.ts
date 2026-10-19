import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import {
  financeAdmissionBalanceTable,
  financeAdmissionSessionActivityTable,
  financeAdjustmentTable,
  financeBillLineTable,
  financeBillRunTable,
  financeBillTable,
  financeLedgerEntryTable,
  financePaymentAllocationTable,
  financePaymentTable,
  financeRefundTable,
} from "@campuspilot/db/schema/finance";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  rebuildAdmissionProjection,
  reconcileAdmissionProjection,
} from "./reconciliation";
import { allocateFinanceNumber } from "./numbering";
import { lockFinanceAdmissionAccount } from "./account-lock";
import {
  createTestAdmission,
  createTestSchool,
  createTestSession,
} from "../../../../test/fixtures";
import { createFinanceScenario } from "../../../../test/finance/scenario";

type LedgerInput = {
  schoolId: string;
  admissionId: string;
  sessionId: string;
  sequence: bigint;
  type?:
    | "bill"
    | "manual_debit_adjustment"
    | "payment"
    | "discount"
    | "waiver"
    | "write_off"
    | "refund"
    | "debit_correction"
    | "credit_correction"
    | "reversal";
  direction?: "debit" | "credit";
  amountMinor?: bigint;
  currency?: string;
  reversalOfEntryId?: string;
  idempotencyKey?: string;
};

async function insertLedgerEntry(input: LedgerInput) {
  const [entry] = await db
    .insert(financeLedgerEntryTable)
    .values({
      schoolId: input.schoolId,
      admissionId: input.admissionId,
      sessionId: input.sessionId,
      sequence: input.sequence,
      type: input.type ?? "bill",
      direction: input.direction ?? "debit",
      amountMinor: input.amountMinor ?? 10_000n,
      currency: input.currency ?? "INR",
      effectiveAt: new Date("2040-04-01T00:00:00.000Z"),
      recordedBy: "finance-test-user",
      reversalOfEntryId: input.reversalOfEntryId,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
    })
    .returning();
  return entry!;
}

async function expectDatabaseCause(
  operation: PromiseLike<unknown>,
  expectedMessage: string,
) {
  try {
    await operation;
    throw new Error("Expected the database operation to fail");
  } catch (error) {
    const messages: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current instanceof Error && !seen.has(current)) {
      seen.add(current);
      messages.push(current.message);
      current = current.cause;
    }
    expect(messages).toContain(expectedMessage);
  }
}

function billRunValues(
  scenario: Awaited<ReturnType<typeof createFinanceScenario>>,
  overrides: Partial<typeof financeBillRunTable.$inferInsert> = {},
): typeof financeBillRunTable.$inferInsert {
  return {
    schoolId: scenario.school.id,
    sessionId: scenario.activeSession.id,
    kind: "regular",
    periodKey: "monthly:2040-04",
    periodStartDate: "2040-04-01",
    periodEndDate: "2040-05-01",
    periodStartAt: new Date("2040-03-31T18:30:00.000Z"),
    periodEndAt: new Date("2040-04-30T18:30:00.000Z"),
    issueDate: "2040-04-01",
    timeZone: "Asia/Kolkata",
    cadence: "monthly",
    currency: "INR",
    configHash: randomUUID(),
    configSnapshot: {},
    inputSnapshot: {},
    totalAmountMinor: 0n,
    billCount: 0,
    idempotencyKey: randomUUID(),
    recordedBy: "finance-test-user",
    ...overrides,
  };
}

function manualBillValues(
  scenario: Awaited<ReturnType<typeof createFinanceScenario>>,
  ledgerEntryId: string,
  overrides: Partial<typeof financeBillTable.$inferInsert> = {},
): typeof financeBillTable.$inferInsert {
  return {
    schoolId: scenario.school.id,
    admissionId: scenario.admission.id,
    sessionId: scenario.activeSession.id,
    ledgerEntryId,
    sourceKind: "manual",
    manualReason: "Reviewed correction",
    billNumber: `BILL/${randomUUID()}`,
    issueDate: "2040-04-01",
    currency: "INR",
    totalAmountMinor: 10_000n,
    lineCount: 1,
    admissionNumberSnapshot: scenario.admission.admissionNo,
    admissionNameSnapshot: scenario.admission.name,
    sessionStartYearSnapshot: 2040,
    sessionEndYearSnapshot: 2041,
    recordedBy: "finance-test-user",
    ...overrides,
  };
}

describe("finance database foundation", () => {
  it("enforces exact admission-number uniqueness within each school", async () => {
    const [school, otherSchool] = await Promise.all([
      createTestSchool(),
      createTestSchool(),
    ]);
    await createTestAdmission({ schoolId: school.id, admissionNo: "ADM-42" });

    await expect(
      createTestAdmission({ schoolId: school.id, admissionNo: "ADM-42" }),
    ).rejects.toThrow();
    await expect(
      createTestAdmission({
        schoolId: otherSchool.id,
        admissionNo: "ADM-42",
      }),
    ).resolves.toMatchObject({ admissionNo: "ADM-42" });
  });

  it("rejects cross-tenant admission and session combinations", async () => {
    const scenario = await createFinanceScenario();
    const outsiderAdmission = await createTestAdmission({
      schoolId: scenario.outsiderSchool.id,
    });

    await expect(
      insertLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: outsiderAdmission.id,
        sessionId: scenario.activeSession.id,
        sequence: 1n,
      }),
    ).rejects.toThrow();
    await expect(
      insertLedgerEntry({
        schoolId: scenario.outsiderSchool.id,
        admissionId: outsiderAdmission.id,
        sessionId: scenario.activeSession.id,
        sequence: 1n,
      }),
    ).rejects.toThrow();
  });

  it("enforces exact amounts, sequence, idempotency, and one reversal per target", async () => {
    const scenario = await createFinanceScenario();
    const original = await insertLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: 1n,
      idempotencyKey: "bill-command",
    });

    await expect(
      insertLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        sequence: 1n,
      }),
    ).rejects.toThrow();
    await expect(
      insertLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        sequence: 2n,
        idempotencyKey: "bill-command",
      }),
    ).rejects.toThrow();
    await expect(
      insertLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        sequence: 2n,
        amountMinor: 0n,
      }),
    ).rejects.toThrow();
    await expect(
      insertLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        sequence: 2n,
        direction: "credit",
      }),
    ).rejects.toThrow();
    await expect(
      insertLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        sequence: 2n,
        currency: "inr",
      }),
    ).rejects.toThrow();

    await insertLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: 2n,
      type: "reversal",
      direction: "credit",
      reversalOfEntryId: original.id,
    });
    await expect(
      insertLedgerEntry({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        sequence: 3n,
        type: "reversal",
        direction: "credit",
        reversalOfEntryId: original.id,
      }),
    ).rejects.toThrow();
  });

  it("enforces regular-run, command, and human bill-number uniqueness", async () => {
    const scenario = await createFinanceScenario();
    const firstRun = billRunValues(scenario, {
      idempotencyKey: "run-command-1",
    });
    const [run] = await db
      .insert(financeBillRunTable)
      .values(firstRun)
      .returning();

    await expect(
      db.insert(financeBillRunTable).values(
        billRunValues(scenario, {
          idempotencyKey: "run-command-2",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.insert(financeBillRunTable).values(
        billRunValues(scenario, {
          kind: "supplemental",
          supplementalReason: "Correction requested by the school",
          periodKey: "monthly:2040-05",
          idempotencyKey: "run-command-1",
        }),
      ),
    ).rejects.toThrow();

    const firstEntry = await insertLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: 1n,
    });
    await db.insert(financeBillTable).values({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      billRunId: run!.id,
      ledgerEntryId: firstEntry.id,
      sourceKind: "billing_run",
      billNumber: "BILL/2040-41/000001",
      issueDate: "2040-04-01",
      periodKey: "monthly:2040-04",
      currency: "INR",
      totalAmountMinor: 10_000n,
      lineCount: 1,
      admissionNumberSnapshot: scenario.admission.admissionNo,
      admissionNameSnapshot: scenario.admission.name,
      sessionStartYearSnapshot: 2040,
      sessionEndYearSnapshot: 2041,
      recordedBy: "finance-test-user",
    });
    const secondEntry = await insertLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: 2n,
      type: "manual_debit_adjustment",
    });
    await expect(
      db.insert(financeBillTable).values({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        ledgerEntryId: secondEntry.id,
        sourceKind: "manual",
        manualReason: "Additional charge",
        billNumber: "BILL/2040-41/000001",
        issueDate: "2040-04-02",
        currency: "INR",
        totalAmountMinor: 10_000n,
        lineCount: 1,
        admissionNumberSnapshot: scenario.admission.admissionNo,
        admissionNameSnapshot: scenario.admission.name,
        sessionStartYearSnapshot: 2040,
        sessionEndYearSnapshot: 2041,
        recordedBy: "finance-test-user",
      }),
    ).rejects.toThrow();
  });

  it("keeps posted facts immutable and restricts parent deletion", async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2060,
      sessionEndYear: 2061,
      isActive: false,
    });
    const admission = await createTestAdmission({ schoolId: school.id });
    const entry = await insertLedgerEntry({
      schoolId: school.id,
      admissionId: admission.id,
      sessionId: session.id,
      sequence: 1n,
    });

    await expect(
      db
        .update(financeLedgerEntryTable)
        .set({ note: "mutation is forbidden" })
        .where(eq(financeLedgerEntryTable.id, entry.id)),
    ).rejects.toThrow();
    await expect(
      db
        .delete(financeLedgerEntryTable)
        .where(eq(financeLedgerEntryTable.id, entry.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(admissionTable).where(eq(admissionTable.id, admission.id)),
    ).rejects.toThrow();
    await expect(
      db
        .delete(schoolSessionTable)
        .where(eq(schoolSessionTable.id, session.id)),
    ).rejects.toThrow();
  });

  it("detects projection corruption and rebuilds lifetime and session caches", async () => {
    const scenario = await createFinanceScenario();
    const key = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      currency: "INR",
    };
    await insertLedgerEntry({
      ...key,
      sessionId: scenario.activeSession.id,
      sequence: 1n,
      amountMinor: 10_000n,
    });
    await insertLedgerEntry({
      ...key,
      sessionId: scenario.historicalSession.id,
      sequence: 2n,
      type: "payment",
      direction: "credit",
      amountMinor: 3_000n,
    });

    await rebuildAdmissionProjection(db, key);
    await expect(reconcileAdmissionProjection(db, key)).resolves.toMatchObject({
      matches: true,
    });
    const [balance] = await db
      .select()
      .from(financeAdmissionBalanceTable)
      .where(eq(financeAdmissionBalanceTable.admissionId, key.admissionId));
    expect(balance).toMatchObject({
      lastSequence: 2n,
      debitTotalMinor: 10_000n,
      creditTotalMinor: 3_000n,
    });
    const activities = await db
      .select()
      .from(financeAdmissionSessionActivityTable)
      .where(
        eq(financeAdmissionSessionActivityTable.admissionId, key.admissionId),
      );
    expect(activities).toHaveLength(2);

    await db
      .update(financeAdmissionBalanceTable)
      .set({ debitTotalMinor: 1n })
      .where(eq(financeAdmissionBalanceTable.admissionId, key.admissionId));
    await expect(reconcileAdmissionProjection(db, key)).resolves.toMatchObject({
      matches: false,
    });
    await rebuildAdmissionProjection(db, key);
    await expect(reconcileAdmissionProjection(db, key)).resolves.toMatchObject({
      matches: true,
    });
  });

  it("treats an empty account as reconciled and returns JSON-safe totals", async () => {
    const scenario = await createFinanceScenario();
    const key = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      currency: "INR",
    };
    await expect(reconcileAdmissionProjection(db, key)).resolves.toEqual({
      matches: true,
      expected: {
        lifetime: {
          lastSequence: "0",
          entryCount: "0",
          debitTotalMinor: "0",
          creditTotalMinor: "0",
        },
        sessions: [],
      },
      actual: { lifetime: null, sessions: [] },
    });
  });

  it("rejects mismatched reversals and reversal-of-reversal", async () => {
    const scenario = await createFinanceScenario();
    const base = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    };
    const original = await insertLedgerEntry({ ...base, sequence: 1n });
    await expect(
      insertLedgerEntry({
        ...base,
        sequence: 2n,
        type: "reversal",
        direction: "credit",
        amountMinor: 9_999n,
        reversalOfEntryId: original.id,
      }),
    ).rejects.toThrow();
    const reversal = await insertLedgerEntry({
      ...base,
      sequence: 2n,
      type: "reversal",
      direction: "credit",
      reversalOfEntryId: original.id,
    });
    await expect(
      insertLedgerEntry({
        ...base,
        sequence: 3n,
        type: "reversal",
        direction: "debit",
        reversalOfEntryId: reversal.id,
      }),
    ).rejects.toThrow();
  });

  it("binds bills, lines, payments, adjustments, refunds, and allocations to exact accounting identity", async () => {
    const scenario = await createFinanceScenario();
    const base = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    };
    const billEntry = await insertLedgerEntry({
      ...base,
      sequence: 1n,
      type: "manual_debit_adjustment",
    });
    await expect(
      db.insert(financeBillTable).values(
        manualBillValues(scenario, billEntry.id, { totalAmountMinor: 9_999n }),
      ),
    ).rejects.toThrow();
    const [bill] = await db
      .insert(financeBillTable)
      .values(manualBillValues(scenario, billEntry.id))
      .returning();
    await expect(
      db.insert(financeBillLineTable).values({
        schoolId: scenario.school.id,
        billId: bill!.id,
        lineOrder: 0,
        feeElementSlug: "tuition",
        feeElementName: "Tuition",
        amountMinor: 10_000n,
        currency: "USD",
        pricingSourceKind: "manual",
        pricingRuleSnapshot: {},
        manualReason: "Test",
      }),
    ).rejects.toThrow();
    await db.insert(financeBillLineTable).values({
      schoolId: scenario.school.id,
      billId: bill!.id,
      lineOrder: 0,
      feeElementSlug: "tuition",
      feeElementName: "Tuition",
      amountMinor: 10_000n,
      currency: "INR",
      pricingSourceKind: "manual",
      pricingRuleSnapshot: {},
      manualReason: "Test",
    });
    await db
      .update(financeBillTable)
      .set({ status: "posted", finalizedAt: new Date() })
      .where(eq(financeBillTable.id, bill!.id));

    const paymentEntry = await insertLedgerEntry({
      ...base,
      sequence: 2n,
      type: "payment",
      direction: "credit",
      amountMinor: 12_000n,
    });
    await expect(
      db.insert(financePaymentTable).values({
        ...base,
        ledgerEntryId: paymentEntry.id,
        receiptNumber: `R/${randomUUID()}`,
        amountMinor: 11_999n,
        currency: "INR",
        method: "cash",
        receivedAt: new Date(),
        idempotencyKey: randomUUID(),
        recordedBy: "finance-test-user",
      }),
    ).rejects.toThrow();
    const [payment] = await db
      .insert(financePaymentTable)
      .values({
        ...base,
        ledgerEntryId: paymentEntry.id,
        receiptNumber: `R/${randomUUID()}`,
        amountMinor: 12_000n,
        currency: "INR",
        method: "cash",
        receivedAt: new Date(),
        idempotencyKey: randomUUID(),
        recordedBy: "finance-test-user",
      })
      .returning();

    const adjustmentEntry = await insertLedgerEntry({
      ...base,
      sequence: 3n,
      type: "discount",
      direction: "credit",
      amountMinor: 500n,
    });
    await expect(
      db.insert(financeAdjustmentTable).values({
        ...base,
        ledgerEntryId: adjustmentEntry.id,
        kind: "waiver",
        amountMinor: 500n,
        currency: "INR",
        reasonCode: "TEST",
        reasonNote: "Mismatch",
        calculationSnapshot: {},
        idempotencyKey: randomUUID(),
        recordedBy: "finance-test-user",
      }),
    ).rejects.toThrow();

    const refundEntry = await insertLedgerEntry({
      ...base,
      sequence: 4n,
      type: "refund",
      direction: "debit",
      amountMinor: 1_000n,
    });
    await expect(
      db.insert(financeRefundTable).values({
        ...base,
        paymentId: payment!.id,
        ledgerEntryId: refundEntry.id,
        refundNumber: `RF/${randomUUID()}`,
        amountMinor: 999n,
        currency: "INR",
        method: "cash",
        reason: "Mismatch",
        idempotencyKey: randomUUID(),
        recordedBy: "finance-test-user",
      }),
    ).rejects.toThrow();

    await db.insert(financePaymentAllocationTable).values({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      paymentId: payment!.id,
      billId: bill!.id,
      amountMinor: 10_000n,
      currency: "INR",
    });
    const secondBillEntry = await insertLedgerEntry({
      ...base,
      sequence: 5n,
      type: "manual_debit_adjustment",
      amountMinor: 5_000n,
    });
    const [secondBill] = await db
      .insert(financeBillTable)
      .values(
        manualBillValues(scenario, secondBillEntry.id, {
          totalAmountMinor: 5_000n,
        }),
      )
      .returning();
    await db.insert(financeBillLineTable).values({
      schoolId: scenario.school.id,
      billId: secondBill!.id,
      lineOrder: 0,
      feeElementSlug: "fee",
      feeElementName: "Fee",
      amountMinor: 5_000n,
      currency: "INR",
      pricingSourceKind: "manual",
      pricingRuleSnapshot: {},
      manualReason: "Test",
    });
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, secondBill!.id));
    await expect(
      db.insert(financePaymentAllocationTable).values({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        paymentId: payment!.id,
        billId: secondBill!.id,
        amountMinor: 3_000n,
        currency: "INR",
      }),
    ).rejects.toThrow();

    const [run] = await db.insert(financeBillRunTable).values(
      billRunValues(scenario, { totalAmountMinor: 10_000n, billCount: 1 }),
    ).returning();
    const runEntry = await insertLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: 6n,
      type: "bill",
    });
    const [runBill] = await db.insert(financeBillTable).values({
      ...manualBillValues(scenario, runEntry.id),
      sourceKind: "billing_run",
      manualReason: null,
      billRunId: run!.id,
      periodKey: "monthly:2040-04",
    }).returning();
    await db.insert(financeBillLineTable).values({
      schoolId: scenario.school.id,
      billId: runBill!.id,
      lineOrder: 0,
      feeElementSlug: "fee",
      feeElementName: "Fee",
      amountMinor: 10_000n,
      currency: "INR",
      pricingSourceKind: "manual",
      pricingRuleSnapshot: {},
      manualReason: "Test",
    });
    await expect(
      db.update(financeBillRunTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillRunTable.id, run!.id)),
    ).rejects.toThrow();
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, runBill!.id));
    await db.update(financeBillRunTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillRunTable.id, run!.id));
    const lateEntry = await insertLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: 7n,
      type: "bill",
    });
    await expect(
      db.insert(financeBillTable).values({
        ...manualBillValues(scenario, lateEntry.id),
        sourceKind: "billing_run",
        manualReason: null,
        billRunId: run!.id,
        periodKey: "monthly:2040-04",
      }),
    ).rejects.toThrow();
  });

  it("prevents post-finalization members and rejects unreconciled headers", async () => {
    const scenario = await createFinanceScenario();
    await expect(db.insert(financeBillRunTable).values(billRunValues(scenario, { status: "posted" }))).rejects.toThrow();
    await expect(db.insert(financeBillRunTable).values(billRunValues(scenario, { finalizedAt: new Date() }))).rejects.toThrow();
    await expectDatabaseCause(
      db.insert(financeBillRunTable).values(billRunValues(scenario, { status: "posted", finalizedAt: new Date() })),
      "Bill runs must be inserted in posting state and finalized through the validated transition",
    );
    const entry = await insertLedgerEntry({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
      sequence: 1n,
      type: "manual_debit_adjustment",
    });
    await expect(db.insert(financeBillTable).values(manualBillValues(scenario, entry.id, { status: "posted" }))).rejects.toThrow();
    await expect(db.insert(financeBillTable).values(manualBillValues(scenario, entry.id, { finalizedAt: new Date() }))).rejects.toThrow();
    await expectDatabaseCause(
      db.insert(financeBillTable).values(manualBillValues(scenario, entry.id, { status: "posted", finalizedAt: new Date() })),
      "Bills must be inserted in posting state and finalized through the validated transition",
    );
    const [bill] = await db.insert(financeBillTable).values(manualBillValues(scenario, entry.id)).returning();
    await expect(
      db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, bill!.id)),
    ).rejects.toThrow();
    await db.insert(financeBillLineTable).values({
      schoolId: scenario.school.id,
      billId: bill!.id,
      lineOrder: 0,
      feeElementSlug: "fee",
      feeElementName: "Fee",
      amountMinor: 10_000n,
      currency: "INR",
      pricingSourceKind: "manual",
      pricingRuleSnapshot: {},
      manualReason: "Test",
    });
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, bill!.id));
    await expect(
      db.insert(financeBillLineTable).values({
        schoolId: scenario.school.id,
        billId: bill!.id,
        lineOrder: 1,
        feeElementSlug: "late",
        feeElementName: "Late",
        amountMinor: 0n,
        currency: "INR",
        pricingSourceKind: "manual",
        pricingRuleSnapshot: {},
        manualReason: "Late",
      }),
    ).rejects.toThrow();
  });

  it("allocates human-number counters without duplicates under races", async () => {
    const scenario = await createFinanceScenario();
    const values = await Promise.all(
      Array.from({ length: 12 }, () =>
        db.transaction((transaction) =>
          allocateFinanceNumber(transaction, {
            schoolId: scenario.school.id,
            sessionId: scenario.activeSession.id,
            kind: "bill",
          }),
        ),
      ),
    );
    expect(new Set(values.map((value) => value.sequence)).size).toBe(12);
    expect(values.map((value) => value.sequence).toSorted()).toEqual(
      Array.from({ length: 12 }, (_, index) => String(index + 1)).toSorted(),
    );
    await expect(
      db.transaction(async (transaction) => {
        await allocateFinanceNumber(transaction, {
          schoolId: scenario.school.id,
          sessionId: scenario.activeSession.id,
          kind: "bill",
        });
        throw new Error("rollback posting");
      }),
    ).rejects.toThrow("rollback posting");
    const retry = await db.transaction((transaction) =>
      allocateFinanceNumber(transaction, {
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        kind: "bill",
      }),
    );
    expect(retry).toMatchObject({ sequence: "13" });
    expect(retry.number).toContain("/2040-2041/");
  });

  it("serializes rebuilds with posters through the shared account lock", async () => {
    const scenario = await createFinanceScenario();
    const key = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      currency: "INR",
    };
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => { locked = resolve; });
    const poster = db.transaction(async (transaction) => {
      await lockFinanceAdmissionAccount(transaction, key.schoolId, key.admissionId);
      locked();
      await hold;
      await transaction.insert(financeLedgerEntryTable).values({
        schoolId: key.schoolId,
        admissionId: key.admissionId,
        sessionId: scenario.activeSession.id,
        sequence: 1n,
        type: "bill",
        direction: "debit",
        amountMinor: 1_000n,
        currency: key.currency,
        effectiveAt: new Date(),
        recordedBy: "finance-test-user",
        idempotencyKey: randomUUID(),
      });
    });
    await hasLock;
    const rebuild = rebuildAdmissionProjection(db, key);
    release();
    await Promise.all([poster, rebuild]);
    await expect(reconcileAdmissionProjection(db, key)).resolves.toMatchObject({ matches: true });
  });

  it("uses effective reversals and bill credits for refund and allocation capacity", async () => {
    const scenario = await createFinanceScenario();
    const base = { schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id };
    const billEntry = await insertLedgerEntry({ ...base, sequence: 1n, type: "manual_debit_adjustment" });
    const [bill] = await db.insert(financeBillTable).values(manualBillValues(scenario, billEntry.id)).returning();
    await db.insert(financeBillLineTable).values({ schoolId: base.schoolId, billId: bill!.id, lineOrder: 0, feeElementSlug: "fee", feeElementName: "Fee", amountMinor: 10_000n, currency: "INR", pricingSourceKind: "manual", pricingRuleSnapshot: {}, manualReason: "Test" });
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, bill!.id));
    const discountEntry = await insertLedgerEntry({ ...base, sequence: 2n, type: "discount", direction: "credit", amountMinor: 2_000n });
    await db.insert(financeAdjustmentTable).values({ ...base, ledgerEntryId: discountEntry.id, billId: bill!.id, kind: "discount", amountMinor: 2_000n, currency: "INR", reasonCode: "AID", reasonNote: "Approved", calculationSnapshot: {}, idempotencyKey: randomUUID(), recordedBy: "finance-test-user" });
    const paymentEntry = await insertLedgerEntry({ ...base, sequence: 3n, type: "payment", direction: "credit", amountMinor: 10_000n });
    const [payment] = await db.insert(financePaymentTable).values({ ...base, ledgerEntryId: paymentEntry.id, receiptNumber: `R/${randomUUID()}`, amountMinor: 10_000n, currency: "INR", method: "cash", receivedAt: new Date(), idempotencyKey: randomUUID(), recordedBy: "finance-test-user" }).returning();
    await expect(db.insert(financePaymentAllocationTable).values({ schoolId: base.schoolId, admissionId: base.admissionId, paymentId: payment!.id, billId: bill!.id, amountMinor: 8_001n, currency: "INR" })).rejects.toThrow();
    await db.insert(financePaymentAllocationTable).values({ schoolId: base.schoolId, admissionId: base.admissionId, paymentId: payment!.id, billId: bill!.id, amountMinor: 8_000n, currency: "INR" });
    await expect(insertLedgerEntry({ ...base, sequence: 4n, type: "reversal", direction: "debit", amountMinor: 10_000n, reversalOfEntryId: paymentEntry.id })).rejects.toThrow();
    await expect(insertLedgerEntry({ ...base, sequence: 4n, type: "reversal", direction: "credit", reversalOfEntryId: billEntry.id })).rejects.toThrow();

    const paymentEntry2 = await insertLedgerEntry({ ...base, sequence: 4n, type: "payment", direction: "credit", amountMinor: 5_000n });
    const [payment2] = await db.insert(financePaymentTable).values({ ...base, ledgerEntryId: paymentEntry2.id, receiptNumber: `R/${randomUUID()}`, amountMinor: 5_000n, currency: "INR", method: "cash", receivedAt: new Date(), idempotencyKey: randomUUID(), recordedBy: "finance-test-user" }).returning();
    await insertLedgerEntry({ ...base, sequence: 5n, type: "reversal", direction: "debit", amountMinor: 5_000n, reversalOfEntryId: paymentEntry2.id });
    const reversedPaymentRefund = await insertLedgerEntry({ ...base, sequence: 6n, type: "refund", direction: "debit", amountMinor: 1_000n });
    await expect(db.insert(financeRefundTable).values({ ...base, paymentId: payment2!.id, ledgerEntryId: reversedPaymentRefund.id, refundNumber: `RF/${randomUUID()}`, amountMinor: 1_000n, currency: "INR", method: "cash", reason: "Test", idempotencyKey: randomUUID(), recordedBy: "finance-test-user" })).rejects.toThrow();

    const paymentEntry3 = await insertLedgerEntry({ ...base, sequence: 7n, type: "payment", direction: "credit", amountMinor: 5_000n });
    const [payment3] = await db.insert(financePaymentTable).values({ ...base, ledgerEntryId: paymentEntry3.id, receiptNumber: `R/${randomUUID()}`, amountMinor: 5_000n, currency: "INR", method: "cash", receivedAt: new Date(), idempotencyKey: randomUUID(), recordedBy: "finance-test-user" }).returning();
    const refundEntry = await insertLedgerEntry({ ...base, sequence: 8n, type: "refund", direction: "debit", amountMinor: 4_000n });
    await db.insert(financeRefundTable).values({ ...base, paymentId: payment3!.id, ledgerEntryId: refundEntry.id, refundNumber: `RF/${randomUUID()}`, amountMinor: 4_000n, currency: "INR", method: "cash", reason: "Test", idempotencyKey: randomUUID(), recordedBy: "finance-test-user" });
    await insertLedgerEntry({ ...base, sequence: 9n, type: "reversal", direction: "credit", amountMinor: 4_000n, reversalOfEntryId: refundEntry.id });
    const replacementRefund = await insertLedgerEntry({ ...base, sequence: 10n, type: "refund", direction: "debit", amountMinor: 5_000n });
    await expect(db.insert(financeRefundTable).values({ ...base, paymentId: payment3!.id, ledgerEntryId: replacementRefund.id, refundNumber: `RF/${randomUUID()}`, amountMinor: 5_000n, currency: "INR", method: "cash", reason: "Replacement", idempotencyKey: randomUUID(), recordedBy: "finance-test-user" })).resolves.toBeDefined();
    const cumulativeCredit = await insertLedgerEntry({ ...base, sequence: 11n, type: "waiver", direction: "credit", amountMinor: 1n });
    await expect(db.insert(financeAdjustmentTable).values({ ...base, ledgerEntryId: cumulativeCredit.id, billId: bill!.id, kind: "waiver", amountMinor: 1n, currency: "INR", reasonCode: "LIMIT", reasonNote: "Would exceed remaining outstanding", calculationSnapshot: {}, idempotencyKey: randomUUID(), recordedBy: "finance-test-user" })).rejects.toThrow();
  });

  it("serializes run finalization against concurrent member insertion", async () => {
    const scenario = await createFinanceScenario();
    const [run] = await db.insert(financeBillRunTable).values(billRunValues(scenario, { totalAmountMinor: 10_000n, billCount: 1 })).returning();
    const initialEntry = await insertLedgerEntry({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, sequence: 1n, type: "bill" });
    const [initialBill] = await db.insert(financeBillTable).values({ ...manualBillValues(scenario, initialEntry.id), sourceKind: "billing_run", manualReason: null, billRunId: run!.id, periodKey: "monthly:2040-04" }).returning();
    await db.insert(financeBillLineTable).values({ schoolId: scenario.school.id, billId: initialBill!.id, lineOrder: 0, feeElementSlug: "fee", feeElementName: "Fee", amountMinor: 10_000n, currency: "INR", pricingSourceKind: "manual", pricingRuleSnapshot: {}, manualReason: "Test" });
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, initialBill!.id));
    const entry = await insertLedgerEntry({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id, sequence: 2n, type: "bill" });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let inserted!: () => void;
    const hasInserted = new Promise<void>((resolve) => { inserted = resolve; });
    const member = db.transaction(async (transaction) => {
      await transaction.insert(financeBillTable).values({ ...manualBillValues(scenario, entry.id), sourceKind: "billing_run", manualReason: null, billRunId: run!.id, periodKey: "monthly:2040-04" });
      inserted();
      await hold;
    });
    await hasInserted;
    let finalized = false;
    const finalize = (async () => {
      try {
        await db.update(financeBillRunTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillRunTable.id, run!.id));
      } finally {
        finalized = true;
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(finalized).toBe(false);
    release();
    await member;
    await expect(finalize).rejects.toThrow();
  });

  it("serializes concurrent settlement inserts against payment and bill reversals", async () => {
    const scenario = await createFinanceScenario();
    const base = { schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id };
    const billEntry = await insertLedgerEntry({ ...base, sequence: 1n, type: "manual_debit_adjustment" });
    const [bill] = await db.insert(financeBillTable).values(manualBillValues(scenario, billEntry.id)).returning();
    await db.insert(financeBillLineTable).values({ schoolId: base.schoolId, billId: bill!.id, lineOrder: 0, feeElementSlug: "fee", feeElementName: "Fee", amountMinor: 10_000n, currency: "INR", pricingSourceKind: "manual", pricingRuleSnapshot: {}, manualReason: "Test" });
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, bill!.id));
    const paymentEntry = await insertLedgerEntry({ ...base, sequence: 2n, type: "payment", direction: "credit" });
    const [payment] = await db.insert(financePaymentTable).values({ ...base, ledgerEntryId: paymentEntry.id, receiptNumber: `R/${randomUUID()}`, amountMinor: 10_000n, currency: "INR", method: "cash", receivedAt: new Date(), idempotencyKey: randomUUID(), recordedBy: "finance-test-user" }).returning();
    const refundEntry = await insertLedgerEntry({ ...base, sequence: 3n, type: "refund", direction: "debit", amountMinor: 1_000n });
    let releasePayment!: () => void;
    const holdPayment = new Promise<void>((resolve) => { releasePayment = resolve; });
    let paymentReversed!: () => void;
    const hasPaymentReversal = new Promise<void>((resolve) => { paymentReversed = resolve; });
    const reversePayment = db.transaction(async (transaction) => {
      await transaction.insert(financeLedgerEntryTable).values({ ...base, sequence: 4n, type: "reversal", direction: "debit", amountMinor: 10_000n, currency: "INR", effectiveAt: new Date(), recordedBy: "finance-test-user", reversalOfEntryId: paymentEntry.id, idempotencyKey: randomUUID() });
      paymentReversed();
      await holdPayment;
    });
    await hasPaymentReversal;
    let allocationSettled = false;
    let refundSettled = false;
    const allocation = (async () => {
      try {
        await db.insert(financePaymentAllocationTable).values({ schoolId: base.schoolId, admissionId: base.admissionId, paymentId: payment!.id, billId: bill!.id, amountMinor: 1_000n, currency: "INR" });
        return null;
      } catch (error) {
        return error;
      } finally {
        allocationSettled = true;
      }
    })();
    const refund = (async () => {
      try {
        await db.insert(financeRefundTable).values({ ...base, paymentId: payment!.id, ledgerEntryId: refundEntry.id, refundNumber: `RF/${randomUUID()}`, amountMinor: 1_000n, currency: "INR", method: "cash", reason: "Test", idempotencyKey: randomUUID(), recordedBy: "finance-test-user" });
        return null;
      } catch (error) {
        return error;
      } finally {
        refundSettled = true;
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect({ allocationSettled, refundSettled }).toEqual({ allocationSettled: false, refundSettled: false });
    releasePayment();
    await reversePayment;
    expect(await allocation).toBeInstanceOf(Error);
    expect(await refund).toBeInstanceOf(Error);

    const creditEntry = await insertLedgerEntry({ ...base, sequence: 5n, type: "discount", direction: "credit", amountMinor: 1_000n });
    let releaseBill!: () => void;
    const holdBill = new Promise<void>((resolve) => { releaseBill = resolve; });
    let billReversed!: () => void;
    const hasBillReversal = new Promise<void>((resolve) => { billReversed = resolve; });
    const reverseBill = db.transaction(async (transaction) => {
      await transaction.insert(financeLedgerEntryTable).values({ ...base, sequence: 6n, type: "reversal", direction: "credit", amountMinor: 10_000n, currency: "INR", effectiveAt: new Date(), recordedBy: "finance-test-user", reversalOfEntryId: billEntry.id, idempotencyKey: randomUUID() });
      billReversed();
      await holdBill;
    });
    await hasBillReversal;
    let creditSettled = false;
    const credit = (async () => {
      try {
        await db.insert(financeAdjustmentTable).values({ ...base, ledgerEntryId: creditEntry.id, billId: bill!.id, kind: "discount", amountMinor: 1_000n, currency: "INR", reasonCode: "TEST", reasonNote: "Concurrent", calculationSnapshot: {}, idempotencyKey: randomUUID(), recordedBy: "finance-test-user" });
        return null;
      } catch (error) {
        return error;
      } finally {
        creditSettled = true;
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(creditSettled).toBe(false);
    releaseBill();
    await reverseBill;
    expect(await credit).toBeInstanceOf(Error);
  });

  it("serializes concurrent bill credits and allocations against one outstanding balance", async () => {
    const scenario = await createFinanceScenario();
    const base = { schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id };
    const billEntry = await insertLedgerEntry({ ...base, sequence: 1n, type: "manual_debit_adjustment" });
    const [bill] = await db.insert(financeBillTable).values(manualBillValues(scenario, billEntry.id)).returning();
    await db.insert(financeBillLineTable).values({ schoolId: base.schoolId, billId: bill!.id, lineOrder: 0, feeElementSlug: "fee", feeElementName: "Fee", amountMinor: 10_000n, currency: "INR", pricingSourceKind: "manual", pricingRuleSnapshot: {}, manualReason: "Test" });
    await db.update(financeBillTable).set({ status: "posted", finalizedAt: new Date() }).where(eq(financeBillTable.id, bill!.id));
    const paymentEntry = await insertLedgerEntry({ ...base, sequence: 2n, type: "payment", direction: "credit", amountMinor: 5_000n });
    const [payment] = await db.insert(financePaymentTable).values({ ...base, ledgerEntryId: paymentEntry.id, receiptNumber: `R/${randomUUID()}`, amountMinor: 5_000n, currency: "INR", method: "cash", receivedAt: new Date(), idempotencyKey: randomUUID(), recordedBy: "finance-test-user" }).returning();
    const creditEntry = await insertLedgerEntry({ ...base, sequence: 3n, type: "discount", direction: "credit", amountMinor: 6_000n });

    let releaseCredit!: () => void;
    const holdCredit = new Promise<void>((resolve) => { releaseCredit = resolve; });
    let creditInserted!: () => void;
    const hasCredit = new Promise<void>((resolve) => { creditInserted = resolve; });
    const credit = db.transaction(async (transaction) => {
      await transaction.insert(financeAdjustmentTable).values({ ...base, ledgerEntryId: creditEntry.id, billId: bill!.id, kind: "discount", amountMinor: 6_000n, currency: "INR", reasonCode: "TEST", reasonNote: "Concurrent", calculationSnapshot: {}, idempotencyKey: randomUUID(), recordedBy: "finance-test-user" });
      creditInserted();
      await holdCredit;
    });
    await hasCredit;

    let allocationSettled = false;
    const allocation = (async () => {
      try {
        await db.insert(financePaymentAllocationTable).values({ schoolId: base.schoolId, admissionId: base.admissionId, paymentId: payment!.id, billId: bill!.id, amountMinor: 5_000n, currency: "INR" });
        return null;
      } catch (error) {
        return error;
      } finally {
        allocationSettled = true;
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(allocationSettled).toBe(false);
    releaseCredit();
    await credit;
    expect(await allocation).toBeInstanceOf(Error);
  });
});
