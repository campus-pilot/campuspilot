import type { DatabaseExecutor } from '@campuspilot/db';

import { notifyMany, type AnyNotifyInput, type NotifyInput } from '../notify';

/**
 * Finance emitters (Phase 5, D-7, D-11, D-30). Each posting command calls
 * one of these inside its own transaction, after the fact is written, so a
 * notification exists if and only if the bill or payment does. Keys are the
 * posted fact's ID: a replayed command returns the existing fact before
 * reaching these calls, and even if it did, the key would return the
 * existing event (no double notification). Reversals emit nothing (D-11): a
 * corrected bill or payment is a new fact with a new ID and is notified as
 * such. The caller hands the returned event IDs over after commit.
 */

/** A posted bill as the emitters need it (amounts as posted, bigint minor units). */
export type PostedBillFacts = {
  id: string;
  schoolId: string;
  sessionId: string;
  admissionId: string;
  billNumber: string;
  totalAmountMinor: bigint;
  currency: string;
  issueDate: string;
  /** The admission's name as snapshotted on the bill. */
  admissionNameSnapshot: string;
  /** Present for billing-run bills only. */
  billRunId?: string | null;
  periodKey?: string | null;
};

function billIssued(bill: PostedBillFacts, createdBy: string): NotifyInput<'bill.issued'> {
  return {
    type: 'bill.issued',
    schoolId: bill.schoolId,
    key: `bill:${bill.id}`,
    createdBy,
    recipients: { kind: 'admissions', admissionIds: [bill.admissionId] },
    data: {
      billId: bill.id,
      sessionId: bill.sessionId,
      admissionId: bill.admissionId,
      billNumber: bill.billNumber,
      totalAmountMinor: bill.totalAmountMinor.toString(),
      currency: bill.currency,
      issueDate: bill.issueDate,
      studentName: bill.admissionNameSnapshot,
      ...(bill.periodKey ? { periodKey: bill.periodKey } : {}),
      ...(bill.billRunId ? { billRunId: bill.billRunId } : {}),
    },
  };
}

/**
 * One `bill.issued` per bill of a posted billing run (to the bill's
 * admission) plus one `billing.run_posted` to the staff member who posted
 * it. Returns the event IDs to hand over after commit.
 */
export async function notifyBillingRunPosted(
  tx: DatabaseExecutor,
  run: { id: string; schoolId: string; sessionId: string; periodKey: string; recordedBy: string },
  bills: readonly PostedBillFacts[],
): Promise<string[]> {
  const inputs: AnyNotifyInput[] = bills.map((bill) => billIssued(bill, run.recordedBy));
  inputs.push({
    type: 'billing.run_posted',
    schoolId: run.schoolId,
    key: `billing-run:${run.id}`,
    createdBy: run.recordedBy,
    recipients: { kind: 'staff_users', userIds: [run.recordedBy] },
    data: { billRunId: run.id, sessionId: run.sessionId, periodKey: run.periodKey, billCount: bills.length },
  } satisfies NotifyInput<'billing.run_posted'>);
  const results = await notifyMany(tx, inputs);
  return results.map((result) => result.eventId);
}

/** One `bill.issued` for a manual bill. */
export async function notifyManualBillPosted(tx: DatabaseExecutor, bill: PostedBillFacts, recordedBy: string): Promise<string[]> {
  const results = await notifyMany(tx, [billIssued(bill, recordedBy)]);
  return results.map((result) => result.eventId);
}

/** One `payment.received` for a recorded payment (with or without its discount). */
export async function notifyPaymentRecorded(
  tx: DatabaseExecutor,
  payment: {
    id: string;
    schoolId: string;
    sessionId: string;
    admissionId: string;
    receiptNumber: string;
    amountMinor: bigint;
    currency: string;
    receivedAt: Date;
    /** The admission's name as snapshotted on the payment. */
    studentName: string;
  },
  recordedBy: string,
): Promise<string[]> {
  const input: NotifyInput<'payment.received'> = {
    type: 'payment.received',
    schoolId: payment.schoolId,
    key: `payment:${payment.id}`,
    createdBy: recordedBy,
    recipients: { kind: 'admissions', admissionIds: [payment.admissionId] },
    data: {
      paymentId: payment.id,
      sessionId: payment.sessionId,
      admissionId: payment.admissionId,
      receiptNumber: payment.receiptNumber,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      receivedAt: payment.receivedAt.toISOString(),
      studentName: payment.studentName,
    },
  };
  const results = await notifyMany(tx, [input]);
  return results.map((result) => result.eventId);
}
