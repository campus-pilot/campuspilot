import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { financeLedgerEntryTable, financePaymentTable, financeRefundTable } from "@campuspilot/db/schema/finance";
import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from "../../../paginations";
import { assertSchoolSessionContext } from "./ledger-read";

const ZERO = BigInt(0);
const asBigInt = (value: unknown) => typeof value === "bigint" ? value : BigInt(String(value ?? 0));

export async function getSessionFinanceOverview(db: DatabaseExecutor, input: { schoolId: string; sessionId: string; currency?: string }) {
  await assertSchoolSessionContext(db, input.schoolId, input.sessionId);
  const result = await db.execute<{ currency: string; billed: string; payments: string; refunds: string; credit_adjustments: string; debit_adjustments: string; balance: string }>(sql`
    select entry.currency,
      coalesce(sum(entry.amount_minor) filter (where entry.type in ('bill', 'manual_debit_adjustment')), 0)::numeric as billed,
      coalesce(sum(entry.amount_minor) filter (where entry.type = 'payment'), 0)::numeric as payments,
      coalesce(sum(entry.amount_minor) filter (where entry.type = 'refund'), 0)::numeric as refunds,
      coalesce(sum(entry.amount_minor) filter (where entry.type in ('discount', 'waiver', 'write_off', 'credit_correction')), 0)::numeric as credit_adjustments,
      coalesce(sum(entry.amount_minor) filter (where entry.type = 'debit_correction'), 0)::numeric as debit_adjustments,
      coalesce(sum(case when entry.direction = 'debit' then entry.amount_minor else -entry.amount_minor end), 0)::numeric as balance
    from finance_ledger_entry entry
    where entry.school_id = ${input.schoolId} and entry.session_id = ${input.sessionId}
      ${input.currency ? sql`and entry.currency = ${input.currency}` : sql``}
      and entry.type <> 'reversal'
      and not exists (select 1 from finance_ledger_entry reversal where reversal.school_id = entry.school_id and reversal.reversal_of_entry_id = entry.id)
    group by entry.currency order by entry.currency
  `);
  return { currencies: result.rows.map((row) => {
    const billed = asBigInt(row.billed), payment = asBigInt(row.payments), refund = asBigInt(row.refunds), balance = asBigInt(row.balance);
    const netCash = payment - refund;
    const rate = billed === ZERO ? null : ((netCash * BigInt(10_000) + billed / BigInt(2)) / billed).toString();
    return { currency: row.currency, billedMinor: billed.toString(), paymentMinor: payment.toString(), refundMinor: refund.toString(), netCashMinor: netCash.toString(), creditAdjustmentMinor: String(row.credit_adjustments), debitAdjustmentMinor: String(row.debit_adjustments), balanceMinor: balance.toString(), dueMinor: (balance > ZERO ? balance : ZERO).toString(), creditMinor: (balance < ZERO ? -balance : ZERO).toString(), collectionRateBasisPoints: rate };
  }) };
}

type ListInput = { schoolId: string; filters?: { sessionId?: string; currency?: string; from?: Date; to?: Date; method?: "cash" | "bank_transfer" | "card" | "cheque" | "other"; search?: string }; cursor?: string; page?: number; limit: number };

