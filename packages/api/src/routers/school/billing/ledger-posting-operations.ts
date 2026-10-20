import type { Database, DatabaseExecutor, DatabaseTransaction } from "@campuspilot/db";
import { createHash } from "node:crypto";
import {
  financeAdjustmentTable,
  financeBillLineTable,
  financeBillTable,
  financeLedgerEntryTable,
  financePaymentAllocationTable,
  financePaymentTable,
  financeRefundTable,
} from "@campuspilot/db/schema/finance";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { and, asc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { isRetryableTransactionError, rpcError } from "../../../errors";
import { lockFinanceAdmissionAccount } from "./account-lock";
import { assertAdmissionContext, billSettlementMap } from "./ledger-read";
import { appendFinanceLedgerEntry } from "./ledger-posting";
import { allocateFinanceNumber } from "./numbering";
import { POSTGRES_BIGINT_MAX } from "./transport";

const ZERO = BigInt(0);
const MAX_PAYMENT_ALLOCATIONS = 500;
const ALLOCATION_INSERT_CHUNK_SIZE = 100;
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

type AllocationInput = { billId: string; amountMinor: string };
type PaymentAllocationCommand = {
  schoolId: string;
  admissionId: string;
  sessionId: string;
  amountMinor: string;
  currency: string;
  allocationMode: "proposal" | "explicit" | "unallocated";
  allocations?: AllocationInput[];
};

type AllocationCandidate = {
  bill: typeof financeBillTable.$inferSelect;
  outstandingMinor: bigint;
  settlement: Awaited<ReturnType<typeof billSettlementMap>> extends Map<string, infer V> ? V : never;
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
    allocationMode: command.allocationMode,
    allocations: command.allocationMode === "explicit"
      ? [...(command.allocations ?? [])].sort((left, right) => left.billId.localeCompare(right.billId))
      : null,
    expectedAllocationReviewHash: command.expectedAllocationReviewHash ?? null,
    confirmUnallocatedCredit: command.confirmUnallocatedCredit,
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
    .select({ id: schoolSessionTable.id })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, schoolId), eq(schoolSessionTable.id, sessionId)))
    .for("update")
    .limit(1);
  if (!session) throw rpcError.notFound("School session");
}

async function outstandingBills(
  db: DatabaseExecutor,
  input: { schoolId: string; admissionId: string; currency: string },
) {
  const bills = await db
    .select()
    .from(financeBillTable)
    .where(
      and(
        eq(financeBillTable.schoolId, input.schoolId),
        eq(financeBillTable.admissionId, input.admissionId),
        eq(financeBillTable.currency, input.currency),
        eq(financeBillTable.status, "posted"),
        sql`not exists (
          select 1 from ${financeLedgerEntryTable} reversal
          where reversal.school_id = ${financeBillTable.schoolId}
            and reversal.reversal_of_entry_id = ${financeBillTable.ledgerEntryId}
        )`,
        sql`${financeBillTable.totalAmountMinor}
          + coalesce((select sum(adjustment.amount_minor) from ${financeAdjustmentTable} adjustment
            where adjustment.school_id = ${financeBillTable.schoolId}
              and adjustment.bill_id = ${financeBillTable.id}
              and adjustment.kind = 'debit_correction'
              and not exists (select 1 from ${financeLedgerEntryTable} adjustment_reversal
                where adjustment_reversal.school_id = adjustment.school_id
                  and adjustment_reversal.reversal_of_entry_id = adjustment.ledger_entry_id)), 0)
          > coalesce((select sum(allocation.amount_minor) from ${financePaymentAllocationTable} allocation
            where allocation.school_id = ${financeBillTable.schoolId}
              and allocation.bill_id = ${financeBillTable.id}), 0)
          + coalesce((select sum(adjustment.amount_minor) from ${financeAdjustmentTable} adjustment
            where adjustment.school_id = ${financeBillTable.schoolId}
              and adjustment.bill_id = ${financeBillTable.id}
              and adjustment.kind in ('discount', 'waiver', 'write_off', 'credit_correction')
              and not exists (select 1 from ${financeLedgerEntryTable} adjustment_reversal
                where adjustment_reversal.school_id = adjustment.school_id
                  and adjustment_reversal.reversal_of_entry_id = adjustment.ledger_entry_id)), 0)`,
      ),
    )
    .orderBy(asc(financeBillTable.issueDate), asc(financeBillTable.billNumber), asc(financeBillTable.id))
    .limit(MAX_PAYMENT_ALLOCATIONS + 1);
  const settlements = await billSettlementMap(db, input.schoolId, bills);
  return bills.flatMap((bill) => {
    const state = settlements.get(bill.id)!;
    if (state.reversed) return [];
    const charge = bill.totalAmountMinor + state.debited;
    const settled = state.allocated + state.adjusted;
    if (settled >= charge) return [];
    return [{ bill, outstandingMinor: charge - settled, settlement: state }];
  });
}

