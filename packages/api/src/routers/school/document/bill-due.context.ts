import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import {
  financeAdjustmentTable,
  financeBillLineTable,
  financeBillTable,
  financeLedgerEntryTable,
  financePaymentTable,
  financeRefundTable,
  type FinanceDocumentIdentitySnapshot,
} from "@campuspilot/db/schema/finance";
import { currencyCodeSchema, currencyMinorUnitDigits } from "@campuspilot/db/schema/jsonb/currencies";
import { financeSchemaConfigSchema } from "@campuspilot/db/schema/jsonb/finance-config";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";

import { rpcError } from "../../../errors";
import { calculateBillingPeriod, isValidLocalDate, localDateToInstant } from "../billing/period";
import { MAX_DOCUMENT_SOURCE_ITEMS, type DocumentSource } from "./document.dto";
import { ledgerAccountKey, loadInChunks, type CutoffMap } from "./finance-document.ledger";
import {
  dayAfter,
  documentBillingPeriod,
  documentDateParts,
  formatDocumentMoney,
  localDateOf,
  optionalDocumentMoney,
  type DocumentDateParts,
} from "./finance-document.values";

type BillDueSource = Extract<DocumentSource, { documentType: "bill_due" }>;
type LedgerType = (typeof financeLedgerEntryTable.$inferSelect)["type"];

/**
 * The pinned high-water sequence of an account that had no ledger fact
 * through the date when the Bill due was reviewed. Sequences start at 1, so
 * reading "up to 0" reads nothing: the job prints that account with zeros,
 * exactly as reviewed, whatever was posted since. In the review hash and the
 * artifact's finance source the same account carries `highWaterSequence:
 * null` (no cutoff), its own explicit marker.
 */
const NO_FACTS_HIGH_WATER = "0";

/**
 * What a ledger fact is called on a Bill due, by the server (templates print
 * `label` as it is). Bills and manual bills are listed by their lines, so
 * they have no label of their own here.
 */
const ENTRY_LABELS: Record<LedgerType, string> = {
  bill: "Bill",
  manual_debit_adjustment: "Bill",
  payment: "Payment",
  discount: "Discount",
  waiver: "Waiver",
  write_off: "Write-off",
  refund: "Refund",
  debit_correction: "Debit correction",
  credit_correction: "Credit correction",
  reversal: "Reversal",
};

/** The credit kinds a Bill due totals separately, with the context key of each total. */
const CREDIT_TOTALS = {
  payment: "paidThisPeriod",
  discount: "discountThisPeriod",
  waiver: "waiverThisPeriod",
  write_off: "writeOffThisPeriod",
  credit_correction: "creditCorrectionThisPeriod",
} as const satisfies Partial<Record<LedgerType, string>>;

/**
 * One row of `lines[]` on a Bill due: a line of a bill (billing-run or
 * manual) effective in the period, or another debit fact of the period in
 * its own row (a debit correction, a refund, or the reversal of a credit
 * posted before the period).
 */
export type BillDueLine = {
  kind: "bill_line" | "debit_correction" | "refund" | "reversal";
  slug: string | null;
  name: string;
  note: string | null;
  /** The bill's number for a bill line, else null. */
  billNumber: string | null;
  /** The human reference of the fact: the bill, refund or reversed document number; null when it has none. */
  reference: string | null;
  /** The bill's issue date for a bill line, else the fact's effective date (local to the session). */
  issueDate: DocumentDateParts;
  amount: string;
  amountMinor: string;
  pricingSource: string | null;
};

/**
 * One row of `credits[]`: a credit fact effective in the period, labelled by
 * the server (Payment, Discount, Waiver, Write-off, Credit correction), or
 * the reversal of a debit posted before the period.
 */
export type BillDueCredit = {
  kind: "payment" | "discount" | "waiver" | "write_off" | "credit_correction" | "reversal";
  label: string;
  date: DocumentDateParts;
  reference: string | null;
  note: string | null;
  amount: string;
  amountMinor: string;
};

/**
 * Where a printed student's identity comes from, its own fact (never
 * inferred from whether amounts are zero):
 * - `posting_snapshot`: the identity captured when the account's newest
 *   ledger fact through the date was posted (the finance documents' rule:
 *   what was true when the money moved);
 * - `current_records`: the admission and its enrollment in the session as
 *   they are now, for an account with no fact through the date, or whose
 *   facts predate identity snapshots. Everyone in scope is printed, so such
 *   an account is not left out; there is no posting-time identity to use.
 */
