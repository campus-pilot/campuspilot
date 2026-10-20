import type { Database, DatabaseExecutor, DatabaseTransaction } from "@campuspilot/db";
import { createHash } from "node:crypto";
import {
  financeAdjustmentTable,
  financeBillLineTable,
  financeBillTable,
  financeLedgerEntryTable,
  financePaymentTable,
  financeRefundTable,
} from "@campuspilot/db/schema/finance";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { studentTable } from "@campuspilot/db/schema/student";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { and, eq, inArray } from "drizzle-orm";

import { isRetryableTransactionError, rpcError } from "../../../errors";
import { lockFinanceAdmissionAccount } from "./account-lock";
import { billSettlementMap } from "./ledger-read";
import { appendFinanceLedgerEntry } from "./ledger-posting";
import { allocateFinanceNumber } from "./numbering";
import { POSTGRES_BIGINT_MAX } from "./transport";

const ZERO = BigInt(0);
const SERIALIZABLE_ATTEMPTS = 3;

/** Replays the whole idempotent command after PostgreSQL serialization/deadlock aborts. */
async function runSerializable<T>(db: Database, operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(operation, { isolationLevel: "serializable" });
    } catch (error) {
      if (attempt === SERIALIZABLE_ATTEMPTS || !isRetryableTransactionError(error)) throw error;
    }
  }
  throw new Error("Serializable retry loop exhausted unexpectedly");
}

type RecordPaymentCommand = {
  schoolId: string;
  admissionId: string;
  sessionId: string;
  amountMinor: string;
  currency: string;
  method: typeof financePaymentTable.$inferInsert.method;
  externalReference?: string | null;
  payerName?: string | null;
  receivedAt: Date;
  effectiveAt: Date;
  note?: string | null;
  idempotencyKey: string;
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Canonical immutable client command used for exact idempotency comparison. */
function paymentCommandSnapshot(command: RecordPaymentCommand) {
  return {
    schoolId: command.schoolId,
    admissionId: command.admissionId,
    sessionId: command.sessionId,
    amountMinor: command.amountMinor,
    currency: command.currency,
    method: command.method,
    externalReference: command.externalReference ?? null,
    payerName: command.payerName ?? null,
    receivedAt: command.receivedAt.toISOString(),
    effectiveAt: command.effectiveAt.toISOString(),
    note: command.note ?? null,
  };
}

async function lockSession(
  transaction: DatabaseTransaction,
  schoolId: string,
  sessionId: string,
) {
  const [session] = await transaction
    .select({
      id: schoolSessionTable.id,
      startYear: schoolSessionTable.sessionStartYear,
      endYear: schoolSessionTable.sessionEndYear,
    })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, schoolId), eq(schoolSessionTable.id, sessionId)))
    .for("update")
    .limit(1);
  if (!session) throw rpcError.notFound("School session");
  return session;
}

async function readPaymentByKey(db: DatabaseExecutor, schoolId: string, key: string) {
  const [payment] = await db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), eq(financePaymentTable.idempotencyKey, key))).limit(1);
  if (!payment) return null;
  const ledgerRows = await db.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, schoolId), eq(financeLedgerEntryTable.id, payment.ledgerEntryId))).limit(1);
  const ledger = ledgerRows[0];
  if (!ledger) throw new Error("Payment ledger entry was not found");
  return { payment, ledger };
}

function paymentTransport(value: NonNullable<Awaited<ReturnType<typeof readPaymentByKey>>>) {
  return { ...value.payment, amountMinor: value.payment.amountMinor.toString() };
}