async function explicitAllocationBills(
  db: DatabaseExecutor,
  command: PaymentAllocationCommand,
): Promise<AllocationCandidate[]> {
  const ids = command.allocations?.map(({ billId }) => billId) ?? [];
  if (!ids.length) return [];
  const bills = await db.select().from(financeBillTable).where(and(
    eq(financeBillTable.schoolId, command.schoolId),
    eq(financeBillTable.admissionId, command.admissionId),
    eq(financeBillTable.currency, command.currency),
    eq(financeBillTable.status, "posted"),
    inArray(financeBillTable.id, ids),
  ));
  const settlements = await billSettlementMap(db, command.schoolId, bills);
  return bills.flatMap((bill) => {
    const settlement = settlements.get(bill.id)!;
    const outstandingMinor = bill.totalAmountMinor + settlement.debited - settlement.allocated - settlement.adjusted;
    return settlement.reversed || outstandingMinor <= ZERO ? [] : [{ bill, settlement, outstandingMinor }];
  });
}

async function resolveAllocations(
  db: DatabaseExecutor,
  command: PaymentAllocationCommand,
) {
  const amount = BigInt(command.amountMinor);
  const candidates = command.allocationMode === "explicit"
    ? await explicitAllocationBills(db, command)
    : await outstandingBills(db, command);
  const candidateLimitExceeded = command.allocationMode === "proposal" && candidates.length > MAX_PAYMENT_ALLOCATIONS;
  const boundedCandidates = candidates.slice(0, MAX_PAYMENT_ALLOCATIONS);
  const candidateById = new Map(boundedCandidates.map((candidate) => [candidate.bill.id, candidate]));
  let allocations: Array<{ billId: string; amountMinor: bigint }> = [];
  if (command.allocationMode === "proposal" && !candidateLimitExceeded) {
    let remaining = amount;
    for (const candidate of boundedCandidates) {
      if (remaining === ZERO) break;
      const allocated = remaining < candidate.outstandingMinor ? remaining : candidate.outstandingMinor;
      allocations.push({ billId: candidate.bill.id, amountMinor: allocated });
      remaining -= allocated;
    }
  } else if (command.allocationMode === "explicit") {
    const seen = new Set<string>();
    allocations = (command.allocations ?? []).map((allocation) => {
      if (seen.has(allocation.billId)) throw rpcError.badRequest("Each bill may appear only once in a payment allocation.");
      seen.add(allocation.billId);
      const candidate = candidateById.get(allocation.billId);
      if (!candidate) throw rpcError.notFound("Outstanding allocation bill");
      const value = BigInt(allocation.amountMinor);
      if (value > candidate.outstandingMinor) throw rpcError.badRequest("A payment allocation cannot exceed the bill's outstanding amount.");
      return { billId: allocation.billId, amountMinor: value };
    });
  }
  const allocatedMinor = allocations.reduce((total, allocation) => total + allocation.amountMinor, ZERO);
  if (allocatedMinor > amount) throw rpcError.badRequest("Payment allocations cannot exceed the payment amount.");
  return {
    allocations: allocations.map((allocation) => {
      const candidate = candidateById.get(allocation.billId)!;
      return {
        ...allocation,
        billNumber: candidate.bill.billNumber,
        sessionId: candidate.bill.sessionId,
        sessionLabel: `${candidate.bill.sessionStartYearSnapshot}–${candidate.bill.sessionEndYearSnapshot}`,
        outstandingMinor: candidate.outstandingMinor.toString(),
      };
    }),
    allocatedMinor,
    unallocatedCreditMinor: amount - allocatedMinor,
    totalOutstandingMinor: boundedCandidates.reduce((total, candidate) => total + candidate.outstandingMinor, ZERO),
    candidateLimitExceeded,
    reviewState: boundedCandidates.map(({ bill, settlement, outstandingMinor }) => ({
      billId: bill.id,
      issueDate: bill.issueDate,
      billNumber: bill.billNumber,
      totalAmountMinor: bill.totalAmountMinor.toString(),
      allocatedMinor: settlement.allocated.toString(),
      creditedAdjustmentMinor: settlement.adjusted.toString(),
      debitedAdjustmentMinor: settlement.debited.toString(),
      outstandingMinor: outstandingMinor.toString(),
    })),
  };
}