type PrintedIdentity = {
  source: "posting_snapshot" | "current_records";
  admissionName: string;
  admissionNumber: string;
  fatherName: string;
  motherName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  rollNumber: number | null;
};

type PeriodFact = {
  id: string;
  admissionId: string;
  sequence: bigint;
  type: LedgerType;
  direction: "debit" | "credit";
  amountMinor: bigint;
  effectiveAt: Date;
  reversalOfEntryId: string | null;
  note: string | null;
};

function compareFacts(left: PeriodFact, right: PeriodFact) {
  const effective = left.effectiveAt.getTime() - right.effectiveAt.getTime();
  if (effective !== 0) return effective;
  if (left.sequence !== right.sequence) return left.sequence < right.sequence ? -1 : 1;
  return left.id.localeCompare(right.id);
}

/** A stable print order: class, section, roll number, name, admission number. */
function compareIdentity(left: PrintedIdentity, right: PrintedIdentity) {
  const text = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "en", { numeric: true, sensitivity: "base" });
  return (
    text(left.classLabel, right.classLabel) ||
    text(left.sectionLabel, right.sectionLabel) ||
    (left.rollNumber ?? Number.MAX_SAFE_INTEGER) - (right.rollNumber ?? Number.MAX_SAFE_INTEGER) ||
    text(left.admissionName, right.admissionName) ||
    text(left.admissionNumber, right.admissionNumber)
  );
}

/**
 * The admissions a Bill due is for, as the source names them. A session or a
 * class means every student enrolled in it (registered or not: an
 * unregistered student can still owe money). Chosen admissions must belong
 * to the school; a class must be the school's (another school's is NOT_FOUND).
 */
async function recipientAdmissionIds(db: DatabaseExecutor, schoolId: string, source: BillDueSource): Promise<string[]> {
  const { recipients } = source;
  if (recipients.kind === "admissions") {
    const wanted = [...new Set(recipients.admissionIds)];
    const found = await loadInChunks(wanted, (ids) =>
      db.select({ id: admissionTable.id }).from(admissionTable).where(and(eq(admissionTable.schoolId, schoolId), inArray(admissionTable.id, ids))),
    );
    if (found.length !== wanted.length) throw rpcError.notFound("Admission");
    return wanted;
  }
  if (recipients.kind === "class") {
    const [schoolClass] = await db
      .select({ id: classTable.id })
      .from(classTable)
      .where(and(eq(classTable.id, recipients.classId), eq(classTable.schoolId, schoolId)))
      .limit(1);
    if (!schoolClass) throw rpcError.notFound("Class");
  }
  const rows = await db
    .select({ admissionId: studentTable.admissionId })
    .from(studentTable)
    .where(
      and(
        eq(studentTable.schoolId, schoolId),
        eq(studentTable.sessionId, source.sessionId),
        recipients.kind === "class" ? eq(studentTable.classId, recipients.classId) : undefined,
      ),
    )
    // At most one past the limit is needed to refuse.
    .limit(MAX_DOCUMENT_SOURCE_ITEMS + 1);
  return [...new Set(rows.map((row) => row.admissionId))];
}

/**
 * The ledger condition of a chunk of accounts: the school, the accounts, the
 * session currency and, in a job, each account's pinned sequence, applied in
 * SQL (a join on the pinned values), never after loading.
 */
function accountFacts(schoolId: string, admissionIds: string[], currency: string, pinned: Map<string, string> | null): SQL {
  const base = sql`e.school_id = ${schoolId} and e.currency = ${currency} and e.admission_id in (${sql.join(admissionIds.map((id) => sql`${id}`), sql`, `)})`;
  if (!pinned) return base;
  const cut = JSON.stringify(admissionIds.map((admissionId) => ({ admission_id: admissionId, high_water: pinned.get(admissionId)! })));
  return sql`${base} and e.sequence <= (select c.high_water from jsonb_to_recordset(${cut}::jsonb) as c(admission_id text, high_water bigint) where c.admission_id = e.admission_id)`;
}

