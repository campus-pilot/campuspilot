import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
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
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { rpcError } from "../../../errors";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { serializeFinanceCumulativeInteger, serializeFinanceInteger } from "./transport";

const ZERO = BigInt(0);

function asBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(String(value ?? 0));
}

async function assertAdmissionContext(
  db: DatabaseExecutor,
  input: { schoolId: string; admissionId: string; sessionId?: string },
) {
  const [admission] = await db
    .select({ id: admissionTable.id })
    .from(admissionTable)
    .where(
      and(
        eq(admissionTable.schoolId, input.schoolId),
        eq(admissionTable.id, input.admissionId),
      ),
    )
    .limit(1);
  if (!admission) throw rpcError.notFound("Admission account");
  if (input.sessionId) await assertSchoolSessionContext(db, input.schoolId, input.sessionId);
}

async function assertSchoolSessionContext(
  db: DatabaseExecutor,
  schoolId: string,
  sessionId: string,
) {
  const [session] = await db
    .select({ id: schoolSessionTable.id })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, schoolId), eq(schoolSessionTable.id, sessionId)))
    .limit(1);
  if (!session) throw rpcError.notFound("School session");
}

function amountSplit(balance: bigint) {
  return {
    dueMinor: serializeFinanceCumulativeInteger(balance > ZERO ? balance : ZERO),
    creditMinor: serializeFinanceCumulativeInteger(balance < ZERO ? -balance : ZERO),
  };
}

async function billSettlementMap(
  db: DatabaseExecutor,
  schoolId: string,
  bills: Array<{ id: string; ledgerEntryId: string; totalAmountMinor: bigint }>,
) {
  if (!bills.length) return new Map<string, { allocated: bigint; adjusted: bigint; debited: bigint; reversed: boolean }>();
  const billIds = bills.map(({ id }) => id);
  const ledgerIds = bills.map(({ ledgerEntryId }) => ledgerEntryId);
  const [allocations, adjustments, reversals] = await Promise.all([
    db
      .select({ billId: financePaymentAllocationTable.billId, amount: financePaymentAllocationTable.amountMinor })
      .from(financePaymentAllocationTable)
      .where(and(eq(financePaymentAllocationTable.schoolId, schoolId), inArray(financePaymentAllocationTable.billId, billIds))),
    db
      .select({ billId: financeAdjustmentTable.billId, amount: financeAdjustmentTable.amountMinor, kind: financeAdjustmentTable.kind })
      .from(financeAdjustmentTable)
      .leftJoin(
        financeLedgerEntryTable,
        and(
          eq(financeLedgerEntryTable.schoolId, financeAdjustmentTable.schoolId),
          eq(financeLedgerEntryTable.reversalOfEntryId, financeAdjustmentTable.ledgerEntryId),
        ),
      )
      .where(
        and(
          eq(financeAdjustmentTable.schoolId, schoolId),
          inArray(financeAdjustmentTable.billId, billIds),
          sql`${financeLedgerEntryTable.id} is null`,
        ),
      ),
    db
      .select({ target: financeLedgerEntryTable.reversalOfEntryId })
      .from(financeLedgerEntryTable)
      .where(and(eq(financeLedgerEntryTable.schoolId, schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, ledgerIds))),
  ]);
  const result = new Map<string, { allocated: bigint; adjusted: bigint; debited: bigint; reversed: boolean }>();
  for (const bill of bills) result.set(bill.id, { allocated: ZERO, adjusted: ZERO, debited: ZERO, reversed: false });
  for (const row of allocations) result.get(row.billId)!.allocated += row.amount;
  for (const row of adjustments) if (row.billId) {
    const state = result.get(row.billId)!;
    if (row.kind === "debit_correction") state.debited += row.amount;
    else state.adjusted += row.amount;
  }
  const reversed = new Set(reversals.map(({ target }) => target));
  for (const bill of bills) result.get(bill.id)!.reversed = reversed.has(bill.ledgerEntryId);
  return result;
}

