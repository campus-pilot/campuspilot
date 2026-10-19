import type { DatabaseTransaction } from "@campuspilot/db";
import { generateId } from "@campuspilot/db/id";
import {
  financeAdmissionBalanceTable,
  financeAdmissionSessionActivityTable,
  financeLedgerEntryTable,
} from "@campuspilot/db/schema/finance";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";

type LedgerEntryType = typeof financeLedgerEntryTable.$inferInsert.type;
type LedgerDirection = typeof financeLedgerEntryTable.$inferInsert.direction;
type LedgerAppendInput = {
  schoolId: string;
  admissionId: string;
  sessionId: string;
  type: LedgerEntryType;
  direction: LedgerDirection;
  amountMinor: bigint;
  currency: string;
  effectiveAt: Date;
  recordedBy: string;
  note?: string | null;
  reversalOfEntryId?: string | null;
  idempotencyKey: string;
};

const WRITE_CHUNK_SIZE = 500;

function chunks<T>(values: T[], size = WRITE_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/**
 * Appends one entry per already-locked admission and updates projections in
 * bounded chunks. Billing runs use this path so database round trips scale by
 * chunk count rather than admission count.
 */
export async function appendFinanceLedgerEntries(
  transaction: DatabaseTransaction,
  inputs: LedgerAppendInput[],
) {
  if (!inputs.length) return [];
  const admissionIds = inputs.map(({ admissionId }) => admissionId);
  if (new Set(admissionIds).size !== admissionIds.length) {
    throw new Error("Bulk finance ledger append requires one entry per admission");
  }
  const schoolId = inputs[0]!.schoolId;
  const currency = inputs[0]!.currency;
  if (
    inputs.some(
      (input) => input.schoolId !== schoolId || input.currency !== currency,
    )
  ) {
    throw new Error("Bulk finance ledger append requires one school and currency");
  }
  const latest = await transaction
    .select({
      admissionId: financeLedgerEntryTable.admissionId,
      sequence: max(financeLedgerEntryTable.sequence),
    })
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, schoolId),
        eq(financeLedgerEntryTable.currency, currency),
        inArray(financeLedgerEntryTable.admissionId, admissionIds),
      ),
    )
    .groupBy(financeLedgerEntryTable.admissionId);
  const sequenceByAdmission = new Map(
    latest.map(({ admissionId, sequence }) => [
      admissionId,
      (sequence ?? BigInt(0)) + BigInt(1),
    ]),
  );
  const rows = inputs.map((input) => ({
    id: generateId("financeLedgerEntry"),
    ...input,
    sequence: sequenceByAdmission.get(input.admissionId) ?? BigInt(1),
  }));
  const inserted: Array<typeof financeLedgerEntryTable.$inferSelect> = [];
  for (const group of chunks(rows)) {
    inserted.push(
      ...(await transaction
        .insert(financeLedgerEntryTable)
        .values(group)
        .returning()),
    );
  }
  const balanceRows = rows.map((row) => ({
    schoolId: row.schoolId,
    admissionId: row.admissionId,
    currency: row.currency,
    lastSequence: row.sequence,
    debitTotalMinor:
      row.direction === "debit" ? row.amountMinor : BigInt(0),
    creditTotalMinor:
      row.direction === "credit" ? row.amountMinor : BigInt(0),
  }));
  for (const group of chunks(balanceRows)) {
    await transaction
      .insert(financeAdmissionBalanceTable)
      .values(group)
      .onConflictDoUpdate({
        target: [
          financeAdmissionBalanceTable.schoolId,
          financeAdmissionBalanceTable.admissionId,
          financeAdmissionBalanceTable.currency,
        ],
        set: {
          lastSequence: sql.raw("excluded.last_sequence"),
          debitTotalMinor: sql`${financeAdmissionBalanceTable.debitTotalMinor} + excluded.debit_total_minor`,
          creditTotalMinor: sql`${financeAdmissionBalanceTable.creditTotalMinor} + excluded.credit_total_minor`,
          rebuiltAt: new Date(),
        },
      });
  }
  const activityRows = rows.map((row) => ({
    schoolId: row.schoolId,
    admissionId: row.admissionId,
    sessionId: row.sessionId,
    currency: row.currency,
    lastSequence: row.sequence,
    entryCount: BigInt(1),
    debitTotalMinor:
      row.direction === "debit" ? row.amountMinor : BigInt(0),
    creditTotalMinor:
      row.direction === "credit" ? row.amountMinor : BigInt(0),
  }));
  for (const group of chunks(activityRows)) {
    await transaction
      .insert(financeAdmissionSessionActivityTable)
      .values(group)
      .onConflictDoUpdate({
        target: [
          financeAdmissionSessionActivityTable.schoolId,
          financeAdmissionSessionActivityTable.admissionId,
          financeAdmissionSessionActivityTable.sessionId,
          financeAdmissionSessionActivityTable.currency,
        ],
        set: {
          lastSequence: sql.raw("excluded.last_sequence"),
          entryCount: sql`${financeAdmissionSessionActivityTable.entryCount} + 1`,
          debitTotalMinor: sql`${financeAdmissionSessionActivityTable.debitTotalMinor} + excluded.debit_total_minor`,
          creditTotalMinor: sql`${financeAdmissionSessionActivityTable.creditTotalMinor} + excluded.credit_total_minor`,
          rebuiltAt: new Date(),
        },
      });
  }
  const insertedById = new Map(inserted.map((row) => [row.id, row]));
  return rows.map((row) => {
    const entry = insertedById.get(row.id);
    if (!entry) throw new Error("Finance ledger entry was not created");
    return entry;
  });
}