/**
 * Builds Bills due: for each admission, a bill as of `throughDate` in the
 * same context shape as an ordinary bill, so bill templates print it
 * (docs/document-system.md "Bill due"). Read inside the caller's
 * repeatable-read transaction.
 *
 * - **Who**: everyone in scope is printed, including an account with no
 *   ledger fact through the date (zeros, and its identity from the current
 *   records, see {@link PrintedIdentity}).
 * - **Period**: the billing period containing `throughDate`, from the
 *   session's `recurring` cadence and `cycleStartMonth`
 *   (`calculateBillingPeriod`). Facts count by their ledger effective date,
 *   up to the end of `throughDate` in the session's finance time zone (the
 *   statement rule). A future date is not refused.
 * - **Account**: the whole admission account in the session's currency
 *   (every session), as the ledger page and ordinary bills' balances read it.
 * - **Rows**: every line of every bill effective in the period (`lines[]`,
 *   one row per bill line), other debits in their own row, and one
 *   `credits[]` row per credit. A reversal and the fact it reverses both
 *   disappear when both are in the period; a reversal of an older fact is
 *   its own row (posting refuses a reversal dated before its target, so a
 *   reversal is never older than what it reverses).
 * - **Balances**: `balanceBefore` (a grouped sum of the facts before the
 *   period) is the balance at the period start, `balanceAfter` the amount
 *   due at the end of `throughDate`, and `balanceBefore + bill.total -
 *   credits = balanceAfter` always holds.
 * - **Pinning**: each account's high-water ledger sequence through the date
 *   (null when it has none) is reviewed and hashed; a generation job reads
 *   each account only up to its pinned sequence, in SQL.
 * - **Bulk**: per chunk of accounts, one grouped query for the opening
 *   balances and high waters, one for the period's facts and one for the
 *   newest identity snapshots (`DISTINCT ON`); then one query per kind of
 *   document behind the printed facts. Never queries per admission.
 */