export async function getAdmissionLedger(
  db: DatabaseExecutor,
  input: {
    schoolId: string;
    admissionId: string;
    filters?: {
      sessionId?: string;
      currency?: string;
      effectiveFrom?: Date;
      effectiveTo?: Date;
      types?: Array<typeof financeLedgerEntryTable.$inferSelect.type>;
    };
    cursor?: string;
    page?: number;
    limit: number;
  },
) {
  await assertAdmissionContext(db, {
    schoolId: input.schoolId,
    admissionId: input.admissionId,
    sessionId: input.filters?.sessionId,
  });
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const scope = and(
    eq(financeLedgerEntryTable.schoolId, input.schoolId),
    eq(financeLedgerEntryTable.admissionId, input.admissionId),
    input.filters?.sessionId ? eq(financeLedgerEntryTable.sessionId, input.filters.sessionId) : undefined,
    input.filters?.currency ? eq(financeLedgerEntryTable.currency, input.filters.currency) : undefined,
  );
  const window = and(
    scope,
    input.filters?.effectiveFrom ? gte(financeLedgerEntryTable.effectiveAt, input.filters.effectiveFrom) : undefined,
    input.filters?.effectiveTo ? lte(financeLedgerEntryTable.effectiveAt, input.filters.effectiveTo) : undefined,
    input.filters?.types?.length ? inArray(financeLedgerEntryTable.type, input.filters.types) : undefined,
  );
  const sessionScope = and(
    eq(financeLedgerEntryTable.schoolId, input.schoolId),
    eq(financeLedgerEntryTable.admissionId, input.admissionId),
    input.filters?.sessionId ? eq(financeLedgerEntryTable.sessionId, input.filters.sessionId) : undefined,
    input.filters?.currency ? eq(financeLedgerEntryTable.currency, input.filters.currency) : undefined,
  );
  const [entries, totals, openingRows, closingRows, sessions] = await Promise.all([
    db.select().from(financeLedgerEntryTable).where(window).orderBy(asc(financeLedgerEntryTable.effectiveAt), asc(financeLedgerEntryTable.sequence), asc(financeLedgerEntryTable.id)).limit(pageSize).offset(offset),
    db.select({ value: count() }).from(financeLedgerEntryTable).where(window),
    db.select({
      currency: financeLedgerEntryTable.currency,
      balance: sql<string>`sum(case when ${financeLedgerEntryTable.direction} = 'debit' then ${financeLedgerEntryTable.amountMinor} else -${financeLedgerEntryTable.amountMinor} end)`,
    }).from(financeLedgerEntryTable).where(and(scope, input.filters?.effectiveFrom ? lt(financeLedgerEntryTable.effectiveAt, input.filters.effectiveFrom) : sql`false`)).groupBy(financeLedgerEntryTable.currency),
    db.select({
      currency: financeLedgerEntryTable.currency,
      balance: sql<string>`sum(case when ${financeLedgerEntryTable.direction} = 'debit' then ${financeLedgerEntryTable.amountMinor} else -${financeLedgerEntryTable.amountMinor} end)`,
    }).from(financeLedgerEntryTable).where(and(scope, input.filters?.effectiveTo ? lte(financeLedgerEntryTable.effectiveAt, input.filters.effectiveTo) : undefined)).groupBy(financeLedgerEntryTable.currency),
    db.select({
      schoolId: financeLedgerEntryTable.schoolId,
      admissionId: financeLedgerEntryTable.admissionId,
      sessionId: financeLedgerEntryTable.sessionId,
      currency: financeLedgerEntryTable.currency,
      lastSequence: sql<string>`max(${financeLedgerEntryTable.sequence})::numeric`,
      entryCount: sql<string>`count(*)::numeric`,
      debitTotalMinor: sql<string>`coalesce(sum(${financeLedgerEntryTable.amountMinor}) filter (where ${financeLedgerEntryTable.direction} = 'debit'), 0)::numeric`,
      creditTotalMinor: sql<string>`coalesce(sum(${financeLedgerEntryTable.amountMinor}) filter (where ${financeLedgerEntryTable.direction} = 'credit'), 0)::numeric`,
      rebuiltAt: sql<Date>`max(${financeLedgerEntryTable.recordedAt})`,
    }).from(financeLedgerEntryTable).where(sessionScope)
      .groupBy(financeLedgerEntryTable.schoolId, financeLedgerEntryTable.admissionId, financeLedgerEntryTable.sessionId, financeLedgerEntryTable.currency)
      .orderBy(asc(financeLedgerEntryTable.sessionId), asc(financeLedgerEntryTable.currency)),
  ]);
  const opening = new Map(openingRows.map((row) => [row.currency, asBigInt(row.balance)]));
  const closing = new Map(closingRows.map((row) => [row.currency, asBigInt(row.balance)]));
  const entryIds = entries.map(({ id }) => id);
  const [bills, payments, adjustments, refunds, allocations, runningRows] = await Promise.all([
    entryIds.length ? db.select().from(financeBillTable).where(and(eq(financeBillTable.schoolId, input.schoolId), inArray(financeBillTable.ledgerEntryId, entryIds))) : [],
    entryIds.length ? db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, input.schoolId), inArray(financePaymentTable.ledgerEntryId, entryIds))) : [],
    entryIds.length ? db.select().from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, input.schoolId), inArray(financeAdjustmentTable.ledgerEntryId, entryIds))) : [],
    entryIds.length ? db.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, input.schoolId), inArray(financeRefundTable.ledgerEntryId, entryIds))) : [],
    entryIds.length ? db.select().from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, input.schoolId), inArray(financePaymentAllocationTable.paymentId, db.select({ id: financePaymentTable.id }).from(financePaymentTable).where(inArray(financePaymentTable.ledgerEntryId, entryIds))))) : [],
    entryIds.length ? db.execute<{ id: string; runningBalance: string }>(sql`
      select current_entry.id,
        (select coalesce(sum(case when running.direction = 'debit' then running.amount_minor else -running.amount_minor end), 0)::numeric
          from finance_ledger_entry running
          where running.school_id = current_entry.school_id
            and running.admission_id = current_entry.admission_id
            and running.currency = current_entry.currency
            ${input.filters?.sessionId ? sql`and running.session_id = ${input.filters.sessionId}` : sql``}
            and (running.effective_at, running.sequence, running.id)
              <= (current_entry.effective_at, current_entry.sequence, current_entry.id)) as "runningBalance"
      from finance_ledger_entry current_entry
      where current_entry.id in (${sql.join(entryIds.map((id) => sql`${id}`), sql`, `)})
    `).then((result) => result.rows) : [],
  ]);
  const details = new Map<string, Record<string, unknown>>();
  for (const bill of bills) details.set(bill.ledgerEntryId, { kind: "bill", billId: bill.id, billNumber: bill.billNumber, issueDate: bill.issueDate });
  for (const payment of payments) details.set(payment.ledgerEntryId, {
    kind: "payment", paymentId: payment.id, receiptNumber: payment.receiptNumber, method: payment.method,
    externalReference: payment.externalReference,
    allocations: allocations.filter(({ paymentId }) => paymentId === payment.id).map((row) => ({ billId: row.billId, amountMinor: serializeFinanceInteger(row.amountMinor) })),
  });
  for (const adjustment of adjustments) details.set(adjustment.ledgerEntryId, { kind: "adjustment", adjustmentId: adjustment.id, adjustmentKind: adjustment.kind, billId: adjustment.billId, billLineId: adjustment.billLineId, reasonCode: adjustment.reasonCode, reasonNote: adjustment.reasonNote, calculationSnapshot: adjustment.calculationSnapshot });
  for (const refund of refunds) details.set(refund.ledgerEntryId, { kind: "refund", refundId: refund.id, refundNumber: refund.refundNumber, paymentId: refund.paymentId, method: refund.method, externalReference: refund.externalReference, reason: refund.reason });
  const totalItems = totals[0]?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  const currencies = new Set([...opening.keys(), ...closing.keys()]);
  const runningById = new Map(runningRows.map((row) => [row.id, asBigInt(row.runningBalance)]));
  const firstEntryByCurrency = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) if (!firstEntryByCurrency.has(entry.currency)) firstEntryByCurrency.set(entry.currency, entry);
  const pageOpeningBalances = [...firstEntryByCurrency].sort(([left], [right]) => left.localeCompare(right)).map(([currency, entry]) => {
    const signedAmount = entry.direction === "debit" ? entry.amountMinor : -entry.amountMinor;
    const balance = (runningById.get(entry.id) ?? signedAmount) - signedAmount;
    return { currency, balanceMinor: balance.toString(), ...amountSplit(balance) };
  });
  return {
    openingBalances: [...currencies].sort().map((currency) => ({ currency, balanceMinor: (opening.get(currency) ?? ZERO).toString(), ...amountSplit(opening.get(currency) ?? ZERO) })),
    closingBalances: [...currencies].sort().map((currency) => ({ currency, balanceMinor: (closing.get(currency) ?? ZERO).toString(), ...amountSplit(closing.get(currency) ?? ZERO) })),
    sessionSummaries: sessions.map((row) => {
      const debit = asBigInt(row.debitTotalMinor);
      const credit = asBigInt(row.creditTotalMinor);
      const balance = debit - credit;
      return { ...row, rebuiltAt: new Date(row.rebuiltAt), lastSequence: String(row.lastSequence), entryCount: String(row.entryCount), debitTotalMinor: debit.toString(), creditTotalMinor: credit.toString(), balanceMinor: balance.toString(), ...amountSplit(balance) };
    }),
    pageOpeningBalances,
    entries: createPaginatedResult({
      items: entries.map((entry) => ({ ...entry, sequence: serializeFinanceInteger(entry.sequence), amountMinor: serializeFinanceInteger(entry.amountMinor), runningBalanceMinor: (runningById.get(entry.id) ?? ZERO).toString(), detail: details.get(entry.id) ?? (entry.type === "reversal" ? { kind: "reversal", reversalOfEntryId: entry.reversalOfEntryId } : null) })),
      nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, totalPages, totalItems, pageSize,
    }),
  };
}