/**
 * Appends one ledger fact and advances both rebuildable projections. Callers
 * must already hold the canonical admission-account lock.
 */
export async function appendFinanceLedgerEntry(
  transaction: DatabaseTransaction,
  input: LedgerAppendInput,
) {
  const [latest] = await transaction
    .select({ sequence: financeLedgerEntryTable.sequence })
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, input.schoolId),
        eq(financeLedgerEntryTable.admissionId, input.admissionId),
        eq(financeLedgerEntryTable.currency, input.currency),
      ),
    )
    .orderBy(desc(financeLedgerEntryTable.sequence))
    .limit(1);
  const sequence = (latest?.sequence ?? BigInt(0)) + BigInt(1);
  const [entry] = await transaction
    .insert(financeLedgerEntryTable)
    .values({ ...input, sequence })
    .returning();
  if (!entry) throw new Error("Finance ledger entry was not created");

  const debit = input.direction === "debit" ? input.amountMinor : BigInt(0);
  const credit = input.direction === "credit" ? input.amountMinor : BigInt(0);
  await transaction
    .insert(financeAdmissionBalanceTable)
    .values({
      schoolId: input.schoolId,
      admissionId: input.admissionId,
      currency: input.currency,
      lastSequence: sequence,
      debitTotalMinor: debit,
      creditTotalMinor: credit,
    })
    .onConflictDoUpdate({
      target: [
        financeAdmissionBalanceTable.schoolId,
        financeAdmissionBalanceTable.admissionId,
        financeAdmissionBalanceTable.currency,
      ],
      set: {
        lastSequence: sequence,
        debitTotalMinor: sql`${financeAdmissionBalanceTable.debitTotalMinor} + ${debit}`,
        creditTotalMinor: sql`${financeAdmissionBalanceTable.creditTotalMinor} + ${credit}`,
        rebuiltAt: new Date(),
      },
    });
  await transaction
    .insert(financeAdmissionSessionActivityTable)
    .values({
      schoolId: input.schoolId,
      admissionId: input.admissionId,
      sessionId: input.sessionId,
      currency: input.currency,
      lastSequence: sequence,
      entryCount: BigInt(1),
      debitTotalMinor: debit,
      creditTotalMinor: credit,
    })
    .onConflictDoUpdate({
      target: [
        financeAdmissionSessionActivityTable.schoolId,
        financeAdmissionSessionActivityTable.admissionId,
        financeAdmissionSessionActivityTable.sessionId,
        financeAdmissionSessionActivityTable.currency,
      ],
      set: {
        lastSequence: sequence,
        entryCount: sql`${financeAdmissionSessionActivityTable.entryCount} + 1`,
        debitTotalMinor: sql`${financeAdmissionSessionActivityTable.debitTotalMinor} + ${debit}`,
        creditTotalMinor: sql`${financeAdmissionSessionActivityTable.creditTotalMinor} + ${credit}`,
        rebuiltAt: new Date(),
      },
    });
  return entry;
}
