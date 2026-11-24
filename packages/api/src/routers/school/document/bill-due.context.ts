import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable } from "@campuspilot/db/schema/class";
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
import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { rpcError } from "../../../errors";
import { calculateBillingPeriod, isValidLocalDate, localDateToInstant } from "../billing/period";
import { MAX_DOCUMENT_SOURCE_ITEMS, type DocumentSource } from "./document.dto";
import { ledgerAccountKey, loadInChunks, signed, type CutoffMap } from "./finance-document.ledger";
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

type Entry = {
  id: string;
  admissionId: string;
  sequence: bigint;
  type: LedgerType;
  direction: "debit" | "credit";
  amountMinor: bigint;
  effectiveAt: Date;
  reversalOfEntryId: string | null;
  note: string | null;
  hasSnapshot: boolean;
};

function compareEntries(left: Entry, right: Entry) {
  const effective = left.effectiveAt.getTime() - right.effectiveAt.getTime();
  if (effective !== 0) return effective;
  if (left.sequence !== right.sequence) return left.sequence < right.sequence ? -1 : 1;
  return left.id.localeCompare(right.id);
}

/** A stable print order from the posting-time identity: class, section, roll number, name, admission number. */
function compareIdentity(left: FinanceDocumentIdentitySnapshot, right: FinanceDocumentIdentitySnapshot) {
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
 * to the school. Who is enrolled is read only to choose the accounts; what
 * is printed about a student comes from the posting-time ledger identity.
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
 * Builds Bills due: for each admission, a bill as of `throughDate` in the
 * same context shape as an ordinary bill, so bill templates print it
 * (docs/document-system.md "Bill due"). Read inside the caller's
 * repeatable-read transaction.
 *
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
 *   its own row.
 * - **Balances**: `balanceBefore` is the balance at the period start,
 *   `balanceAfter` the amount due at the end of `throughDate`, and
 *   `balanceBefore + bill.total - credits = balanceAfter` always holds.
 * - **Pinning**: like statements, each account's high-water ledger sequence
 *   (through the date) is reviewed and hashed; a generation job reads each
 *   account only up to its pinned sequence (`cutoff`).
 * - **Bulk**: every read is one set-based query per chunk of accounts or
 *   facts, never queries per admission, so 1,500 admissions cost a few
 *   dozen queries.
 *
 * An account with no ledger fact through the date has no posting-time
 * identity to print, so it is left out with a warning; when nobody is left
 * the request is refused.
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

  // Every fact of the accounts through the date, without its identity
  // snapshot (read below only for the one fact each account prints).
  const rows = await loadInChunks(admissionIds, (ids) =>
    db
      .select({
        id: financeLedgerEntryTable.id,
        admissionId: financeLedgerEntryTable.admissionId,
        sequence: financeLedgerEntryTable.sequence,
        type: financeLedgerEntryTable.type,
        direction: financeLedgerEntryTable.direction,
        amountMinor: financeLedgerEntryTable.amountMinor,
        effectiveAt: financeLedgerEntryTable.effectiveAt,
        reversalOfEntryId: financeLedgerEntryTable.reversalOfEntryId,
        note: financeLedgerEntryTable.note,
        hasSnapshot: sql<boolean>`${financeLedgerEntryTable.documentSnapshot} is not null`,
      })
      .from(financeLedgerEntryTable)
      .where(
        and(
          eq(financeLedgerEntryTable.schoolId, schoolId),
          inArray(financeLedgerEntryTable.admissionId, ids),
          eq(financeLedgerEntryTable.currency, currency),
          lt(financeLedgerEntryTable.effectiveAt, endAt),
        ),
      ),
  );
  const entriesByAdmission = new Map<string, Entry[]>();
  for (const row of rows) {
    if (cutoff) {
      // An account the job did not pin had no fact through the date when it
      // was accepted: it stays left out. Facts posted after it are not read.
      const pinned = cutoff.get(ledgerAccountKey(row.admissionId, currency));
      if (pinned === undefined || row.sequence > pinned) continue;
    }
    const list = entriesByAdmission.get(row.admissionId) ?? [];
    list.push(row);
    entriesByAdmission.set(row.admissionId, list);
  }
  const included = admissionIds.filter((admissionId) => entriesByAdmission.get(admissionId)?.length);
  const leftOut = admissionIds.length - included.length;
  if (!included.length) throw rpcError.badRequest(`No selected student has account activity through ${source.throughDate}.`);

  // The posting-time identity each account prints: its newest fact through
  // the date that carries one (facts from before identity snapshots existed
  // carry none).
  const identityEntryIds = included.map((admissionId) => {
    const facts = entriesByAdmission.get(admissionId)!;
    let newest: Entry | undefined;
    for (const fact of facts) if (fact.hasSnapshot && (!newest || fact.sequence > newest.sequence)) newest = fact;
    if (!newest) throw rpcError.conflict("A selected account has no immutable identity snapshot to print a bill with.");
    return newest.id;
  });
  const snapshots = await loadInChunks(identityEntryIds, (ids) =>
    db
      .select({ admissionId: financeLedgerEntryTable.admissionId, snapshot: financeLedgerEntryTable.documentSnapshot })
      .from(financeLedgerEntryTable)
      .where(and(eq(financeLedgerEntryTable.schoolId, schoolId), inArray(financeLedgerEntryTable.id, ids), isNotNull(financeLedgerEntryTable.documentSnapshot))),
  );
  const identityByAdmission = new Map(snapshots.map((row) => [row.admissionId, row.snapshot!]));

  // Which facts of the period print, per account: a reversal and the fact it
  // reverses cancel out when both are in the period.
  const periodFactsByAdmission = new Map<string, Entry[]>();
  const balances = new Map<string, { before: bigint; after: bigint }>();
  const allEntries = new Map<string, Entry>();
  for (const admissionId of included) {
    const facts = entriesByAdmission.get(admissionId)!.sort(compareEntries);
    let before = BigInt(0);
    let after = BigInt(0);
    const inPeriod: Entry[] = [];
    for (const fact of facts) {
      allEntries.set(fact.id, fact);
      after += signed(fact);
      if (fact.effectiveAt < period.startAt) before += signed(fact);
      else inPeriod.push(fact);
    }
    const periodIds = new Set(inPeriod.map((fact) => fact.id));
    const cancelled = new Set<string>();
    for (const fact of inPeriod)
      if (fact.reversalOfEntryId && periodIds.has(fact.reversalOfEntryId)) {
        cancelled.add(fact.id);
        cancelled.add(fact.reversalOfEntryId);
      }
    periodFactsByAdmission.set(admissionId, inPeriod.filter((fact) => !cancelled.has(fact.id)));
    balances.set(admissionId, { before, after });
  }

  // The documents behind the printed facts and behind what their reversals
  // reverse, a set-based read per kind.
  const printed = [...periodFactsByAdmission.values()].flat();
  const detailIds = [...new Set(printed.flatMap((fact) => (fact.reversalOfEntryId ? [fact.id, fact.reversalOfEntryId] : [fact.id])))];
  const [bills, payments, refunds, adjustments] = await Promise.all([
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

  const contexts = included.map((admissionId) => {
    const identity = identityByAdmission.get(admissionId);
    if (!identity?.admissionName || !identity.admissionNumber) throw rpcError.conflict("A selected account has no immutable identity snapshot to print a bill with.");
    const billLines: BillDueLine[] = [];
    const credits: BillDueCredit[] = [];
    const totals = { payment: BigInt(0), discount: BigInt(0), waiver: BigInt(0), write_off: BigInt(0), credit_correction: BigInt(0), refund: BigInt(0) };
    let linesTotal = BigInt(0);
    let creditsTotal = BigInt(0);
    const debitRow = (fact: Entry, row: Omit<BillDueLine, "amount" | "amountMinor" | "issueDate" | "billNumber" | "slug" | "pricingSource">) => {
      billLines.push({ ...row, slug: null, billNumber: null, pricingSource: null, issueDate: localDate(fact.effectiveAt), amount: money(fact.amountMinor), amountMinor: fact.amountMinor.toString() });
      linesTotal += fact.amountMinor;
    };
    const creditRow = (fact: Entry, row: Omit<BillDueCredit, "amount" | "amountMinor" | "date">) => {
      credits.push({ ...row, date: localDate(fact.effectiveAt), amount: money(fact.amountMinor), amountMinor: fact.amountMinor.toString() });
      creditsTotal += fact.amountMinor;
    };
    for (const fact of periodFactsByAdmission.get(admissionId)!) {
      if (fact.type === "bill" || fact.type === "manual_debit_adjustment") {
        const bill = billByLedger.get(fact.id);
        const items = bill ? linesByBill.get(bill.id) : undefined;
        if (!bill || !items?.length) throw rpcError.conflict(`Bill ledger fact ${fact.id} has no posted bill lines.`);
        const issueDate = documentDateParts(bill.issueDate);
        let billTotal = BigInt(0);
        for (const item of items) {
          billLines.push({ kind: "bill_line", slug: item.slug, name: item.name, note: null, billNumber: bill.billNumber, reference: bill.billNumber, issueDate, amount: money(item.amountMinor), amountMinor: item.amountMinor.toString(), pricingSource: item.pricingSource });
          billTotal += item.amountMinor;
        }
        if (billTotal !== fact.amountMinor) throw rpcError.conflict(`Bill ${bill.billNumber} lines do not add up to its ledger amount.`);
        linesTotal += billTotal;
      } else if (fact.type === "refund") {
        const refund = refundByLedger.get(fact.id);
        debitRow(fact, { kind: "refund", name: ENTRY_LABELS.refund, note: refund?.reason ?? fact.note, reference: refund?.refundNumber ?? null });
        totals.refund += fact.amountMinor;
      } else if (fact.type === "debit_correction") {
        debitRow(fact, { kind: "debit_correction", name: ENTRY_LABELS.debit_correction, note: adjustmentByLedger.get(fact.id)?.reasonNote ?? fact.note, reference: null });
      } else if (fact.type === "reversal") {
        // The reversal of a fact posted before the period: its own row, on the side its direction puts it.
        const target = fact.reversalOfEntryId ? allEntries.get(fact.reversalOfEntryId) : undefined;
        const label = target ? `${ENTRY_LABELS[target.type]} reversal` : ENTRY_LABELS.reversal;
        const reference = fact.reversalOfEntryId ? referenceOf(fact.reversalOfEntryId) : null;
        if (fact.direction === "debit") debitRow(fact, { kind: "reversal", name: label, note: fact.note, reference });
        else creditRow(fact, { kind: "reversal", label, reference, note: fact.note });
      } else {
        const note = fact.type === "payment" ? (paymentByLedger.get(fact.id)?.note ?? null) : (adjustmentByLedger.get(fact.id)?.reasonNote ?? fact.note);
        creditRow(fact, { kind: fact.type, label: ENTRY_LABELS[fact.type], reference: referenceOf(fact.id), note });
        totals[fact.type] += fact.amountMinor;
      }
    }
    const { before, after } = balances.get(admissionId)!;
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
        refundThisPeriod: optionalDocumentMoney(totals.refund, currency),
        generatedAt,
      },
    };
  });
  contexts.sort((left, right) => compareIdentity(left.identity, right.identity));

  // Each account's reviewed high-water sequence through the date (the pinned one in a job).
  const accounts = included
    .map((admissionId) => ({
      admissionId,
      highWaterSequence: entriesByAdmission.get(admissionId)!.reduce((high, fact) => (fact.sequence > high ? fact.sequence : high), BigInt(0)).toString(),
    }))
    .sort((left, right) => left.admissionId.localeCompare(right.admissionId));
  const reviewHash = createHash("sha256")
    .update(JSON.stringify({ documentType: "bill_due", schoolId, sessionId: source.sessionId, currency, timeZone, throughDate: source.throughDate, periodKey: period.key, recipients: source.recipients, accounts }))
    .digest("hex");
  const first = contexts[0]!.context;
  return {
    contexts: contexts.map((item) => item.context),
    name: contexts.length === 1 ? `Bill due ${first.admission.number} ${source.throughDate}` : `${contexts.length} bills due ${source.throughDate}`,
    warnings: leftOut
      ? [`${leftOut.toLocaleString("en-IN")} ${leftOut === 1 ? "student has" : "students have"} no account activity through ${source.throughDate} and ${leftOut === 1 ? "is" : "are"} not included.`]
      : [],
    financeSource: {
      kind: "bill_due" as const,
      currency,
      throughDate: source.throughDate,
      timeZone,
      period: { cadence: period.cadence, startDate: period.startDate, endDate: period.endDate },
      accounts,
    },
    reviewHash,
    ledgerCutoff: accounts.map((account) => ({ admissionId: account.admissionId, currency, highWaterSequence: account.highWaterSequence })),
  };
}