export async function buildBillDueContexts(
  db: DatabaseExecutor,
  schoolId: string,
  source: BillDueSource,
  { school, generatedAt, cutoff }: { school: object; generatedAt: string; cutoff: CutoffMap },
) {
  const [session] = await db
    .select({
      startYear: schoolSessionTable.sessionStartYear,
      endYear: schoolSessionTable.sessionEndYear,
      financeConfig: schoolSessionTable.financeConfig,
    })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, schoolId), eq(schoolSessionTable.id, source.sessionId)))
    .limit(1);
  if (!session) throw rpcError.notFound("School session");
  const financeConfig = financeSchemaConfigSchema.safeParse(session.financeConfig);
  if (!financeConfig.success) throw rpcError.conflict("Complete this session's finance currency, time zone and billing cycle before creating bills due.");
  const { currency, timeZone, cycleStartMonth, recurring } = financeConfig.data;
  if (!isValidLocalDate(source.throughDate)) throw rpcError.badRequest("The bill date must be a real calendar date.");
  const cycleMonth = String(cycleStartMonth).padStart(2, "0");
  if (source.throughDate < `${session.startYear}-${cycleMonth}-01` || source.throughDate >= `${session.endYear}-${cycleMonth}-01`)
    throw rpcError.badRequest("The bill date must fall within the selected finance session.");
  const period = calculateBillingPeriod({ billingDate: source.throughDate, cadence: recurring, cycleStartMonth, timeZone });
  const endAt = localDateToInstant(dayAfter(source.throughDate), timeZone);

  const admissionIds = await recipientAdmissionIds(db, schoolId, source);
  if (admissionIds.length > MAX_DOCUMENT_SOURCE_ITEMS)
    throw rpcError.badRequest(`This selection has more than ${MAX_DOCUMENT_SOURCE_ITEMS.toLocaleString("en-IN")} students. Create at most ${MAX_DOCUMENT_SOURCE_ITEMS.toLocaleString("en-IN")} at a time.`);
  if (!admissionIds.length) throw rpcError.badRequest("This selection has no students.");

  // In a job, every account in scope was pinned when it was accepted; an
  // account that was not (the scope changed since) means the source changed.
  let pinned: Map<string, string> | null = null;
  if (cutoff) {
    pinned = new Map();
    for (const admissionId of admissionIds) {
      const sequence = cutoff.get(ledgerAccountKey(admissionId, currency));
      if (sequence === undefined) throw rpcError.conflict("This document's accounts changed after it was requested. Create it again.");
      pinned.set(admissionId, sequence.toString());
    }
  }

  const startAt = period.startAt.toISOString();
  const end = endAt.toISOString();
  // Opening balance (before the period) and high water (through the date) per account, one grouped query per chunk.
  const totals = await loadInChunks(admissionIds, async (ids) => {
    const result = await db.execute<{ admission_id: string; before_minor: string; after_minor: string; high_water: string | null }>(sql`
      select e.admission_id,
        coalesce(sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end) filter (where e.effective_at < ${startAt}::timestamptz), 0)::text as before_minor,
        sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end)::text as after_minor,
        max(e.sequence)::text as high_water
      from finance_ledger_entry e
      where ${accountFacts(schoolId, ids, currency, pinned)} and e.effective_at < ${end}::timestamptz
      group by e.admission_id`);
    return result.rows;
  });
  const totalsByAdmission = new Map(totals.map((row) => [row.admission_id, row]));
  // The period's facts only.
  const periodRows = await loadInChunks(admissionIds, async (ids) => {
    const result = await db.execute<{ id: string; admission_id: string; sequence: string; type: LedgerType; direction: "debit" | "credit"; amount_minor: string; effective_at: string | Date; reversal_of_entry_id: string | null; note: string | null }>(sql`
      select e.id, e.admission_id, e.sequence::text as sequence, e.type, e.direction, e.amount_minor::text as amount_minor, e.effective_at, e.reversal_of_entry_id, e.note
      from finance_ledger_entry e
      where ${accountFacts(schoolId, ids, currency, pinned)} and e.effective_at >= ${startAt}::timestamptz and e.effective_at < ${end}::timestamptz`);
    return result.rows;
  });
  // The newest identity snapshot through the date per account.
  const snapshotRows = await loadInChunks(admissionIds, async (ids) => {
    const result = await db.execute<{ admission_id: string; document_snapshot: FinanceDocumentIdentitySnapshot }>(sql`
      select distinct on (e.admission_id) e.admission_id, e.document_snapshot
      from finance_ledger_entry e
      where ${accountFacts(schoolId, ids, currency, pinned)} and e.effective_at < ${end}::timestamptz and e.document_snapshot is not null
      order by e.admission_id, e.sequence desc`);
    return result.rows;
  });
  const snapshotByAdmission = new Map(snapshotRows.map((row) => [row.admission_id, row.document_snapshot]));

  // Accounts without a posting-time identity print the current records.
  const withoutSnapshot = admissionIds.filter((admissionId) => {
    const snapshot = snapshotByAdmission.get(admissionId);
    return !snapshot?.admissionName || !snapshot.admissionNumber;
  });
  const currentRows = await loadInChunks(withoutSnapshot, (ids) =>
    db
      .select({
        admissionId: admissionTable.id,
        admissionName: admissionTable.name,
        admissionNumber: admissionTable.admissionNo,
        fatherName: admissionTable.fatherName,
        motherName: admissionTable.motherName,
        classLabel: classTable.label,
        sectionLabel: sectionTable.label,
        rollNumber: studentTable.rollNo,
      })
      .from(admissionTable)
      .leftJoin(studentTable, and(eq(studentTable.schoolId, schoolId), eq(studentTable.admissionId, admissionTable.id), eq(studentTable.sessionId, source.sessionId)))
      .leftJoin(classTable, and(eq(classTable.schoolId, schoolId), eq(classTable.id, studentTable.classId)))
      .leftJoin(sectionTable, and(eq(sectionTable.schoolId, schoolId), eq(sectionTable.id, studentTable.sectionId)))
      .where(and(eq(admissionTable.schoolId, schoolId), inArray(admissionTable.id, ids))),
  );
  const currentByAdmission = new Map(currentRows.map((row) => [row.admissionId, row]));
  const identityOf = (admissionId: string): PrintedIdentity => {
    const snapshot = snapshotByAdmission.get(admissionId);
    if (snapshot?.admissionName && snapshot.admissionNumber)
      return {
        source: "posting_snapshot",
        admissionName: snapshot.admissionName,
        admissionNumber: snapshot.admissionNumber,
        fatherName: snapshot.fatherName,
        motherName: snapshot.motherName,
        classLabel: snapshot.classLabel,
        sectionLabel: snapshot.sectionLabel,
        rollNumber: snapshot.rollNumber,
      };
    const current = currentByAdmission.get(admissionId);
    if (!current) throw rpcError.notFound("Admission");
    return { source: "current_records", ...current };
  };

  // Which facts of the period print, per account: a reversal and the fact it
  // reverses cancel out when both are in the period.
  const factsByAdmission = new Map<string, PeriodFact[]>();
  for (const row of periodRows) {
    const list = factsByAdmission.get(row.admission_id) ?? [];
    list.push({
      id: row.id,
      admissionId: row.admission_id,
      sequence: BigInt(row.sequence),
      type: row.type,
      direction: row.direction,
      amountMinor: BigInt(row.amount_minor),
      effectiveAt: new Date(row.effective_at),
      reversalOfEntryId: row.reversal_of_entry_id,
      note: row.note,
    });
    factsByAdmission.set(row.admission_id, list);
  }
  const printedByAdmission = new Map<string, PeriodFact[]>();
  for (const [admissionId, facts] of factsByAdmission) {
    facts.sort(compareFacts);
    const ids = new Set(facts.map((fact) => fact.id));
    const cancelled = new Set<string>();
    for (const fact of facts)
      if (fact.reversalOfEntryId && ids.has(fact.reversalOfEntryId)) {
        cancelled.add(fact.id);
        cancelled.add(fact.reversalOfEntryId);
      }
    printedByAdmission.set(admissionId, facts.filter((fact) => !cancelled.has(fact.id)));
  }

  // The documents behind the printed facts and behind what their reversals reverse.
  const printed = [...printedByAdmission.values()].flat();
  const targetIds = [...new Set(printed.flatMap((fact) => (fact.reversalOfEntryId ? [fact.reversalOfEntryId] : [])))];
  const detailIds = [...new Set([...printed.map((fact) => fact.id), ...targetIds])];
  const [targets, bills, payments, refunds, adjustments] = await Promise.all([
    loadInChunks(targetIds, (ids) =>
      db
        .select({ id: financeLedgerEntryTable.id, type: financeLedgerEntryTable.type })
        .from(financeLedgerEntryTable)
        .where(and(eq(financeLedgerEntryTable.schoolId, schoolId), inArray(financeLedgerEntryTable.id, ids))),
    ),
    loadInChunks(detailIds, (ids) =>
      db
        .select({ id: financeBillTable.id, ledgerEntryId: financeBillTable.ledgerEntryId, billNumber: financeBillTable.billNumber, issueDate: financeBillTable.issueDate })
        .from(financeBillTable)
        .where(and(eq(financeBillTable.schoolId, schoolId), inArray(financeBillTable.ledgerEntryId, ids))),
    ),
    loadInChunks(detailIds, (ids) =>
      db
        .select({ ledgerEntryId: financePaymentTable.ledgerEntryId, receiptNumber: financePaymentTable.receiptNumber, note: financePaymentTable.note })
        .from(financePaymentTable)
        .where(and(eq(financePaymentTable.schoolId, schoolId), inArray(financePaymentTable.ledgerEntryId, ids))),
    ),
    loadInChunks(detailIds, (ids) =>
      db
        .select({ ledgerEntryId: financeRefundTable.ledgerEntryId, refundNumber: financeRefundTable.refundNumber, reason: financeRefundTable.reason })
        .from(financeRefundTable)
        .where(and(eq(financeRefundTable.schoolId, schoolId), inArray(financeRefundTable.ledgerEntryId, ids))),
    ),
    loadInChunks(detailIds, (ids) =>
      db
        .select({ ledgerEntryId: financeAdjustmentTable.ledgerEntryId, reasonNote: financeAdjustmentTable.reasonNote })
        .from(financeAdjustmentTable)
        .where(and(eq(financeAdjustmentTable.schoolId, schoolId), inArray(financeAdjustmentTable.ledgerEntryId, ids))),
    ),
  ]);
  const targetTypeById = new Map(targets.map((target) => [target.id, target.type]));
  const billByLedger = new Map(bills.map((bill) => [bill.ledgerEntryId, bill]));
  const paymentByLedger = new Map(payments.map((payment) => [payment.ledgerEntryId, payment]));
  const refundByLedger = new Map(refunds.map((refund) => [refund.ledgerEntryId, refund]));
  const adjustmentByLedger = new Map(adjustments.map((adjustment) => [adjustment.ledgerEntryId, adjustment]));
  const printedBillIds = printed.flatMap((fact) => {
    const bill = fact.type === "bill" || fact.type === "manual_debit_adjustment" ? billByLedger.get(fact.id) : undefined;
    return bill ? [bill.id] : [];
  });
  const lines = await loadInChunks(printedBillIds, (ids) =>
    db
      .select({
        billId: financeBillLineTable.billId,
        slug: financeBillLineTable.feeElementSlug,
        name: financeBillLineTable.feeElementName,
        amountMinor: financeBillLineTable.amountMinor,
        pricingSource: financeBillLineTable.pricingSourceKind,
      })
      .from(financeBillLineTable)
      .where(and(eq(financeBillLineTable.schoolId, schoolId), inArray(financeBillLineTable.billId, ids)))
      .orderBy(asc(financeBillLineTable.billId), asc(financeBillLineTable.lineOrder)),
  );
  const linesByBill = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByBill.get(line.billId) ?? [];
    list.push(line);
    linesByBill.set(line.billId, list);
  }

  /** The human reference of a fact: its bill, receipt or refund number; null for adjustments and reversals. */
  const referenceOf = (factId: string) =>
    billByLedger.get(factId)?.billNumber ?? paymentByLedger.get(factId)?.receiptNumber ?? refundByLedger.get(factId)?.refundNumber ?? null;
  const money = (value: bigint) => formatDocumentMoney(value, currency);
  const localDate = (instant: Date) => documentDateParts(localDateOf(instant, timeZone));
  const billingPeriod = documentBillingPeriod(period.cadence, period.startDate, period.endDate);
  const throughDate = documentDateParts(source.throughDate);
  const exponent = currencyMinorUnitDigits(currencyCodeSchema.parse(currency));

  const documents = admissionIds.map((admissionId) => {
    const identity = identityOf(admissionId);
    const billLines: BillDueLine[] = [];
    const credits: BillDueCredit[] = [];
    const totals = { payment: BigInt(0), discount: BigInt(0), waiver: BigInt(0), write_off: BigInt(0), credit_correction: BigInt(0), refund: BigInt(0) };
    let linesTotal = BigInt(0);
    let creditsTotal = BigInt(0);
    const debitRow = (fact: PeriodFact, row: Omit<BillDueLine, "amount" | "amountMinor" | "issueDate" | "billNumber" | "slug" | "pricingSource">) => {
      billLines.push({ ...row, slug: null, billNumber: null, pricingSource: null, issueDate: localDate(fact.effectiveAt), amount: money(fact.amountMinor), amountMinor: fact.amountMinor.toString() });
      linesTotal += fact.amountMinor;
    };
    const creditRow = (fact: PeriodFact, row: Omit<BillDueCredit, "amount" | "amountMinor" | "date">) => {
      credits.push({ ...row, date: localDate(fact.effectiveAt), amount: money(fact.amountMinor), amountMinor: fact.amountMinor.toString() });
      creditsTotal += fact.amountMinor;
    };
    for (const fact of printedByAdmission.get(admissionId) ?? []) {
      if (fact.type === "bill" || fact.type === "manual_debit_adjustment") {
        const bill = billByLedger.get(fact.id);
        const items = bill ? linesByBill.get(bill.id) : undefined;
        if (!bill || !items?.length)
          throw rpcError.conflict(`A bill of ${identity.admissionName} (${identity.admissionNumber}) has no posted lines.`);
        const issueDate = documentDateParts(bill.issueDate);
        let billTotal = BigInt(0);
        for (const item of items) {
          billLines.push({ kind: "bill_line", slug: item.slug, name: item.name, note: null, billNumber: bill.billNumber, reference: bill.billNumber, issueDate, amount: money(item.amountMinor), amountMinor: item.amountMinor.toString(), pricingSource: item.pricingSource });
          billTotal += item.amountMinor;
        }
        if (billTotal !== fact.amountMinor) throw rpcError.conflict(`The lines of bill ${bill.billNumber} do not add up to its amount.`);
        linesTotal += billTotal;
      } else if (fact.type === "refund") {
        const refund = refundByLedger.get(fact.id);
        debitRow(fact, { kind: "refund", name: ENTRY_LABELS.refund, note: refund?.reason ?? fact.note, reference: refund?.refundNumber ?? null });
        totals.refund += fact.amountMinor;
      } else if (fact.type === "debit_correction") {
        debitRow(fact, { kind: "debit_correction", name: ENTRY_LABELS.debit_correction, note: adjustmentByLedger.get(fact.id)?.reasonNote ?? fact.note, reference: null });
      } else if (fact.type === "reversal") {
        // The reversal of a fact posted before the period: its own row, on the side its direction puts it.
        const targetType = fact.reversalOfEntryId ? targetTypeById.get(fact.reversalOfEntryId) : undefined;
        const label = targetType ? `${ENTRY_LABELS[targetType]} reversal` : ENTRY_LABELS.reversal;
        const reference = fact.reversalOfEntryId ? referenceOf(fact.reversalOfEntryId) : null;
        if (fact.direction === "debit") debitRow(fact, { kind: "reversal", name: label, note: fact.note, reference });
        else creditRow(fact, { kind: "reversal", label, reference, note: fact.note });
      } else {
        const note = fact.type === "payment" ? (paymentByLedger.get(fact.id)?.note ?? null) : (adjustmentByLedger.get(fact.id)?.reasonNote ?? fact.note);
        creditRow(fact, { kind: fact.type, label: ENTRY_LABELS[fact.type], reference: referenceOf(fact.id), note });
        totals[fact.type] += fact.amountMinor;
      }
    }
    const before = BigInt(totalsByAdmission.get(admissionId)?.before_minor ?? "0");
    const after = BigInt(totalsByAdmission.get(admissionId)?.after_minor ?? "0");
    // The printed rows must explain the amount due exactly.
    if (before + linesTotal - creditsTotal !== after) throw rpcError.internal();
    const periodTotals = Object.fromEntries(
      Object.entries(CREDIT_TOTALS).map(([kind, key]) => [key, optionalDocumentMoney(totals[kind as keyof typeof CREDIT_TOTALS], currency)]),
    ) as Record<(typeof CREDIT_TOTALS)[keyof typeof CREDIT_TOTALS], string | null>;
    return {
      identity,
      context: {
        school,
        session: { startYear: session.startYear, endYear: session.endYear },
        admission: {
          name: identity.admissionName,
          number: identity.admissionNumber,
          fatherName: identity.fatherName,
          motherName: identity.motherName,
          classLabel: identity.classLabel,
          sectionLabel: identity.sectionLabel,
          rollNumber: identity.rollNumber?.toString() ?? null,
        },
        currency: { code: currency, exponent },
        bill: {
          id: null,
          number: null,
          issueDate: source.throughDate,
          periodKey: period.key,
          period: billingPeriod,
          total: money(linesTotal),
          totalMinor: linesTotal.toString(),
        },
        billDue: { date: throughDate, period: billingPeriod },
        lines: billLines,
        credits,
        balanceBefore: optionalDocumentMoney(before, currency),
        balanceBeforeMinor: before.toString(),
        balanceAfter: money(after),
        balanceAfterMinor: after.toString(),
        ...periodTotals,
        /**
         * Every credit row that is neither a payment nor a discount (waivers,
         * write-offs, credit corrections, reversals of earlier charges), so a
         * design that prints only the paid and discount totals can still add
         * up to the amount due; null when zero.
         */
        otherCreditsThisPeriod: optionalDocumentMoney(creditsTotal - totals.payment - totals.discount, currency),
        refundThisPeriod: optionalDocumentMoney(totals.refund, currency),
        generatedAt,
      },
    };
  });
  documents.sort((left, right) => compareIdentity(left.identity, right.identity));

  // Each account's reviewed high-water sequence through the date; null for an account with no fact (no cutoff).
  const accounts = admissionIds
    .map((admissionId) => ({ admissionId, highWaterSequence: totalsByAdmission.get(admissionId)?.high_water ?? null }))
    .sort((left, right) => left.admissionId.localeCompare(right.admissionId));
  const reviewHash = createHash("sha256")
    .update(JSON.stringify({ documentType: "bill_due", schoolId, sessionId: source.sessionId, currency, timeZone, throughDate: source.throughDate, periodKey: period.key, recipients: source.recipients, accounts }))
    .digest("hex");
  const first = documents[0]!.context;
  return {
    contexts: documents.map((item) => item.context),
    name: documents.length === 1 ? `Bill due ${first.admission.number} ${source.throughDate}` : `${documents.length} bills due ${source.throughDate}`,
    warnings: [] as string[],
    financeSource: {
      kind: "bill_due" as const,
      currency,
      throughDate: source.throughDate,
      timeZone,
      period: { cadence: period.cadence, startDate: period.startDate, endDate: period.endDate },
      accounts,
    },
    reviewHash,
    ledgerCutoff: accounts.map((account) => ({ admissionId: account.admissionId, currency, highWaterSequence: account.highWaterSequence ?? NO_FACTS_HIGH_WATER })),
  };
}