export async function getAdmissionFinanceSummary(
  db: DatabaseExecutor,
  input: { schoolId: string; admissionId: string; sessionId?: string },
) {
  await assertAdmissionContext(db, input);
  const reversedBillExpression = sql<boolean>`exists (select 1 from ${financeLedgerEntryTable} br where br.school_id = ${financeBillTable.schoolId} and br.reversal_of_entry_id = ${financeBillTable.ledgerEntryId})`;
  const billAllocatedExpression = sql<bigint>`coalesce((select sum(pa.amount_minor) from ${financePaymentAllocationTable} pa where pa.school_id = ${financeBillTable.schoolId} and pa.bill_id = ${financeBillTable.id}), 0)`;
  const billCreditsExpression = sql<bigint>`coalesce((select sum(fa.amount_minor) from ${financeAdjustmentTable} fa where fa.school_id = ${financeBillTable.schoolId} and fa.bill_id = ${financeBillTable.id} and fa.kind <> 'debit_correction' and not exists (select 1 from ${financeLedgerEntryTable} ar where ar.school_id = fa.school_id and ar.reversal_of_entry_id = fa.ledger_entry_id)), 0)`;
  const billDebitsExpression = sql<bigint>`coalesce((select sum(fa.amount_minor) from ${financeAdjustmentTable} fa where fa.school_id = ${financeBillTable.schoolId} and fa.bill_id = ${financeBillTable.id} and fa.kind = 'debit_correction' and not exists (select 1 from ${financeLedgerEntryTable} ar where ar.school_id = fa.school_id and ar.reversal_of_entry_id = fa.ledger_entry_id)), 0)`;
  const [lifetime, activities, selectedSession, billCounts, unallocated] = await Promise.all([
    db.select({
      currency: financeLedgerEntryTable.currency,
      debitTotalMinor: sql<string>`coalesce(sum(${financeLedgerEntryTable.amountMinor}) filter (where ${financeLedgerEntryTable.direction} = 'debit'), 0)::numeric`,
      creditTotalMinor: sql<string>`coalesce(sum(${financeLedgerEntryTable.amountMinor}) filter (where ${financeLedgerEntryTable.direction} = 'credit'), 0)::numeric`,
    }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, input.schoolId), eq(financeLedgerEntryTable.admissionId, input.admissionId))).groupBy(financeLedgerEntryTable.currency).orderBy(asc(financeLedgerEntryTable.currency)),
    input.sessionId ? db.select({
      sessionId: financeLedgerEntryTable.sessionId,
      currency: financeLedgerEntryTable.currency,
      debitTotalMinor: sql<string>`coalesce(sum(${financeLedgerEntryTable.amountMinor}) filter (where ${financeLedgerEntryTable.direction} = 'debit'), 0)::numeric`,
      creditTotalMinor: sql<string>`coalesce(sum(${financeLedgerEntryTable.amountMinor}) filter (where ${financeLedgerEntryTable.direction} = 'credit'), 0)::numeric`,
      startYear: schoolSessionTable.sessionStartYear,
      endYear: schoolSessionTable.sessionEndYear,
    }).from(financeLedgerEntryTable).innerJoin(schoolSessionTable, and(eq(schoolSessionTable.schoolId, financeLedgerEntryTable.schoolId), eq(schoolSessionTable.id, financeLedgerEntryTable.sessionId))).where(and(eq(financeLedgerEntryTable.schoolId, input.schoolId), eq(financeLedgerEntryTable.admissionId, input.admissionId))).groupBy(financeLedgerEntryTable.sessionId, financeLedgerEntryTable.currency, schoolSessionTable.sessionStartYear, schoolSessionTable.sessionEndYear) : [],
    input.sessionId ? db.select({ startYear: schoolSessionTable.sessionStartYear, endYear: schoolSessionTable.sessionEndYear }).from(schoolSessionTable).where(and(eq(schoolSessionTable.schoolId, input.schoolId), eq(schoolSessionTable.id, input.sessionId))).limit(1) : [],
    db.select({
      currency: financeBillTable.currency,
      open: sql<string>`count(*) filter (where not (${reversedBillExpression}) and ${billAllocatedExpression} + ${billCreditsExpression} < ${financeBillTable.totalAmountMinor} + ${billDebitsExpression})::numeric`,
      settled: sql<string>`count(*) filter (where not (${reversedBillExpression}) and ${billAllocatedExpression} + ${billCreditsExpression} >= ${financeBillTable.totalAmountMinor} + ${billDebitsExpression})::numeric`,
      reversed: sql<string>`count(*) filter (where ${reversedBillExpression})::numeric`,
    }).from(financeBillTable).where(and(eq(financeBillTable.schoolId, input.schoolId), eq(financeBillTable.admissionId, input.admissionId))).groupBy(financeBillTable.currency),
    db.execute<{ currency: string; amount: string }>(sql`
      select payment.currency,
        coalesce(sum(payment.amount_minor
          - coalesce((select sum(allocation.amount_minor) from finance_payment_allocation allocation
              where allocation.school_id = payment.school_id and allocation.payment_id = payment.id), 0)
          - coalesce((select sum(refund.amount_minor) from finance_refund refund
              where refund.school_id = payment.school_id and refund.payment_id = payment.id
                and not exists (select 1 from finance_ledger_entry refund_reversal
                  where refund_reversal.school_id = refund.school_id
                    and refund_reversal.reversal_of_entry_id = refund.ledger_entry_id)), 0)
        ), 0)::numeric as amount
      from finance_payment payment
      where payment.school_id = ${input.schoolId}
        and payment.admission_id = ${input.admissionId}
        and not exists (select 1 from finance_ledger_entry payment_reversal
          where payment_reversal.school_id = payment.school_id
            and payment_reversal.reversal_of_entry_id = payment.ledger_entry_id)
      group by payment.currency
    `).then((result) => result.rows),
  ]);
  const selectedByCurrency = new Map(activities.filter((activity) => activity.sessionId === input.sessionId).map((activity) => [activity.currency, activity]));
  const selectedYears = selectedSession[0];
  const broughtForwardByCurrency = new Map<string, bigint>();
  if (selectedYears) {
    for (const activity of activities) {
      const { startYear, endYear } = activity;
      if (startYear < selectedYears.startYear || (startYear === selectedYears.startYear && endYear < selectedYears.endYear)) {
        const balance = asBigInt(activity.debitTotalMinor) - asBigInt(activity.creditTotalMinor);
        broughtForwardByCurrency.set(activity.currency, (broughtForwardByCurrency.get(activity.currency) ?? ZERO) + balance);
      }
    }
  }
  const unallocatedByCurrency = new Map(unallocated.map((row) => [row.currency, asBigInt(row.amount)]));
  const billCountsByCurrency = new Map(billCounts.map((row) => [row.currency, row]));
  return {
    currencies: lifetime.map((row) => {
      const lifetimeDebit = asBigInt(row.debitTotalMinor);
      const lifetimeCredit = asBigInt(row.creditTotalMinor);
      const balance = lifetimeDebit - lifetimeCredit;
      const activity = selectedByCurrency.get(row.currency);
      const sessionDebit = activity ? asBigInt(activity.debitTotalMinor) : ZERO;
      const sessionCredit = activity ? asBigInt(activity.creditTotalMinor) : ZERO;
      const sessionBalance = sessionDebit - sessionCredit;
      const broughtForward = broughtForwardByCurrency.get(row.currency) ?? ZERO;
      const counts = billCountsByCurrency.get(row.currency);
      return {
        currency: row.currency,
        lifetimeDebitMinor: lifetimeDebit.toString(),
        lifetimeCreditMinor: lifetimeCredit.toString(),
        balanceMinor: balance.toString(),
        ...amountSplit(balance),
        selectedSession: activity ? { debitMinor: sessionDebit.toString(), creditMinor: sessionCredit.toString(), balanceMinor: sessionBalance.toString() } : null,
        broughtForwardMinor: broughtForward.toString(),
        unallocatedCreditMinor: (unallocatedByCurrency.get(row.currency) ?? ZERO).toString(),
        billCounts: { open: Number(counts?.open ?? 0), settled: Number(counts?.settled ?? 0), reversed: Number(counts?.reversed ?? 0) },
      };
    }),
  };
}

