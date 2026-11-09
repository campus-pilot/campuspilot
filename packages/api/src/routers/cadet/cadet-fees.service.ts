import type { DatabaseExecutor } from '@campuspilot/db';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { and, eq } from 'drizzle-orm';

import { getAdmissionBill, getAdmissionFinanceSummary, getAdmissionLedger } from '../school/billing/ledger-read';
import type { CadetBillDto, CadetFeeSummaryDto, CadetLedgerEntryDto } from './cadet.dto';

/**
 * The cadet's fee views reuse the staff ledger reads (the same queries,
 * running balances and settlement rules as management) with the school and
 * admission bound from the login, then narrow the result to what a student
 * may see. Payments are account-level credits in this finance model, so a
 * bill shows its own concessions but never a per-bill "paid" amount.
 */

type Cadet = { schoolId: string; admissionId: string };

export async function cadetFeeSummary(db: DatabaseExecutor, cadet: Cadet): Promise<CadetFeeSummaryDto> {
  const summary = await getAdmissionFinanceSummary(db, cadet);
  return {
    currencies: summary.currencies.map((row) => ({
      currency: row.currency,
      balanceMinor: row.balanceMinor,
      dueMinor: row.dueMinor,
      creditMinor: row.creditMinor,
      billedMinor: row.billedMinor,
      paidMinor: row.collectedMinor,
      concessionsMinor: row.creditAdjustmentMinor,
      refundedMinor: row.refundMinor,
    })),
  };
}

const detailString = (detail: Record<string, unknown> | null, key: string) =>
  typeof detail?.[key] === 'string' ? (detail[key] as string) : null;

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'other'] as const;

export async function cadetFeeLedger(
  db: DatabaseExecutor,
  cadet: Cadet,
  input: { cursor?: string; page?: number; limit: number },
) {
  const ledger = await getAdmissionLedger(db, {
    ...cadet,
    cursor: input.cursor,
    page: input.page,
    limit: input.limit,
    orderBy: { field: 'effectiveAt', direction: 'desc' },
  });
  const items: CadetLedgerEntryDto[] = ledger.entries.items.map((entry) => {
    const kind = detailString(entry.detail, 'kind');
    const method = detailString(entry.detail, 'method');
    return {
      id: entry.id,
      sessionId: entry.sessionId,
      type: entry.type,
      direction: entry.direction,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      effectiveAt: entry.effectiveAt,
      timeZone: entry.timeZone,
      runningBalanceMinor: entry.runningBalanceMinor,
      reversed: entry.reversed,
      reference:
        kind === 'bill'
          ? detailString(entry.detail, 'billNumber')
          : kind === 'payment'
            ? detailString(entry.detail, 'receiptNumber')
            : kind === 'refund'
              ? detailString(entry.detail, 'refundNumber')
              : null,
      billId: kind === 'bill' ? detailString(entry.detail, 'billId') : null,
      paymentMethod:
        kind === 'payment' && PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])
          ? (method as (typeof PAYMENT_METHODS)[number])
          : null,
    };
  });
  return { items, pagination: ledger.entries.pagination };
}

/** At most this many adjustments are listed on one bill; real bills have a handful. */
const BILL_ADJUSTMENT_LIMIT = 100;

export async function cadetBill(db: DatabaseExecutor, cadet: Cadet, billId: string): Promise<CadetBillDto> {
  // Scoped by the cadet's own admission: another student's bill is NOT_FOUND.
  const bill = await getAdmissionBill(db, {
    ...cadet,
    billId,
    adjustmentPage: 1,
    adjustmentLimit: BILL_ADJUSTMENT_LIMIT,
  });
  const [session] = await db
    .select({ start: schoolSessionTable.sessionStartYear, end: schoolSessionTable.sessionEndYear })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, cadet.schoolId), eq(schoolSessionTable.id, bill.sessionId)))
    .limit(1);
  const start = session?.start ?? bill.sessionStartYearSnapshot;
  const end = session?.end ?? bill.sessionEndYearSnapshot;
  return {
    id: bill.id,
    billNumber: bill.billNumber,
    issueDate: bill.issueDate,
    periodKey: bill.periodKey,
    sessionLabel: `${start}–${String(end).slice(-2)}`,
    classLabel: bill.classLabelSnapshot,
    sectionLabel: bill.sectionLabelSnapshot,
    currency: bill.currency,
    totalAmountMinor: bill.totalAmountMinor,
    addedMinor: bill.debitedAdjustmentMinor,
    concessionsMinor: bill.adjustedMinor,
    netAmountMinor: bill.netAmountMinor,
    reversed: bill.reversed,
    lines: bill.lines.map((line) => ({ id: line.id, name: line.feeElementName, amountMinor: line.amountMinor })),
    adjustments: bill.adjustments.items.map((adjustment) => ({
      id: adjustment.id,
      kind: adjustment.kind,
      amountMinor: adjustment.amountMinor,
      recordedAt: adjustment.recordedAt,
      reversed: adjustment.reversed,
    })),
  };
}