/** Posts a cash receipt as an admission-level credit without assigning it to any bill. */
export async function recordPayment(db: Database, command: RecordPaymentCommand, recordedBy: string) {
  return runSerializable(db, async (transaction) => {
    const session = await lockSession(transaction, command.schoolId, command.sessionId);
    await lockFinanceAdmissionAccount(transaction, command.schoolId, command.admissionId);
    const commandSnapshot = paymentCommandSnapshot(command);
    const commandHash = sha256(commandSnapshot);
    const existing = await readPaymentByKey(transaction, command.schoolId, command.idempotencyKey);
    if (existing) {
      if (existing.payment.commandHash !== commandHash) throw rpcError.conflict("This payment idempotency key was already used with a different payload.");
      return paymentTransport(existing);
    }
    const [identity] = await transaction
      .select({
        admissionNumber: admissionTable.admissionNo,
        admissionName: admissionTable.name,
        fatherName: admissionTable.fatherName,
        motherName: admissionTable.motherName,
        enrollmentId: studentTable.id,
        classId: studentTable.classId,
        classLabel: classTable.label,
        sectionId: studentTable.sectionId,
        sectionLabel: sectionTable.label,
        rollNumber: studentTable.rollNo,
      })
      .from(admissionTable)
      .leftJoin(studentTable, and(eq(studentTable.schoolId, command.schoolId), eq(studentTable.admissionId, admissionTable.id), eq(studentTable.sessionId, command.sessionId)))
      .leftJoin(classTable, and(eq(classTable.schoolId, command.schoolId), eq(classTable.id, studentTable.classId)))
      .leftJoin(sectionTable, and(eq(sectionTable.schoolId, command.schoolId), eq(sectionTable.id, studentTable.sectionId)))
      .where(and(eq(admissionTable.schoolId, command.schoolId), eq(admissionTable.id, command.admissionId)))
      .limit(1);
    if (!identity) throw rpcError.notFound("Admission");
    const amountMinor = BigInt(command.amountMinor);
    const ledger = await appendFinanceLedgerEntry(transaction, {
      schoolId: command.schoolId, admissionId: command.admissionId, sessionId: command.sessionId,
      type: "payment", direction: "credit", amountMinor, currency: command.currency,
      effectiveAt: command.effectiveAt, recordedBy, note: command.note ?? null,
      idempotencyKey: `payment:${command.idempotencyKey}`,
    });
    const receipt = await allocateFinanceNumber(transaction, { schoolId: command.schoolId, sessionId: command.sessionId, kind: "receipt" });
    const [payment] = await transaction.insert(financePaymentTable).values({
      schoolId: command.schoolId, admissionId: command.admissionId, sessionId: command.sessionId,
      ledgerEntryId: ledger.id, receiptNumber: receipt.number, amountMinor, currency: command.currency,
      method: command.method, externalReference: command.externalReference ?? null, payerName: command.payerName ?? null,
      documentSnapshot: {
        ...identity,
        sessionStartYear: session.startYear,
        sessionEndYear: session.endYear,
      },
      receivedAt: command.receivedAt, note: command.note ?? null, idempotencyKey: command.idempotencyKey,
      commandHash, commandSnapshot: { command: commandSnapshot }, recordedBy,
    }).returning();
    if (!payment) throw new Error("Payment was not created");
    const created = await readPaymentByKey(transaction, command.schoolId, command.idempotencyKey);
    if (!created) throw new Error("Payment could not be read after posting");
    return paymentTransport(created);
  });
}

type RecordAdjustmentCommand = {
  schoolId: string;
  admissionId: string;
  sessionId: string;
  currency: string;
  kind: typeof financeAdjustmentTable.$inferInsert.kind;
  billId?: string;
  billLineId?: string;
  calculation: { kind: "fixed"; amountMinor: string } | { kind: "percentage"; percentage: string };
  reasonCode: string;
  reasonNote: string;
  approvedBy?: string | null;
  effectiveAt: Date;
  idempotencyKey: string;
};

function percentageAmount(eligible: bigint, percentage: string) {
  const [whole, fraction = ""] = percentage.split(".");
  const numerator = BigInt(`${whole}${fraction}`);
  const denominator = BigInt(100) * BigInt(10) ** BigInt(fraction.length);
  return (eligible * numerator + denominator / BigInt(2)) / denominator;
}