export async function listAdmissionBills(
  db: DatabaseExecutor,
  input: { schoolId: string; filters?: { admissionId?: string; sessionId?: string; currency?: string; search?: string; status?: "open" | "settled" | "reversed"; issueFrom?: string; issueTo?: string }; cursor?: string; page?: number; limit: number },
) {
  if (input.filters?.admissionId) await assertAdmissionContext(db, { schoolId: input.schoolId, admissionId: input.filters.admissionId, sessionId: input.filters.sessionId });
  else if (input.filters?.sessionId) await assertSchoolSessionContext(db, input.schoolId, input.filters.sessionId);
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const reversedExpression = sql<boolean>`exists (
    select 1 from ${financeLedgerEntryTable} reversal
    where reversal.school_id = ${financeBillTable.schoolId}
      and reversal.reversal_of_entry_id = ${financeBillTable.ledgerEntryId}
  )`;
  const settlementExpression = sql<bigint>`(
    coalesce((select sum(allocation.amount_minor) from ${financePaymentAllocationTable} allocation
      where allocation.school_id = ${financeBillTable.schoolId} and allocation.bill_id = ${financeBillTable.id}), 0)
    + coalesce((select sum(adjustment.amount_minor) from ${financeAdjustmentTable} adjustment
      where adjustment.school_id = ${financeBillTable.schoolId}
        and adjustment.bill_id = ${financeBillTable.id}
        and adjustment.kind in ('discount', 'waiver', 'write_off', 'credit_correction')
        and not exists (select 1 from ${financeLedgerEntryTable} adjustment_reversal
          where adjustment_reversal.school_id = adjustment.school_id
            and adjustment_reversal.reversal_of_entry_id = adjustment.ledger_entry_id)), 0)
  )`;
  const debitCorrectionExpression = sql<bigint>`coalesce((select sum(adjustment.amount_minor) from ${financeAdjustmentTable} adjustment
    where adjustment.school_id = ${financeBillTable.schoolId}
      and adjustment.bill_id = ${financeBillTable.id}
      and adjustment.kind = 'debit_correction'
      and not exists (select 1 from ${financeLedgerEntryTable} adjustment_reversal
        where adjustment_reversal.school_id = adjustment.school_id
          and adjustment_reversal.reversal_of_entry_id = adjustment.ledger_entry_id)), 0)`;
  const statusWhere = input.filters?.status === "reversed"
    ? reversedExpression
    : input.filters?.status === "settled"
      ? and(sql`not (${reversedExpression})`, sql`${settlementExpression} >= ${financeBillTable.totalAmountMinor} + ${debitCorrectionExpression}`)
      : input.filters?.status === "open"
        ? and(sql`not (${reversedExpression})`, sql`${settlementExpression} < ${financeBillTable.totalAmountMinor} + ${debitCorrectionExpression}`)
        : undefined;
  const where = and(
    eq(financeBillTable.schoolId, input.schoolId),
    input.filters?.admissionId ? eq(financeBillTable.admissionId, input.filters.admissionId) : undefined,
    input.filters?.sessionId ? eq(financeBillTable.sessionId, input.filters.sessionId) : undefined,
    input.filters?.currency ? eq(financeBillTable.currency, input.filters.currency) : undefined,
    input.filters?.search ? or(ilike(financeBillTable.admissionNumberSnapshot, `%${input.filters.search}%`), ilike(financeBillTable.admissionNameSnapshot, `%${input.filters.search}%`), ilike(financeBillTable.billNumber, `%${input.filters.search}%`)) : undefined,
    input.filters?.issueFrom ? gte(financeBillTable.issueDate, input.filters.issueFrom) : undefined,
    input.filters?.issueTo ? lte(financeBillTable.issueDate, input.filters.issueTo) : undefined,
    statusWhere,
  );
  const [rows, totals] = await Promise.all([
    db.select().from(financeBillTable).where(where).orderBy(desc(financeBillTable.issueDate), desc(financeBillTable.id)).limit(pageSize).offset(offset),
    db.select({ value: count() }).from(financeBillTable).where(where),
  ]);
  const settlements = await billSettlementMap(db, input.schoolId, rows);
  const enriched = rows.map((bill) => {
    const state = settlements.get(bill.id)!;
    const settledMinor = state.allocated + state.adjusted;
    const chargeMinor = bill.totalAmountMinor + state.debited;
    const outstanding = state.reversed || settledMinor >= chargeMinor ? ZERO : chargeMinor - settledMinor;
    const status: "reversed" | "settled" | "open" = state.reversed ? "reversed" : outstanding === ZERO ? "settled" : "open";
    return { ...bill, totalAmountMinor: bill.totalAmountMinor.toString(), allocatedMinor: state.allocated.toString(), adjustedMinor: state.adjusted.toString(), debitedAdjustmentMinor: state.debited.toString(), outstandingMinor: outstanding.toString(), status };
  });
  const totalItems = totals[0]?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({ items: enriched, nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, totalPages, totalItems, pageSize });
}