function allocationReviewHash(
  command: PaymentAllocationCommand,
  result: Awaited<ReturnType<typeof resolveAllocations>>,
) {
  if (command.allocationMode !== "proposal" || result.candidateLimitExceeded) return null;
  return sha256({
    input: {
      schoolId: command.schoolId,
      admissionId: command.admissionId,
      sessionId: command.sessionId,
      amountMinor: command.amountMinor,
      currency: command.currency,
      allocationMode: command.allocationMode,
    },
    proposedAllocations: result.allocations.map(({ billId, amountMinor }) => ({ billId, amountMinor: amountMinor.toString() })),
    settlementState: result.reviewState,
  });
}

export async function previewPaymentAllocation(db: DatabaseExecutor, command: PaymentAllocationCommand) {
  await assertAdmissionContext(db, command);
  const result = await resolveAllocations(db, command);
  return {
    amountMinor: command.amountMinor,
    currency: command.currency,
    allocationMode: command.allocationMode,
    readyToRecord: !result.candidateLimitExceeded,
    blockingIssues: result.candidateLimitExceeded
      ? [{ code: "candidate_limit_exceeded" as const, message: `Automatic allocation is limited to ${MAX_PAYMENT_ALLOCATIONS} outstanding bills; use explicit allocations in batches.` }]
      : [],
    allocationReviewHash: allocationReviewHash(command, result),
    allocations: result.allocations.map((allocation) => ({
      billId: allocation.billId,
      billNumber: allocation.billNumber,
      sessionId: allocation.sessionId,
      sessionLabel: allocation.sessionLabel,
      outstandingMinor: allocation.outstandingMinor,
      amountMinor: allocation.amountMinor.toString(),
    })),
    allocatedMinor: result.allocatedMinor.toString(),
    unallocatedCreditMinor: result.unallocatedCreditMinor.toString(),
    totalOutstandingMinor: result.totalOutstandingMinor.toString(),
    requiresUnallocatedCreditConfirmation: result.unallocatedCreditMinor > ZERO,
  };
}

type RecordPaymentCommand = PaymentAllocationCommand & {
  method: typeof financePaymentTable.$inferInsert.method;
  externalReference?: string | null;
  payerName?: string | null;
  receivedAt: Date;
  effectiveAt: Date;
  note?: string | null;
  confirmUnallocatedCredit: boolean;
  expectedAllocationReviewHash?: string;
  idempotencyKey: string;
};

async function readPaymentByKey(db: DatabaseExecutor, schoolId: string, key: string) {
  const [payment] = await db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), eq(financePaymentTable.idempotencyKey, key))).limit(1);
  if (!payment) return null;
  const [allocations, ledgerRows] = await Promise.all([
    db.select().from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, schoolId), eq(financePaymentAllocationTable.paymentId, payment.id))).orderBy(asc(financePaymentAllocationTable.billId)),
    db.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, schoolId), eq(financeLedgerEntryTable.id, payment.ledgerEntryId))).limit(1),
  ]);
  const ledger = ledgerRows[0];
  if (!ledger) throw new Error("Payment ledger entry was not found");
  return { payment, allocations, ledger };
}

function paymentTransport(value: NonNullable<Awaited<ReturnType<typeof readPaymentByKey>>>) {
  const allocated = value.allocations.reduce((total, allocation) => total + allocation.amountMinor, ZERO);
  return { ...value.payment, amountMinor: value.payment.amountMinor.toString(), allocatedMinor: allocated.toString(), unallocatedCreditMinor: (value.payment.amountMinor - allocated).toString(), allocations: value.allocations.map((allocation) => ({ ...allocation, amountMinor: allocation.amountMinor.toString() })) };
}