async function liveLineCredits(db: DatabaseExecutor, schoolId: string, lineId: string) {
  const rows = await db.select({ amount: financeAdjustmentTable.amountMinor, kind: financeAdjustmentTable.kind, ledgerId: financeAdjustmentTable.ledgerEntryId }).from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, schoolId), eq(financeAdjustmentTable.billLineId, lineId)));
  if (!rows.length) return ZERO;
  const reversals = await db.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, rows.map(({ ledgerId }) => ledgerId))));
  const reversed = new Set(reversals.map(({ target }) => target));
  return rows.reduce((total, row) => total + (reversed.has(row.ledgerId) ? ZERO : row.kind === "debit_correction" ? -row.amount : row.amount), ZERO);
}

async function readAdjustmentByKey(db: DatabaseExecutor, schoolId: string, key: string) {
  const [row] = await db.select().from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, schoolId), eq(financeAdjustmentTable.idempotencyKey, key))).limit(1);
  return row ?? null;
}

/** Converts percentage inputs once, then persists the exact fixed adjustment. */
export async function recordAdjustment(db: Database, command: RecordAdjustmentCommand, recordedBy: string) {
  return runSerializable(db, async (transaction) => {
    await lockSession(transaction, command.schoolId, command.sessionId);
    await lockFinanceAdmissionAccount(transaction, command.schoolId, command.admissionId);
    const existing = await readAdjustmentByKey(transaction, command.schoolId, command.idempotencyKey);
    if (existing) {
      const snapshot = existing.calculationSnapshot as { input?: unknown };
      const [ledger] = await transaction.select({ effectiveAt: financeLedgerEntryTable.effectiveAt }).from(financeLedgerEntryTable).where(eq(financeLedgerEntryTable.id, existing.ledgerEntryId)).limit(1);
      if (existing.admissionId !== command.admissionId || existing.sessionId !== command.sessionId || existing.kind !== command.kind || existing.billId !== (command.billId ?? null) || existing.billLineId !== (command.billLineId ?? null) || existing.currency !== command.currency || existing.reasonCode !== command.reasonCode || existing.reasonNote !== command.reasonNote || existing.approvedBy !== (command.approvedBy ?? null) || ledger?.effectiveAt.getTime() !== command.effectiveAt.getTime() || JSON.stringify(snapshot.input) !== JSON.stringify(command.calculation)) throw rpcError.conflict("This adjustment idempotency key was already used with a different payload.");
      return { ...existing, amountMinor: existing.amountMinor.toString() };
    }
    let bill: typeof financeBillTable.$inferSelect | undefined;
    let line: typeof financeBillLineTable.$inferSelect | undefined;
    let eligibleMinor: bigint | undefined;
    const isCredit = command.kind !== "debit_correction";
    if (command.billId) {
      [bill] = await transaction.select().from(financeBillTable).where(and(eq(financeBillTable.schoolId, command.schoolId), eq(financeBillTable.admissionId, command.admissionId), eq(financeBillTable.sessionId, command.sessionId), eq(financeBillTable.currency, command.currency), eq(financeBillTable.id, command.billId))).for("update").limit(1);
      if (!bill) throw rpcError.notFound("Adjustment bill");
      const settlement = (await billSettlementMap(transaction, command.schoolId, [bill])).get(bill.id)!;
      if (settlement.reversed) throw rpcError.conflict("A reversed bill cannot receive an adjustment.");
      eligibleMinor = bill.totalAmountMinor + settlement.debited - settlement.adjusted;
      if (eligibleMinor <= ZERO && (isCredit || command.calculation.kind === "percentage")) throw rpcError.conflict("The bill has no remaining adjustable amount.");
      if (command.billLineId) {
        [line] = await transaction.select().from(financeBillLineTable).where(and(eq(financeBillLineTable.schoolId, command.schoolId), eq(financeBillLineTable.billId, bill.id), eq(financeBillLineTable.id, command.billLineId), eq(financeBillLineTable.currency, command.currency))).limit(1);
        if (!line) throw rpcError.notFound("Bill line");
        const lineRemaining = line.amountMinor - await liveLineCredits(transaction, command.schoolId, line.id);
        eligibleMinor = eligibleMinor < lineRemaining ? eligibleMinor : lineRemaining;
        if (eligibleMinor <= ZERO && (isCredit || command.calculation.kind === "percentage")) throw rpcError.conflict("The bill line has no remaining adjustable amount.");
      }
    }
    const amountMinor = command.calculation.kind === "fixed" ? BigInt(command.calculation.amountMinor) : percentageAmount(eligibleMinor ?? ZERO, command.calculation.percentage);
    if (amountMinor <= ZERO) throw rpcError.badRequest("The adjustment rounds to zero minor units.");
    if (amountMinor > POSTGRES_BIGINT_MAX) throw rpcError.badRequest("The adjustment exceeds the supported exact amount range.");
    if (isCredit && eligibleMinor !== undefined && amountMinor > eligibleMinor) throw rpcError.badRequest("The credit adjustment cannot exceed the target's remaining adjustable amount.");
    const ledger = await appendFinanceLedgerEntry(transaction, {
      schoolId: command.schoolId, admissionId: command.admissionId, sessionId: command.sessionId,
      type: command.kind, direction: isCredit ? "credit" : "debit", amountMinor, currency: command.currency,
      effectiveAt: command.effectiveAt, recordedBy, note: command.reasonNote,
      idempotencyKey: `adjustment:${command.idempotencyKey}`,
    });
    const [adjustment] = await transaction.insert(financeAdjustmentTable).values({
      schoolId: command.schoolId, admissionId: command.admissionId, sessionId: command.sessionId,
      ledgerEntryId: ledger.id, billId: command.billId ?? null, billLineId: command.billLineId ?? null,
      kind: command.kind, amountMinor, currency: command.currency, reasonCode: command.reasonCode,
      reasonNote: command.reasonNote, approvedBy: command.approvedBy ?? null, idempotencyKey: command.idempotencyKey, recordedBy,
      calculationSnapshot: { input: command.calculation, eligibleAmountMinor: eligibleMinor?.toString() ?? null, fixedAmountMinor: amountMinor.toString(), rounding: command.calculation.kind === "percentage" ? "half_up" : null, targetBillNumber: bill?.billNumber ?? null, targetLineName: line?.feeElementName ?? null },
    }).returning();
    if (!adjustment) throw new Error("Adjustment was not created");
    return { ...adjustment, amountMinor: adjustment.amountMinor.toString() };
  });
}