export async function getAdmissionBill(db: DatabaseExecutor, input: { schoolId: string; admissionId: string; billId: string; allocationPage: number; allocationLimit: number; adjustmentPage: number; adjustmentLimit: number }) {
  await assertAdmissionContext(db, input);
  const [bill] = await db.select().from(financeBillTable).where(and(eq(financeBillTable.schoolId, input.schoolId), eq(financeBillTable.admissionId, input.admissionId), eq(financeBillTable.id, input.billId))).limit(1);
  if (!bill) throw rpcError.notFound("Bill");
  const allocationOffset = (input.allocationPage - 1) * input.allocationLimit;
  const adjustmentOffset = (input.adjustmentPage - 1) * input.adjustmentLimit;
  const [lines, allocations, adjustments, allocationTotals, adjustmentTotals] = await Promise.all([
    db.select().from(financeBillLineTable).where(and(eq(financeBillLineTable.schoolId, input.schoolId), eq(financeBillLineTable.billId, input.billId))).orderBy(asc(financeBillLineTable.lineOrder)),
    db.select().from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, input.schoolId), eq(financePaymentAllocationTable.billId, input.billId))).orderBy(asc(financePaymentAllocationTable.recordedAt), asc(financePaymentAllocationTable.id)).limit(input.allocationLimit).offset(allocationOffset),
    db.select().from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, input.schoolId), eq(financeAdjustmentTable.billId, input.billId))).orderBy(asc(financeAdjustmentTable.recordedAt), asc(financeAdjustmentTable.id)).limit(input.adjustmentLimit).offset(adjustmentOffset),
    db.select({ value: count() }).from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, input.schoolId), eq(financePaymentAllocationTable.billId, input.billId))),
    db.select({ value: count() }).from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, input.schoolId), eq(financeAdjustmentTable.billId, input.billId))),
  ]);
  const settlement = (await billSettlementMap(db, input.schoolId, [bill])).get(bill.id)!;
  const adjustmentReversals = adjustments.length ? await db.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, input.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, adjustments.map(({ ledgerEntryId }) => ledgerEntryId)))) : [];
  const reversedAdjustments = new Set(adjustmentReversals.map(({ target }) => target));
  const chargeMinor = bill.totalAmountMinor + settlement.debited;
  const outstanding = settlement.reversed || settlement.allocated + settlement.adjusted >= chargeMinor ? ZERO : chargeMinor - settlement.allocated - settlement.adjusted;
  const allocationItems = allocationTotals[0]?.value ?? 0;
  const allocationPages = Math.ceil(allocationItems / input.allocationLimit);
  const adjustmentItems = adjustmentTotals[0]?.value ?? 0;
  const adjustmentPages = Math.ceil(adjustmentItems / input.adjustmentLimit);
  return { ...bill, totalAmountMinor: bill.totalAmountMinor.toString(), reversed: settlement.reversed, allocatedMinor: settlement.allocated.toString(), adjustedMinor: settlement.adjusted.toString(), debitedAdjustmentMinor: settlement.debited.toString(), outstandingMinor: outstanding.toString(), lines: lines.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })), allocations: createPaginatedResult({ items: allocations.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })), nextCursor: createNextPageCursor(input.allocationPage, allocationPages), currentPage: input.allocationPage, totalPages: allocationPages, totalItems: allocationItems, pageSize: input.allocationLimit }), adjustments: createPaginatedResult({ items: adjustments.map((row) => ({ ...row, amountMinor: row.amountMinor.toString(), reversed: reversedAdjustments.has(row.ledgerEntryId) })), nextCursor: createNextPageCursor(input.adjustmentPage, adjustmentPages), currentPage: input.adjustmentPage, totalPages: adjustmentPages, totalItems: adjustmentItems, pageSize: input.adjustmentLimit }) };
}