export async function getCollectionRegister(db: DatabaseExecutor, input: ListInput) {
  if (input.filters?.sessionId) await assertSchoolSessionContext(db, input.schoolId, input.filters.sessionId);
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const detailMatches = sql<boolean>`(
    (${financeLedgerEntryTable.type} = 'payment' and exists (select 1 from ${financePaymentTable} p where p.ledger_entry_id = ${financeLedgerEntryTable.id}
      ${input.filters?.method ? sql`and p.method = ${input.filters.method}` : sql``}
      ${input.filters?.search ? sql`and (p.receipt_number ilike ${`%${input.filters.search}%`} or p.external_reference ilike ${`%${input.filters.search}%`})` : sql``}))
    or (${financeLedgerEntryTable.type} = 'refund' and exists (select 1 from ${financeRefundTable} r where r.ledger_entry_id = ${financeLedgerEntryTable.id}
      ${input.filters?.method ? sql`and r.method = ${input.filters.method}` : sql``}
      ${input.filters?.search ? sql`and (r.refund_number ilike ${`%${input.filters.search}%`} or r.external_reference ilike ${`%${input.filters.search}%`})` : sql``}))
  )`;
  const where = and(eq(financeLedgerEntryTable.schoolId, input.schoolId), inArray(financeLedgerEntryTable.type, ["payment", "refund"]), input.filters?.sessionId ? eq(financeLedgerEntryTable.sessionId, input.filters.sessionId) : undefined, input.filters?.currency ? eq(financeLedgerEntryTable.currency, input.filters.currency) : undefined, input.filters?.from ? gte(financeLedgerEntryTable.effectiveAt, input.filters.from) : undefined, input.filters?.to ? lte(financeLedgerEntryTable.effectiveAt, input.filters.to) : undefined, detailMatches);
  const [entries, totals] = await Promise.all([db.select({ entry: financeLedgerEntryTable, admissionNumber: admissionTable.admissionNo, admissionName: admissionTable.name }).from(financeLedgerEntryTable).innerJoin(admissionTable, and(eq(admissionTable.schoolId, financeLedgerEntryTable.schoolId), eq(admissionTable.id, financeLedgerEntryTable.admissionId))).where(where).orderBy(desc(financeLedgerEntryTable.effectiveAt), desc(financeLedgerEntryTable.sequence), desc(financeLedgerEntryTable.id)).limit(pageSize).offset(offset), db.select({ value: count() }).from(financeLedgerEntryTable).where(where)]);
  const ids = entries.map(({ entry }) => entry.id);
  const [payments, refunds, reversals] = await Promise.all([ids.length ? db.select().from(financePaymentTable).where(inArray(financePaymentTable.ledgerEntryId, ids)) : [], ids.length ? db.select().from(financeRefundTable).where(inArray(financeRefundTable.ledgerEntryId, ids)) : [], ids.length ? db.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(inArray(financeLedgerEntryTable.reversalOfEntryId, ids)) : []]);
  const paymentByLedger = new Map(payments.map((row) => [row.ledgerEntryId, row]));
  const refundByLedger = new Map(refunds.map((row) => [row.ledgerEntryId, row]));
  const reversed = new Set(reversals.map(({ target }) => target));
  const totalItems = totals[0]?.value ?? 0, totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({ items: entries.map(({ entry, ...identity }) => {
    const detail = entry.type === "payment" ? paymentByLedger.get(entry.id)! : refundByLedger.get(entry.id)!;
    return { ledgerEntryId: entry.id, admissionId: entry.admissionId, sessionId: entry.sessionId, currency: entry.currency, kind: entry.type as "payment" | "refund", direction: entry.direction as "credit" | "debit", amountMinor: entry.amountMinor.toString(), effectiveAt: entry.effectiveAt, recordedAt: entry.recordedAt, recordedBy: entry.recordedBy, documentNumber: "receiptNumber" in detail ? detail.receiptNumber : detail.refundNumber, method: detail.method, reference: detail.externalReference, ...identity, reversed: reversed.has(entry.id) };
  }), nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, totalPages, totalItems, pageSize });
}

export async function getFeeElementReport(db: DatabaseExecutor, input: ListInput) {
  if (input.filters?.sessionId) await assertSchoolSessionContext(db, input.schoolId, input.filters.sessionId);
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const predicates = sql`bill.school_id = ${input.schoolId} and bill.status = 'posted'
    ${input.filters?.sessionId ? sql`and bill.session_id = ${input.filters.sessionId}` : sql``}
    ${input.filters?.currency ? sql`and bill.currency = ${input.filters.currency}` : sql``}
    ${input.filters?.from ? sql`and bill.finalized_at >= ${input.filters.from}` : sql``}
    ${input.filters?.to ? sql`and bill.finalized_at <= ${input.filters.to}` : sql``}
    ${input.filters?.search ? sql`and (line.fee_element_slug ilike ${`%${input.filters.search}%`} or line.fee_element_name ilike ${`%${input.filters.search}%`})` : sql``}
    and not exists (select 1 from finance_ledger_entry br where br.school_id = bill.school_id and br.reversal_of_entry_id = bill.ledger_entry_id)`;
  const report = sql`select bill.session_id as "sessionId", bill.currency, line.fee_element_slug as "feeElementSlug", line.fee_element_name as "feeElementName",
      count(distinct bill.id)::integer as "billCount", sum(line.amount_minor)::numeric as "billedMinor",
      coalesce(sum((select coalesce(sum(a.amount_minor),0) from finance_adjustment a where a.school_id = bill.school_id and a.bill_line_id = line.id and a.kind <> 'debit_correction' and not exists (select 1 from finance_ledger_entry ar where ar.school_id = a.school_id and ar.reversal_of_entry_id = a.ledger_entry_id))),0)::numeric as "creditAdjustmentMinor",
      coalesce(sum((select coalesce(sum(a.amount_minor),0) from finance_adjustment a where a.school_id = bill.school_id and a.bill_line_id = line.id and a.kind = 'debit_correction' and not exists (select 1 from finance_ledger_entry ar where ar.school_id = a.school_id and ar.reversal_of_entry_id = a.ledger_entry_id))),0)::numeric as "debitAdjustmentMinor"
    from finance_bill_line line inner join finance_bill bill on bill.school_id = line.school_id and bill.id = line.bill_id
    where ${predicates}
    group by bill.session_id, bill.currency, line.fee_element_slug, line.fee_element_name`;
  const [rowResult, totalResult] = await Promise.all([db.execute<{ sessionId: string; currency: string; feeElementSlug: string; feeElementName: string; billCount: number; billedMinor: string; creditAdjustmentMinor: string; debitAdjustmentMinor: string }>(sql`${report} order by "feeElementName", "feeElementSlug" limit ${pageSize} offset ${offset}`), db.execute<{ value: string }>(sql`select count(*)::numeric as value from (${report}) grouped`)]);
  const rows = rowResult.rows;
  const totalItems = Number(totalResult.rows[0]?.value ?? 0), totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({ items: rows.map((row) => ({ ...row, netChargeMinor: (asBigInt(row.billedMinor) + asBigInt(row.debitAdjustmentMinor) - asBigInt(row.creditAdjustmentMinor)).toString() })), nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, totalPages, totalItems, pageSize });
}