type RecordRefundCommand = {
  schoolId: string; admissionId: string; sessionId: string; paymentId: string;
  amountMinor: string; method: typeof financeRefundTable.$inferInsert.method;
  externalReference?: string | null; reason: string; effectiveAt: Date; idempotencyKey: string;
};

async function readRefundByKey(db: DatabaseExecutor, schoolId: string, key: string) {
  const [row] = await db.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, schoolId), eq(financeRefundTable.idempotencyKey, key))).limit(1);
  if (!row) return null;
  const [ledger] = await db.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, schoolId), eq(financeLedgerEntryTable.id, row.ledgerEntryId))).limit(1);
  if (!ledger) throw new Error("Refund ledger entry was not found");
  return { refund: row, ledger };
}

/** Refunds only the still-unrefunded amount of one account-credit payment. */
export async function recordRefund(db: Database, command: RecordRefundCommand, recordedBy: string) {
  return runSerializable(db, async (transaction) => {
    await lockSession(transaction, command.schoolId, command.sessionId);
    await lockFinanceAdmissionAccount(transaction, command.schoolId, command.admissionId);
    const existing = await readRefundByKey(transaction, command.schoolId, command.idempotencyKey);
    if (existing) {
      const refund = existing.refund;
      if (refund.admissionId !== command.admissionId || refund.sessionId !== command.sessionId || refund.paymentId !== command.paymentId || refund.amountMinor !== BigInt(command.amountMinor) || refund.method !== command.method || refund.externalReference !== (command.externalReference ?? null) || refund.reason !== command.reason || existing.ledger.effectiveAt.getTime() !== command.effectiveAt.getTime()) throw rpcError.conflict("This refund idempotency key was already used with a different payload.");
      return { ...refund, amountMinor: refund.amountMinor.toString() };
    }
    const [payment] = await transaction.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, command.schoolId), eq(financePaymentTable.admissionId, command.admissionId), eq(financePaymentTable.sessionId, command.sessionId), eq(financePaymentTable.id, command.paymentId))).for("update").limit(1);
    if (!payment) throw rpcError.notFound("Payment");
    const paymentReversal = await transaction.select({ id: financeLedgerEntryTable.id }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), eq(financeLedgerEntryTable.reversalOfEntryId, payment.ledgerEntryId))).limit(1);
    if (paymentReversal[0]) throw rpcError.conflict("A reversed payment cannot be refunded.");
    const refunds = await transaction.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, command.schoolId), eq(financeRefundTable.paymentId, payment.id)));
    const refundReversals = refunds.length ? await transaction.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, refunds.map(({ ledgerEntryId }) => ledgerEntryId)))) : [];
    const reversedRefunds = new Set(refundReversals.map(({ target }) => target));
    const refunded = refunds.reduce((total, row) => total + (reversedRefunds.has(row.ledgerEntryId) ? ZERO : row.amountMinor), ZERO);
    const available = payment.amountMinor - refunded;
    const amountMinor = BigInt(command.amountMinor);
    if (amountMinor > available) throw rpcError.badRequest("A refund cannot exceed the original payment's remaining refundable amount.");
    const ledger = await appendFinanceLedgerEntry(transaction, {
      schoolId: command.schoolId, admissionId: command.admissionId, sessionId: command.sessionId,
      type: "refund", direction: "debit", amountMinor, currency: payment.currency,
      effectiveAt: command.effectiveAt, recordedBy, note: command.reason,
      idempotencyKey: `refund:${command.idempotencyKey}`,
    });
    const number = await allocateFinanceNumber(transaction, { schoolId: command.schoolId, sessionId: command.sessionId, kind: "refund" });
    const [refund] = await transaction.insert(financeRefundTable).values({
      schoolId: command.schoolId, admissionId: command.admissionId, sessionId: command.sessionId,
      paymentId: payment.id, ledgerEntryId: ledger.id, refundNumber: number.number,
      amountMinor, currency: payment.currency, method: command.method, externalReference: command.externalReference ?? null,
      reason: command.reason, idempotencyKey: command.idempotencyKey, recordedBy,
    }).returning();
    if (!refund) throw new Error("Refund was not created");
    return { ...refund, amountMinor: refund.amountMinor.toString() };
  });
}