export async function listPayments(
  db: DatabaseExecutor,
  input: { schoolId: string; filters?: { admissionId?: string; sessionId?: string; currency?: string; search?: string; method?: typeof financePaymentTable.$inferSelect.method; externalReference?: string; status?: "unallocated" | "partially_allocated" | "allocated" | "reversed"; receivedFrom?: Date; receivedTo?: Date }; cursor?: string; page?: number; limit: number },
) {
  if (input.filters?.admissionId) await assertAdmissionContext(db, { schoolId: input.schoolId, admissionId: input.filters.admissionId, sessionId: input.filters.sessionId });
  else if (input.filters?.sessionId) await assertSchoolSessionContext(db, input.schoolId, input.filters.sessionId);
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const reversedExpression = sql<boolean>`exists (
    select 1 from ${financeLedgerEntryTable} payment_reversal
    where payment_reversal.school_id = ${financePaymentTable.schoolId}
      and payment_reversal.reversal_of_entry_id = ${financePaymentTable.ledgerEntryId}
  )`;
  const allocatedExpression = sql<bigint>`coalesce((
    select sum(allocation.amount_minor) from ${financePaymentAllocationTable} allocation
    where allocation.school_id = ${financePaymentTable.schoolId}
      and allocation.payment_id = ${financePaymentTable.id}
  ), 0)`;
  const refundedExpression = sql<bigint>`coalesce((
    select sum(refund.amount_minor) from ${financeRefundTable} refund
    where refund.school_id = ${financePaymentTable.schoolId}
      and refund.payment_id = ${financePaymentTable.id}
      and not exists (select 1 from ${financeLedgerEntryTable} refund_reversal
        where refund_reversal.school_id = refund.school_id
          and refund_reversal.reversal_of_entry_id = refund.ledger_entry_id)
  ), 0)`;
  const remainingExpression = sql<bigint>`${financePaymentTable.amountMinor} - ${allocatedExpression} - ${refundedExpression}`;
  const statusWhere = input.filters?.status === "reversed"
    ? reversedExpression
    : input.filters?.status === "allocated"
      ? and(sql`not (${reversedExpression})`, sql`${remainingExpression} = 0`, sql`${allocatedExpression} > 0`)
      : input.filters?.status === "partially_allocated"
        ? and(sql`not (${reversedExpression})`, sql`${allocatedExpression} > 0`, sql`${remainingExpression} > 0`)
        : input.filters?.status === "unallocated"
          ? and(sql`not (${reversedExpression})`, sql`${allocatedExpression} = 0`)
          : undefined;
  const paymentWhere = and(
    eq(financePaymentTable.schoolId, input.schoolId),
    input.filters?.admissionId ? eq(financePaymentTable.admissionId, input.filters.admissionId) : undefined,
    input.filters?.sessionId ? eq(financePaymentTable.sessionId, input.filters.sessionId) : undefined,
    input.filters?.currency ? eq(financePaymentTable.currency, input.filters.currency) : undefined,
    input.filters?.method ? eq(financePaymentTable.method, input.filters.method) : undefined,
    input.filters?.externalReference ? ilike(financePaymentTable.externalReference, `%${input.filters.externalReference}%`) : undefined,
    input.filters?.search ? or(ilike(admissionTable.admissionNo, `%${input.filters.search}%`), ilike(admissionTable.name, `%${input.filters.search}%`), ilike(financePaymentTable.receiptNumber, `%${input.filters.search}%`), ilike(financePaymentTable.externalReference, `%${input.filters.search}%`)) : undefined,
    input.filters?.receivedFrom ? gte(financePaymentTable.receivedAt, input.filters.receivedFrom) : undefined,
    input.filters?.receivedTo ? lte(financePaymentTable.receivedAt, input.filters.receivedTo) : undefined,
    statusWhere,
  );
  const baseQuery = () => db.select({ payment: financePaymentTable, admissionNumber: admissionTable.admissionNo, admissionName: admissionTable.name }).from(financePaymentTable).innerJoin(admissionTable, and(eq(admissionTable.schoolId, financePaymentTable.schoolId), eq(admissionTable.id, financePaymentTable.admissionId))).where(paymentWhere);
  const [rows, totals] = await Promise.all([
    baseQuery().orderBy(desc(financePaymentTable.receivedAt), desc(financePaymentTable.id)).limit(pageSize).offset(offset),
    db.select({ value: count() }).from(financePaymentTable).innerJoin(admissionTable, and(eq(admissionTable.schoolId, financePaymentTable.schoolId), eq(admissionTable.id, financePaymentTable.admissionId))).where(paymentWhere),
  ]);
  const ids = rows.map(({ payment }) => payment.id);
  const ledgerIds = rows.map(({ payment }) => payment.ledgerEntryId);
  const [allocations, refunds, reversals] = await Promise.all([
    ids.length ? db.select().from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, input.schoolId), inArray(financePaymentAllocationTable.paymentId, ids))) : [],
    ids.length ? db.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, input.schoolId), inArray(financeRefundTable.paymentId, ids))) : [],
    ledgerIds.length ? db.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, input.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, ledgerIds))) : [],
  ]);
  const refundReversals = refunds.length ? await db.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, input.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, refunds.map(({ ledgerEntryId }) => ledgerEntryId)))) : [];
  const reversed = new Set([...reversals, ...refundReversals].map(({ target }) => target));
  const enriched = rows.map(({ payment, ...identity }) => {
    const allocated = allocations.filter(({ paymentId }) => paymentId === payment.id).reduce((sum, row) => sum + row.amountMinor, ZERO);
    const refunded = refunds.filter(({ paymentId, ledgerEntryId }) => paymentId === payment.id && !reversed.has(ledgerEntryId)).reduce((sum, row) => sum + row.amountMinor, ZERO);
    const paymentReversed = reversed.has(payment.ledgerEntryId);
    const unallocated = paymentReversed ? ZERO : payment.amountMinor - allocated - refunded;
    const status: "reversed" | "unallocated" | "allocated" | "partially_allocated" = paymentReversed ? "reversed" : allocated === ZERO ? "unallocated" : unallocated === ZERO ? "allocated" : "partially_allocated";
    return { ...payment, ...identity, amountMinor: payment.amountMinor.toString(), allocatedMinor: allocated.toString(), refundedMinor: refunded.toString(), unallocatedCreditMinor: unallocated.toString(), status };
  });
  const totalItems = totals[0]?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({ items: enriched, nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, totalPages, totalItems, pageSize });
}