export async function getClassFinanceSnapshot(db: DatabaseExecutor, input: ListInput) {
  if (input.filters?.sessionId) await assertSchoolSessionContext(db, input.schoolId, input.filters.sessionId);
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const predicates = sql`bill.school_id = ${input.schoolId} and bill.status = 'posted'
    ${input.filters?.sessionId ? sql`and bill.session_id = ${input.filters.sessionId}` : sql``}
    ${input.filters?.currency ? sql`and bill.currency = ${input.filters.currency}` : sql``}
    ${input.filters?.from ? sql`and bill.finalized_at >= ${input.filters.from}` : sql``}
    ${input.filters?.to ? sql`and bill.finalized_at <= ${input.filters.to}` : sql``}
    ${input.filters?.search ? sql`and bill.class_label_snapshot ilike ${`%${input.filters.search}%`}` : sql``}
    and not exists (select 1 from finance_ledger_entry br where br.school_id = bill.school_id and br.reversal_of_entry_id = bill.ledger_entry_id)`;
  const report = sql`select bill.session_id as "sessionId", bill.currency, bill.class_id_snapshot as "classId", bill.class_label_snapshot as "classLabel",
      count(*)::integer as "billCount", sum(bill.total_amount_minor)::numeric as "billedMinor",
      coalesce(sum((select coalesce(sum(pa.amount_minor),0) from finance_payment_allocation pa where pa.school_id = bill.school_id and pa.bill_id = bill.id)),0)::numeric as "allocatedMinor",
      coalesce(sum((select coalesce(sum(a.amount_minor),0) from finance_adjustment a where a.school_id = bill.school_id and a.bill_id = bill.id and a.kind <> 'debit_correction' and not exists (select 1 from finance_ledger_entry ar where ar.school_id = a.school_id and ar.reversal_of_entry_id = a.ledger_entry_id))),0)::numeric as "creditAdjustmentMinor",
      coalesce(sum((select coalesce(sum(a.amount_minor),0) from finance_adjustment a where a.school_id = bill.school_id and a.bill_id = bill.id and a.kind = 'debit_correction' and not exists (select 1 from finance_ledger_entry ar where ar.school_id = a.school_id and ar.reversal_of_entry_id = a.ledger_entry_id))),0)::numeric as "debitAdjustmentMinor"
    from finance_bill bill where ${predicates}
    group by bill.session_id, bill.currency, bill.class_id_snapshot, bill.class_label_snapshot`;
  const [rowResult, totalResult] = await Promise.all([db.execute<{ sessionId: string; currency: string; classId: string | null; classLabel: string | null; billCount: number; billedMinor: string; allocatedMinor: string; creditAdjustmentMinor: string; debitAdjustmentMinor: string }>(sql`${report} order by "classLabel", "classId" limit ${pageSize} offset ${offset}`), db.execute<{ value: string }>(sql`select count(*)::numeric as value from (${report}) grouped`)]);
  const rows = rowResult.rows;
  const totalItems = Number(totalResult.rows[0]?.value ?? 0), totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({ items: rows.map((row) => ({ ...row, outstandingMinor: (() => { const value = asBigInt(row.billedMinor) + asBigInt(row.debitAdjustmentMinor) - asBigInt(row.creditAdjustmentMinor) - asBigInt(row.allocatedMinor); return (value > ZERO ? value : ZERO).toString(); })() })), nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, totalPages, totalItems, pageSize });
}