type ReverseLedgerCommand = { schoolId: string; admissionId: string; sessionId: string; ledgerEntryId: string; reason: string; effectiveAt: Date; idempotencyKey: string };

/** Appends one opposite posting after operation-specific settlement guards. */
export async function reverseLedgerEntry(db: Database, command: ReverseLedgerCommand, recordedBy: string) {
  return runSerializable(db, async (transaction) => {
    await lockSession(transaction, command.schoolId, command.sessionId);
    await lockFinanceAdmissionAccount(transaction, command.schoolId, command.admissionId);
    const storedKey = `ledger-reversal:${command.idempotencyKey}`;
    const [existing] = await transaction.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), eq(financeLedgerEntryTable.type, "reversal"), eq(financeLedgerEntryTable.idempotencyKey, storedKey))).limit(1);
    if (existing) {
      if (existing.reversalOfEntryId !== command.ledgerEntryId || existing.admissionId !== command.admissionId || existing.sessionId !== command.sessionId || existing.note !== command.reason || existing.effectiveAt.getTime() !== command.effectiveAt.getTime()) throw rpcError.conflict("This reversal idempotency key was already used with a different payload.");
      return { ...existing, type: "reversal" as const, reversalOfEntryId: command.ledgerEntryId, sequence: existing.sequence.toString(), amountMinor: existing.amountMinor.toString() };
    }
    const [target] = await transaction.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), eq(financeLedgerEntryTable.admissionId, command.admissionId), eq(financeLedgerEntryTable.sessionId, command.sessionId), eq(financeLedgerEntryTable.id, command.ledgerEntryId))).for("update").limit(1);
    if (!target) throw rpcError.notFound("Ledger entry");
    if (target.type === "reversal" || target.reversalOfEntryId) throw rpcError.badRequest("A reversal cannot itself be reversed in v1.");
    const prior = await transaction.select({ id: financeLedgerEntryTable.id }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), eq(financeLedgerEntryTable.reversalOfEntryId, target.id))).limit(1);
    if (prior[0]) throw rpcError.conflict("This ledger entry has already been reversed.");
    const [bill] = await transaction.select().from(financeBillTable).where(and(eq(financeBillTable.schoolId, command.schoolId), eq(financeBillTable.ledgerEntryId, target.id))).limit(1);
    if (bill) {
      // Bill reversals have their own permission and coordinated posting path. Allowing
      // them here would let REVERSE_LEDGER_ENTRY bypass the REVERSE_BILL boundary.
      throw rpcError.badRequest("Bill postings must be reversed with the dedicated bill reversal operation.");
    }
    const [payment] = await transaction.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, command.schoolId), eq(financePaymentTable.ledgerEntryId, target.id))).limit(1);
    if (payment) {
      const refunds = await transaction.select({ ledgerEntryId: financeRefundTable.ledgerEntryId }).from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, command.schoolId), eq(financeRefundTable.paymentId, payment.id)));
      const refundReversals = refunds.length ? await transaction.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, refunds.map(({ ledgerEntryId }) => ledgerEntryId)))) : [];
      const reversedRefunds = new Set(refundReversals.map(({ target }) => target));
      const hasLiveRefund = refunds.some(({ ledgerEntryId }) => !reversedRefunds.has(ledgerEntryId));
      if (hasLiveRefund) throw rpcError.conflict("A payment with a live refund requires a coordinated correction and cannot be reversed alone.");
    }
    const [adjustment] = await transaction.select().from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, command.schoolId), eq(financeAdjustmentTable.ledgerEntryId, target.id))).limit(1);
    if (adjustment?.kind === "debit_correction" && adjustment.billId) {
      const [adjustmentBill] = await transaction.select().from(financeBillTable).where(and(eq(financeBillTable.schoolId, command.schoolId), eq(financeBillTable.id, adjustment.billId))).for("update").limit(1);
      if (!adjustmentBill) throw rpcError.notFound("Adjustment bill");
      const state = (await billSettlementMap(transaction, command.schoolId, [adjustmentBill])).get(adjustmentBill.id)!;
      if (state.adjusted > adjustmentBill.totalAmountMinor + state.debited - adjustment.amountMinor) {
        throw rpcError.conflict("This debit correction supports live bill settlements and cannot be reversed alone.");
      }
    }
    const reversal = await appendFinanceLedgerEntry(transaction, {
      schoolId: command.schoolId, admissionId: command.admissionId, sessionId: command.sessionId,
      type: "reversal", direction: target.direction === "debit" ? "credit" : "debit",
      amountMinor: target.amountMinor, currency: target.currency, effectiveAt: command.effectiveAt,
      recordedBy, note: command.reason, reversalOfEntryId: target.id, idempotencyKey: storedKey,
    });
    return { ...reversal, type: "reversal" as const, reversalOfEntryId: target.id, sequence: reversal.sequence.toString(), amountMinor: reversal.amountMinor.toString() };
  });
}
