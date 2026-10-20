import type { DatabaseTransaction } from "@campuspilot/db";
import { generateId } from "@campuspilot/db/id";
import {
  financeAdmissionBalanceTable,
  financeAdmissionSessionActivityTable,
  financeLedgerEntryTable,
} from "@campuspilot/db/schema/finance";
import type { FinanceDocumentIdentitySnapshot } from "@campuspilot/db/schema/finance";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { studentTable } from "@campuspilot/db/schema/student";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
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
  documentSnapshot?: FinanceDocumentIdentitySnapshot | null;
  reversalOfEntryId?: string | null;
  idempotencyKey: string;
};

async function captureDocumentSnapshots(
  transaction: DatabaseTransaction,
  inputs: LedgerAppendInput[],
) {
  const schoolId = inputs[0]!.schoolId;
  const admissionIds = [...new Set(inputs.map((input) => input.admissionId))];
  const sessionIds = [...new Set(inputs.map((input) => input.sessionId))];
  const [admissions, sessions, enrollments] = await Promise.all([
    transaction.select({ id: admissionTable.id, admissionNumber: admissionTable.admissionNo, admissionName: admissionTable.name, fatherName: admissionTable.fatherName, motherName: admissionTable.motherName }).from(admissionTable).where(and(eq(admissionTable.schoolId, schoolId), inArray(admissionTable.id, admissionIds))),
    transaction.select({ id: schoolSessionTable.id, sessionStartYear: schoolSessionTable.sessionStartYear, sessionEndYear: schoolSessionTable.sessionEndYear }).from(schoolSessionTable).where(and(eq(schoolSessionTable.schoolId, schoolId), inArray(schoolSessionTable.id, sessionIds))),
    transaction.select({ admissionId: studentTable.admissionId, sessionId: studentTable.sessionId, enrollmentId: studentTable.id, classId: studentTable.classId, classLabel: classTable.label, sectionId: studentTable.sectionId, sectionLabel: sectionTable.label, rollNumber: studentTable.rollNo }).from(studentTable).leftJoin(classTable, and(eq(classTable.schoolId, schoolId), eq(classTable.id, studentTable.classId))).leftJoin(sectionTable, and(eq(sectionTable.schoolId, schoolId), eq(sectionTable.id, studentTable.sectionId))).where(and(eq(studentTable.schoolId, schoolId), inArray(studentTable.admissionId, admissionIds), inArray(studentTable.sessionId, sessionIds))),
  ]);
  const admissionById = new Map(admissions.map((row) => [row.id, row]));
  const sessionById = new Map(sessions.map((row) => [row.id, row]));
  const enrollmentByScope = new Map(enrollments.map((row) => [`${row.admissionId}:${row.sessionId}`, row]));
  return inputs.map((input) => {
    if (input.documentSnapshot) return input.documentSnapshot;
    const admission = admissionById.get(input.admissionId);
    const session = sessionById.get(input.sessionId);
    if (!admission || !session) throw new Error("Finance ledger identity scope was not found");
    const enrollment = enrollmentByScope.get(`${input.admissionId}:${input.sessionId}`);
    return {
      admissionNumber: admission.admissionNumber,
      admissionName: admission.admissionName,
      fatherName: admission.fatherName,
      motherName: admission.motherName,
      sessionStartYear: session.sessionStartYear,
      sessionEndYear: session.sessionEndYear,
      enrollmentId: enrollment?.enrollmentId ?? null,
      classId: enrollment?.classId ?? null,
      classLabel: enrollment?.classLabel ?? null,
      sectionId: enrollment?.sectionId ?? null,
      sectionLabel: enrollment?.sectionLabel ?? null,
      rollNumber: enrollment?.rollNumber ?? null,
    } satisfies FinanceDocumentIdentitySnapshot;
  });
}

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
  const documentSnapshots = await captureDocumentSnapshots(transaction, inputs);
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
  const rows = inputs.map((input, index) => ({
    id: generateId("financeLedgerEntry"),
    ...input,
    documentSnapshot: documentSnapshots[index]!,
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
  const [documentSnapshot] = await captureDocumentSnapshots(transaction, [input]);
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
    .values({ ...input, documentSnapshot, sequence })
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