/** Posts cash receipt and its allocations as one serializable accounting command. */
export async function recordPayment(db: Database, command: RecordPaymentCommand, recordedBy: string) {
  return runSerializable(db, async (transaction) => {
    await lockSession(transaction, command.schoolId, command.sessionId);
    await lockFinanceAdmissionAccount(transaction, command.schoolId, command.admissionId);
    const commandSnapshot = paymentCommandSnapshot(command);
    const commandHash = sha256(commandSnapshot);
    const existing = await readPaymentByKey(transaction, command.schoolId, command.idempotencyKey);
    if (existing) {
      if (existing.payment.commandHash !== commandHash) throw rpcError.conflict("This payment idempotency key was already used with a different payload.");
      return paymentTransport(existing);
    }
    const resolved = await resolveAllocations(transaction, command);
    if (resolved.candidateLimitExceeded) {
      throw rpcError.conflict(`Automatic allocation is limited to ${MAX_PAYMENT_ALLOCATIONS} outstanding bills; use explicit allocations in batches.`);
    }
    if (command.allocationMode === "proposal" && allocationReviewHash(command, resolved) !== command.expectedAllocationReviewHash) {
      throw rpcError.conflict("The proposed allocation changed after review. Preview the allocation again before recording the payment.");
    }
    if (resolved.unallocatedCreditMinor > ZERO && !command.confirmUnallocatedCredit) {
      throw rpcError.badRequest("Confirm the unallocated admission credit before recording this payment.");
    }
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
      receivedAt: command.receivedAt, note: command.note ?? null, idempotencyKey: command.idempotencyKey,
      commandHash, commandSnapshot: { command: commandSnapshot, allocationReviewHash: command.expectedAllocationReviewHash ?? null }, recordedBy,
    }).returning();
    if (!payment) throw new Error("Payment was not created");
    for (let offset = 0; offset < resolved.allocations.length; offset += ALLOCATION_INSERT_CHUNK_SIZE) {
      const chunk = resolved.allocations.slice(offset, offset + ALLOCATION_INSERT_CHUNK_SIZE);
      await transaction.insert(financePaymentAllocationTable).values(chunk.map((allocation) => ({
        schoolId: command.schoolId, admissionId: command.admissionId, paymentId: payment.id,
        billId: allocation.billId, amountMinor: allocation.amountMinor, currency: command.currency,
      })));
    }
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
      eligibleMinor = bill.totalAmountMinor + settlement.debited - settlement.allocated - settlement.adjusted;
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

/** Refunds only the still-unallocated effective credit of one payment. */
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
    const [allocations, refunds] = await Promise.all([
      transaction.select().from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, command.schoolId), eq(financePaymentAllocationTable.paymentId, payment.id))),
      transaction.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, command.schoolId), eq(financeRefundTable.paymentId, payment.id))),
    ]);
    const refundReversals = refunds.length ? await transaction.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, refunds.map(({ ledgerEntryId }) => ledgerEntryId)))) : [];
    const reversedRefunds = new Set(refundReversals.map(({ target }) => target));
    const allocated = allocations.reduce((total, row) => total + row.amountMinor, ZERO);
    const refunded = refunds.reduce((total, row) => total + (reversedRefunds.has(row.ledgerEntryId) ? ZERO : row.amountMinor), ZERO);
    const available = payment.amountMinor - allocated - refunded;
    const amountMinor = BigInt(command.amountMinor);
    if (amountMinor > available) throw rpcError.badRequest("A refund cannot exceed the original payment's unreversed, unallocated credit.");
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
      const [allocation, refunds] = await Promise.all([
        transaction.select({ id: financePaymentAllocationTable.id }).from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, command.schoolId), eq(financePaymentAllocationTable.paymentId, payment.id))).limit(1),
        transaction.select({ ledgerEntryId: financeRefundTable.ledgerEntryId }).from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, command.schoolId), eq(financeRefundTable.paymentId, payment.id))),
      ]);
      const refundReversals = refunds.length ? await transaction.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, command.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, refunds.map(({ ledgerEntryId }) => ledgerEntryId)))) : [];
      const reversedRefunds = new Set(refundReversals.map(({ target }) => target));
      const hasLiveRefund = refunds.some(({ ledgerEntryId }) => !reversedRefunds.has(ledgerEntryId));
      if (allocation[0] || hasLiveRefund) throw rpcError.conflict("An allocated or effectively refunded payment requires a coordinated correction and cannot be reversed alone.");
    }
    const [adjustment] = await transaction.select().from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, command.schoolId), eq(financeAdjustmentTable.ledgerEntryId, target.id))).limit(1);
    if (adjustment?.kind === "debit_correction" && adjustment.billId) {
      const [adjustmentBill] = await transaction.select().from(financeBillTable).where(and(eq(financeBillTable.schoolId, command.schoolId), eq(financeBillTable.id, adjustment.billId))).for("update").limit(1);
      if (!adjustmentBill) throw rpcError.notFound("Adjustment bill");
      const state = (await billSettlementMap(transaction, command.schoolId, [adjustmentBill])).get(adjustmentBill.id)!;
      if (state.allocated + state.adjusted > adjustmentBill.totalAmountMinor + state.debited - adjustment.amountMinor) {
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