export async function getPayment(db: DatabaseExecutor, input: { schoolId: string; admissionId: string; paymentId: string; allocationPage: number; allocationLimit: number; refundPage: number; refundLimit: number }) {
  await assertAdmissionContext(db, input);
  const [payment] = await db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, input.schoolId), eq(financePaymentTable.admissionId, input.admissionId), eq(financePaymentTable.id, input.paymentId))).limit(1);
  if (!payment) throw rpcError.notFound("Payment");
  const allocationOffset = (input.allocationPage - 1) * input.allocationLimit;
  const refundOffset = (input.refundPage - 1) * input.refundLimit;
  const [allocations, refunds, reversal, allocationTotals, refundTotals] = await Promise.all([
    db.select().from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, input.schoolId), eq(financePaymentAllocationTable.paymentId, input.paymentId))).orderBy(asc(financePaymentAllocationTable.recordedAt), asc(financePaymentAllocationTable.id)).limit(input.allocationLimit).offset(allocationOffset),
    db.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, input.schoolId), eq(financeRefundTable.paymentId, input.paymentId))).orderBy(asc(financeRefundTable.recordedAt), asc(financeRefundTable.id)).limit(input.refundLimit).offset(refundOffset),
    db.select({ id: financeLedgerEntryTable.id }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, input.schoolId), eq(financeLedgerEntryTable.reversalOfEntryId, payment.ledgerEntryId))).limit(1),
    db.select({ value: count() }).from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, input.schoolId), eq(financePaymentAllocationTable.paymentId, input.paymentId))),
    db.select({ value: count() }).from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, input.schoolId), eq(financeRefundTable.paymentId, input.paymentId))),
  ]);
  const refundReversals = refunds.length ? await db.select({ target: financeLedgerEntryTable.reversalOfEntryId }).from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, input.schoolId), inArray(financeLedgerEntryTable.reversalOfEntryId, refunds.map(({ ledgerEntryId }) => ledgerEntryId)))) : [];
  const reversedRefunds = new Set(refundReversals.map(({ target }) => target));
  const [effective] = await db.select({
    allocated: sql<string>`coalesce(sum(${financePaymentAllocationTable.amountMinor}), 0)`,
  }).from(financePaymentAllocationTable).where(and(eq(financePaymentAllocationTable.schoolId, input.schoolId), eq(financePaymentAllocationTable.paymentId, input.paymentId)));
  const [effectiveRefund] = await db.select({
    refunded: sql<string>`coalesce(sum(${financeRefundTable.amountMinor}) filter (where not exists (select 1 from ${financeLedgerEntryTable} rr where rr.school_id = ${financeRefundTable.schoolId} and rr.reversal_of_entry_id = ${financeRefundTable.ledgerEntryId})), 0)`,
  }).from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, input.schoolId), eq(financeRefundTable.paymentId, input.paymentId)));
  const allocated = asBigInt(effective?.allocated);
  const refunded = asBigInt(effectiveRefund?.refunded);
  const paymentReversed = Boolean(reversal[0]);
  const allocationItems = allocationTotals[0]?.value ?? 0;
  const allocationPages = Math.ceil(allocationItems / input.allocationLimit);
  const refundItems = refundTotals[0]?.value ?? 0;
  const refundPages = Math.ceil(refundItems / input.refundLimit);
  return { ...payment, amountMinor: payment.amountMinor.toString(), allocatedMinor: allocated.toString(), refundedMinor: refunded.toString(), unallocatedCreditMinor: (paymentReversed ? ZERO : payment.amountMinor - allocated - refunded).toString(), reversed: paymentReversed, allocations: createPaginatedResult({ items: allocations.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })), nextCursor: createNextPageCursor(input.allocationPage, allocationPages), currentPage: input.allocationPage, totalPages: allocationPages, totalItems: allocationItems, pageSize: input.allocationLimit }), refunds: createPaginatedResult({ items: refunds.map((row) => ({ ...row, amountMinor: row.amountMinor.toString(), reversed: reversedRefunds.has(row.ledgerEntryId) })), nextCursor: createNextPageCursor(input.refundPage, refundPages), currentPage: input.refundPage, totalPages: refundPages, totalItems: refundItems, pageSize: input.refundLimit }) };
}

export { assertAdmissionContext, assertSchoolSessionContext, billSettlementMap };
