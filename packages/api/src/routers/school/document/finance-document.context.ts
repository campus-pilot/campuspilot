import type { DatabaseExecutor } from "@campuspilot/db";
import { currencyMinorUnitDigits, currencyCodeSchema } from "@campuspilot/db/schema/jsonb/currencies";
import {
  financeBillLineTable,
  financeBillRunTable,
  financeBillTable,
  financeAdjustmentTable,
  financeLedgerEntryTable,
  financePaymentTable,
  financeRefundTable,
} from "@campuspilot/db/schema/finance";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { financeSchemaConfigSchema } from "@campuspilot/db/schema/jsonb/finance-config";
import { and, asc, eq, inArray, lt, lte, max, or, type SQL } from "drizzle-orm";
import type { DocumentLedgerCutoff } from "@campuspilot/db/schema/document-generation-job";
import { createHash } from "node:crypto";
import { rpcError } from "../../../errors";
import type { DocumentSource } from "./document.dto";
import { schoolDocumentContextFor, type DocumentContextOptions } from "./document.context";
import { isValidLocalDate, localDateToInstant } from "../billing/period";
import { buildBillDueContexts } from "./bill-due.context";
import {
  documentBillingPeriod,
  documentDateParts,
  formatDocumentMoney,
  optionalDocumentMoney,
} from "./finance-document.values";

import { cutoffMap, ledgerAccountKey, loadInChunks, signed, type CutoffMap } from "./finance-document.ledger";

export { formatDocumentMoney } from "./finance-document.values";

type FinanceSource = Extract<DocumentSource, { documentType: "bill" | "receipt" | "statement" | "bill_due" }>;
const amount = formatDocumentMoney;


/** Options of the finance builder: the shared ones plus a pinned ledger cutoff. */
export type FinanceDocumentContextOptions = DocumentContextOptions & {
  /**
   * The per-account high-water sequences a generation job pinned when it was
   * accepted. When given, every ledger read of an account stops at its
   * sequence, so the documents describe the ledger as it was then; an
   * account without one is refused (the source changed). Without it the
   * builder reads the ledger as it is now.
   */
  ledgerCutoff?: readonly DocumentLedgerCutoff[];
};


/** The ledger condition of one account under the cutoff (none without a cutoff). */
function cutoffCondition(cutoff: CutoffMap, admissionId: string, currency: string): SQL | undefined {
  if (!cutoff) return undefined;
  const sequence = cutoff.get(ledgerAccountKey(admissionId, currency));
  if (sequence === undefined) throw rpcError.conflict("This document's accounts changed after it was requested. Create it again.");
  return lte(financeLedgerEntryTable.sequence, sequence);
}

/**
 * The high-water sequence of each account now (the largest posted sequence),
 * read in chunks; what a generation job pins for bills and receipts.
 */
async function accountHighWaters(
  db: DatabaseExecutor,
  schoolId: string,
  accounts: Array<{ admissionId: string; currency: string }>,
): Promise<DocumentLedgerCutoff[]> {
  const wanted = new Set(accounts.map((account) => ledgerAccountKey(account.admissionId, account.currency)));
  const admissionIds = [...new Set(accounts.map((account) => account.admissionId))];
  const rows = await loadInChunks(admissionIds, (ids) => db.select({
    admissionId: financeLedgerEntryTable.admissionId,
    currency: financeLedgerEntryTable.currency,
    sequence: max(financeLedgerEntryTable.sequence),
  }).from(financeLedgerEntryTable).where(and(
    eq(financeLedgerEntryTable.schoolId, schoolId),
    inArray(financeLedgerEntryTable.admissionId, ids),
  )).groupBy(financeLedgerEntryTable.admissionId, financeLedgerEntryTable.currency));
  return rows
    .filter((row) => row.sequence !== null && wanted.has(ledgerAccountKey(row.admissionId, row.currency)))
    .map((row) => ({ admissionId: row.admissionId, currency: row.currency, highWaterSequence: row.sequence!.toString() }))
    .sort((a, b) => a.admissionId.localeCompare(b.admissionId) || a.currency.localeCompare(b.currency));
}

type OrderedLedgerFact = Pick<
  typeof financeLedgerEntryTable.$inferSelect,
  "id" | "admissionId" | "currency" | "effectiveAt" | "sequence" | "direction" | "amountMinor"
>;

function compareLedgerFacts(left: OrderedLedgerFact, right: OrderedLedgerFact) {
  const effectiveDifference = left.effectiveAt.getTime() - right.effectiveAt.getTime();
  if (effectiveDifference !== 0) return effectiveDifference;
  if (left.sequence < right.sequence) return -1;
  if (left.sequence > right.sequence) return 1;
  return left.id.localeCompare(right.id);
}

/** Computes every selected bill's prior balance in one pass per account after
 * chunked loading, preserving the ledger's canonical effective-date order. */
async function billBalancesBefore(
  db: DatabaseExecutor,
  schoolId: string,
  bills: Array<Pick<typeof financeBillTable.$inferSelect, "admissionId" | "currency" | "ledgerEntryId">>,
  cutoff: CutoffMap,
) {
  const accountKeys = new Set(
    bills.map((bill) => ledgerAccountKey(bill.admissionId, bill.currency)),
  );
  const admissionIds = [...new Set(bills.map((bill) => bill.admissionId))];
  const currencies = [...new Set(bills.map((bill) => bill.currency))];
  const facts = await loadInChunks(admissionIds, (ids) => db.select({
    id: financeLedgerEntryTable.id,
    admissionId: financeLedgerEntryTable.admissionId,
    currency: financeLedgerEntryTable.currency,
    effectiveAt: financeLedgerEntryTable.effectiveAt,
    sequence: financeLedgerEntryTable.sequence,
    direction: financeLedgerEntryTable.direction,
    amountMinor: financeLedgerEntryTable.amountMinor,
  }).from(financeLedgerEntryTable).where(and(
    eq(financeLedgerEntryTable.schoolId, schoolId),
    inArray(financeLedgerEntryTable.admissionId, ids),
    inArray(financeLedgerEntryTable.currency, currencies),
  )).orderBy(
    asc(financeLedgerEntryTable.effectiveAt),
    asc(financeLedgerEntryTable.sequence),
    asc(financeLedgerEntryTable.id),
  ));
  const factsByAccount = new Map<string, OrderedLedgerFact[]>();
  for (const fact of facts) {
    const key = ledgerAccountKey(fact.admissionId, fact.currency);
    if (!accountKeys.has(key)) continue;
    if (cutoff) {
      const sequence = cutoff.get(key);
      if (sequence === undefined) throw rpcError.conflict("This document's accounts changed after it was requested. Create it again.");
      // Posted after the job was accepted: not part of this document.
      if (fact.sequence > sequence) continue;
    }
    const accountFacts = factsByAccount.get(key) ?? [];
    accountFacts.push(fact);
    factsByAccount.set(key, accountFacts);
  }
  const selectedLedgerIds = new Set(bills.map((bill) => bill.ledgerEntryId));
  const balances = new Map<string, bigint>();
  for (const accountFacts of factsByAccount.values()) {
    accountFacts.sort(compareLedgerFacts);
    let running = BigInt(0);
    for (const fact of accountFacts) {
      if (selectedLedgerIds.has(fact.id)) balances.set(fact.id, running);
      running += signed(fact);
    }
  }
  return balances;
}

/**
 * Calculates the balance immediately before an immutable ledger fact using
 * the same effective-date ordering exposed by the admission ledger. Sequence
 * alone is insufficient because an earlier-posted fact may take effect after
 * the bill or receipt being rendered.
 */
async function balanceBeforeLedgerFact(
  db: DatabaseExecutor,
  schoolId: string,
  admissionId: string,
  currency: string,
  fact: Pick<typeof financeLedgerEntryTable.$inferSelect, "effectiveAt" | "sequence" | "id">,
  cutoff: CutoffMap,
) {
  const rows = await db.select({ direction: financeLedgerEntryTable.direction, amountMinor: financeLedgerEntryTable.amountMinor })
    .from(financeLedgerEntryTable)
    .where(and(
      eq(financeLedgerEntryTable.schoolId, schoolId),
      eq(financeLedgerEntryTable.admissionId, admissionId),
      eq(financeLedgerEntryTable.currency, currency),
      cutoffCondition(cutoff, admissionId, currency),
      or(
        lt(financeLedgerEntryTable.effectiveAt, fact.effectiveAt),
        and(
          eq(financeLedgerEntryTable.effectiveAt, fact.effectiveAt),
          lt(financeLedgerEntryTable.sequence, fact.sequence),
        ),
        and(
          eq(financeLedgerEntryTable.effectiveAt, fact.effectiveAt),
          eq(financeLedgerEntryTable.sequence, fact.sequence),
          lt(financeLedgerEntryTable.id, fact.id),
        ),
      ),
    ));
  return rows.reduce((total, row) => total + signed(row), BigInt(0));
}

async function schoolContext(db: DatabaseExecutor, schoolId: string, options: DocumentContextOptions) {
  const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (!school) throw rpcError.notFound("School");
  return schoolDocumentContextFor(school, options.images);
}

/** Builds finance documents only from immutable posted facts and their captured
 * identity/configuration snapshots. It deliberately never joins current
 * admissions, enrollments, classes, sections, session finance configuration,
 * or projection caches. */
export async function buildFinanceDocumentContexts(
  db: DatabaseExecutor,
  schoolId: string,
  source: FinanceSource,
  options: FinanceDocumentContextOptions = {},
) {
  const school = await schoolContext(db, schoolId, options);
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const cutoff = cutoffMap(options.ledgerCutoff);
  if (source.documentType === "bill") {
    const bills = await db.select().from(financeBillTable).where(and(
      eq(financeBillTable.schoolId, schoolId),
      eq(financeBillTable.sessionId, source.sessionId),
      eq(financeBillTable.status, "posted"),
      source.billRunId
        ? eq(financeBillTable.billRunId, source.billRunId)
        : inArray(financeBillTable.id, source.billIds!),
    ));
    if (!bills.length || (source.billIds && bills.length !== new Set(source.billIds).size)) throw rpcError.notFound("Posted bill");
    if (source.billRunId && bills.some((bill) => bill.billRunId !== source.billRunId)) throw rpcError.notFound("Posted billing run");
    const billIds = bills.map((bill) => bill.id);
    const runIds = [...new Set(bills.flatMap((bill) => (bill.billRunId ? [bill.billRunId] : [])))];
    const [lines, balanceByLedgerId, runs] = await Promise.all([
      loadInChunks(billIds, (ids) => db.select().from(financeBillLineTable).where(and(eq(financeBillLineTable.schoolId, schoolId), inArray(financeBillLineTable.billId, ids))).orderBy(asc(financeBillLineTable.billId), asc(financeBillLineTable.lineOrder))),
      billBalancesBefore(db, schoolId, bills, cutoff),
      loadInChunks(runIds, (ids) => db.select({
        id: financeBillRunTable.id,
        cadence: financeBillRunTable.cadence,
        periodStartDate: financeBillRunTable.periodStartDate,
        periodEndDate: financeBillRunTable.periodEndDate,
      }).from(financeBillRunTable).where(and(eq(financeBillRunTable.schoolId, schoolId), inArray(financeBillRunTable.id, ids)))),
    ]);
    const runById = new Map(runs.map((run) => [run.id, run]));
    const linesByBillId = new Map<string, typeof lines>();
    for (const line of lines) {
      const billLines = linesByBillId.get(line.billId) ?? [];
      billLines.push(line);
      linesByBillId.set(line.billId, billLines);
    }
    const contexts = bills.sort((a, b) => a.billNumber.localeCompare(b.billNumber)).map((bill) => {
      const beforeMinor = balanceByLedgerId.get(bill.ledgerEntryId);
      if (beforeMinor === undefined) throw rpcError.notFound("Bill ledger fact");
      const afterMinor = beforeMinor + bill.totalAmountMinor;
      // The period the bill's run recorded (its cadence and dates). A bill
      // without a run (a manual bill) has none; neither has a bill whose run is
      // unknown. Never read from the period key's shape.
      const run = bill.billRunId ? runById.get(bill.billRunId) : undefined;
      const issueDate = documentDateParts(bill.issueDate);
      return {
        school,
        session: { startYear: bill.sessionStartYearSnapshot, endYear: bill.sessionEndYearSnapshot },
        admission: { name: bill.admissionNameSnapshot, number: bill.admissionNumberSnapshot, fatherName: null, motherName: null, classLabel: bill.classLabelSnapshot, sectionLabel: bill.sectionLabelSnapshot, rollNumber: bill.rollNumberSnapshot?.toString() ?? null },
        currency: { code: bill.currency, exponent: currencyMinorUnitDigits(currencyCodeSchema.parse(bill.currency)) },
        bill: {
          id: bill.id,
          number: bill.billNumber,
          issueDate: bill.issueDate,
          periodKey: bill.periodKey,
          period: run ? documentBillingPeriod(run.cadence, run.periodStartDate, run.periodEndDate) : null,
          total: amount(bill.totalAmountMinor, bill.currency),
          totalMinor: bill.totalAmountMinor.toString(),
        },
        // An ordinary bill is not a Bill due: no Bill due facts, no credits and no period totals.
        billDue: null,
        lines: (linesByBillId.get(bill.id) ?? []).map((line) => ({
          kind: "bill_line" as const,
          slug: line.feeElementSlug,
          name: line.feeElementName,
          note: null,
          billNumber: bill.billNumber,
          reference: bill.billNumber,
          issueDate,
          amount: amount(line.amountMinor, line.currency),
          amountMinor: line.amountMinor.toString(),
          pricingSource: line.pricingSourceKind,
        })),
        credits: [],
        balanceBefore: optionalDocumentMoney(beforeMinor, bill.currency),
        balanceAfter: amount(afterMinor, bill.currency),
        paidThisPeriod: null,
        discountThisPeriod: null,
        waiverThisPeriod: null,
        writeOffThisPeriod: null,
        creditCorrectionThisPeriod: null,
        refundThisPeriod: null,
        generatedAt,
      };
    });
    const ledgerCutoff = options.ledgerCutoff ? [...options.ledgerCutoff] : await accountHighWaters(db, schoolId, bills);
    return { contexts, name: bills.length === 1 ? `Bill ${bills[0]!.billNumber}` : `${bills.length} bills`, financeSource: { kind: "bill" as const, admissionIds: [...new Set(bills.map((bill) => bill.admissionId))], billIds, billRunId: source.billRunId ?? null }, reviewHash: null, ledgerCutoff };
  }

  if (source.documentType === "bill_due") return buildBillDueContexts(db, schoolId, source, { school, generatedAt, cutoff });

  if (source.documentType === "receipt") {
    const paymentIds = source.transactions.filter((item) => item.kind === "payment").map((item) => item.id);
    const refundIds = source.transactions.filter((item) => item.kind === "refund").map((item) => item.id);
    const [directPayments, refunds] = await Promise.all([
      paymentIds.length ? db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), eq(financePaymentTable.sessionId, source.sessionId), inArray(financePaymentTable.id, paymentIds))) : [],
      refundIds.length ? db.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, schoolId), eq(financeRefundTable.sessionId, source.sessionId), inArray(financeRefundTable.id, refundIds))) : [],
    ]);
    if (directPayments.length !== paymentIds.length || refunds.length !== refundIds.length) throw rpcError.notFound("Receipt transaction");
    const parentPaymentIds = [...new Set([...paymentIds, ...refunds.map((refund) => refund.paymentId)])];
    const payments = await db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), inArray(financePaymentTable.id, parentPaymentIds)));
    if (payments.length !== parentPaymentIds.length) throw rpcError.notFound("Receipt payment snapshot");
    const transactionLedgerIds = [...directPayments.map((payment) => payment.ledgerEntryId), ...refunds.map((refund) => refund.ledgerEntryId)];
    const ledgers = await db.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, schoolId), inArray(financeLedgerEntryTable.id, transactionLedgerIds)));
    if (source.selectionPolicy === "posted_unreversed_payments") {
      const selectedPaymentLedgerIds = directPayments.map(
        (payment) => payment.ledgerEntryId,
      );
      const reversals = selectedPaymentLedgerIds.length
        ? await db
            .select({ id: financeLedgerEntryTable.id })
            .from(financeLedgerEntryTable)
            .where(
              and(
                eq(financeLedgerEntryTable.schoolId, schoolId),
                inArray(
                  financeLedgerEntryTable.reversalOfEntryId,
                  selectedPaymentLedgerIds,
                ),
              ),
            )
        : [];
      if (reversals.length) {
        throw rpcError.conflict(
          "A selected payment was reversed. Refresh the payment selection before creating receipts.",
        );
      }
    }
    const ledgerById = new Map(ledgers.map((entry) => [entry.id, entry]));
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    const refundById = new Map(refunds.map((refund) => [refund.id, refund]));
    const contexts = await Promise.all(source.transactions.map(async (requested) => {
      const refund = requested.kind === "refund" ? refundById.get(requested.id) : null;
      const payment = paymentById.get(refund?.paymentId ?? requested.id);
      if (!payment) throw rpcError.notFound("Receipt payment");
      const ledger = ledgerById.get(refund?.ledgerEntryId ?? payment.ledgerEntryId);
      if (!ledger) throw rpcError.notFound("Receipt ledger fact");
      const snapshot = payment.documentSnapshot;
      if (!snapshot) throw rpcError.conflict("This legacy payment has no immutable receipt identity snapshot.");
      const previousMinor = await balanceBeforeLedgerFact(db, schoolId, payment.admissionId, payment.currency, ledger, cutoff);
      const transactionAmount = refund?.amountMinor ?? payment.amountMinor;
      const remainingMinor = previousMinor + signed(ledger);
      return {
        school,
        session: { startYear: snapshot.sessionStartYear, endYear: snapshot.sessionEndYear },
        admission: { name: snapshot.admissionName, number: snapshot.admissionNumber, fatherName: snapshot.fatherName, motherName: snapshot.motherName, classLabel: snapshot.classLabel, sectionLabel: snapshot.sectionLabel, rollNumber: snapshot.rollNumber?.toString() ?? null },
        currency: { code: payment.currency, exponent: currencyMinorUnitDigits(currencyCodeSchema.parse(payment.currency)) },
        transaction: { kind: requested.kind, isRefund: requested.kind === "refund", id: requested.id, documentNumber: refund?.refundNumber ?? payment.receiptNumber },
        payment: { id: payment.id, receiptNumber: refund?.refundNumber ?? payment.receiptNumber, receivedAt: (refund?.recordedAt ?? payment.receivedAt).toISOString(), amount: amount(transactionAmount, payment.currency), amountMinor: transactionAmount.toString(), method: refund?.method ?? payment.method, externalReference: refund?.externalReference ?? payment.externalReference, payerName: payment.payerName, note: refund?.reason ?? payment.note },
        previousBalance: amount(previousMinor, payment.currency),
        remainingBalance: amount(remainingMinor, payment.currency),
        generatedAt,
      };
    }));
    const ledgerCutoff = options.ledgerCutoff ? [...options.ledgerCutoff] : await accountHighWaters(db, schoolId, payments);
    return { contexts, name: contexts.length === 1 ? `Receipt ${contexts[0]!.payment.receiptNumber}` : `${contexts.length} receipts`, financeSource: { kind: "receipt" as const, admissionIds: [...new Set(payments.map((payment) => payment.admissionId))], transactions: source.transactions }, reviewHash: null, ledgerCutoff };
  }

  const [session] = await db.select({
    startYear: schoolSessionTable.sessionStartYear,
    endYear: schoolSessionTable.sessionEndYear,
    financeConfig: schoolSessionTable.financeConfig,
  }).from(schoolSessionTable).where(and(eq(schoolSessionTable.schoolId, schoolId), eq(schoolSessionTable.id, source.sessionId))).limit(1);
  if (!session) throw rpcError.notFound("School session");
  const financeConfig = financeSchemaConfigSchema.safeParse(session.financeConfig);
  if (!financeConfig.success) throw rpcError.conflict("Complete this session's finance currency and time zone before generating statements.");
  const { currency, timeZone, cycleStartMonth } = financeConfig.data;
  if (!isValidLocalDate(source.throughDate)) throw rpcError.badRequest("Statement date must be a real calendar date.");
  const month = String(cycleStartMonth).padStart(2, "0");
  const sessionStart = `${session.startYear}-${month}-01`;
  const sessionEnd = `${session.endYear}-${month}-01`;
  if (source.throughDate < sessionStart || source.throughDate >= sessionEnd) throw rpcError.badRequest("Statement date must fall within the selected finance session.");
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  if (source.throughDate > today) throw rpcError.badRequest("Statement date cannot be in the future.");
  const date = new Date(`${source.throughDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const endAt = localDateToInstant(date.toISOString().slice(0, 10), timeZone);
  const periodStartDate = `${source.throughDate.slice(0, 7)}-01`;
  const periodStartAt = localDateToInstant(periodStartDate, timeZone);
  const contexts = [];
  const accounts: Array<{ admissionId: string; highWaterSequence: string }> = [];
  for (const admissionId of [...new Set(source.admissionIds)]) {
    const entries = await db.select().from(financeLedgerEntryTable).where(and(
      eq(financeLedgerEntryTable.schoolId, schoolId),
      eq(financeLedgerEntryTable.sessionId, source.sessionId),
      eq(financeLedgerEntryTable.admissionId, admissionId),
      eq(financeLedgerEntryTable.currency, currency),
      lt(financeLedgerEntryTable.effectiveAt, endAt),
      cutoffCondition(cutoff, admissionId, currency),
    )).orderBy(asc(financeLedgerEntryTable.sequence));
    if (!entries.length) throw rpcError.notFound("Admission statement facts");
    const highWater = entries.at(-1)!.sequence;
    accounts.push({ admissionId, highWaterSequence: highWater.toString() });
    const snapshot = entries.at(-1)!.documentSnapshot;
    if (!snapshot?.admissionName || !snapshot.admissionNumber) throw rpcError.conflict("This account has no immutable statement identity snapshot.");
    let running = BigInt(0);
    const ledgerIds = entries.map((entry) => entry.id);
    const [billRefs, paymentRefs, refundRefs, adjustmentRefs] = await Promise.all([
      db.select({ ledgerEntryId: financeBillTable.ledgerEntryId, value: financeBillTable.billNumber }).from(financeBillTable).where(and(eq(financeBillTable.schoolId, schoolId), inArray(financeBillTable.ledgerEntryId, ledgerIds))),
      db.select({ ledgerEntryId: financePaymentTable.ledgerEntryId, value: financePaymentTable.receiptNumber }).from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), inArray(financePaymentTable.ledgerEntryId, ledgerIds))),
      db.select({ ledgerEntryId: financeRefundTable.ledgerEntryId, value: financeRefundTable.refundNumber }).from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, schoolId), inArray(financeRefundTable.ledgerEntryId, ledgerIds))),
      db.select({ ledgerEntryId: financeAdjustmentTable.ledgerEntryId, value: financeAdjustmentTable.reasonCode }).from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, schoolId), inArray(financeAdjustmentTable.ledgerEntryId, ledgerIds))),
    ]);
    const references = new Map([...billRefs, ...paymentRefs, ...refundRefs, ...adjustmentRefs].map((row) => [row.ledgerEntryId, row.value]));
    let openingMinor = BigInt(0);
    const rows = entries.flatMap((entry) => {
      running += signed(entry);
      if (entry.effectiveAt < periodStartAt) {
        openingMinor = running;
        return [];
      }
      return [{ sequence: entry.sequence.toString(), effectiveAt: entry.effectiveAt.toISOString(), reference: references.get(entry.id) ?? `Ledger ${entry.sequence}`, description: entry.note ?? entry.type.replaceAll("_", " "), debit: entry.direction === "debit" ? amount(entry.amountMinor, entry.currency) : "", credit: entry.direction === "credit" ? amount(entry.amountMinor, entry.currency) : "", balance: amount(running, entry.currency) }];
    });
    contexts.push({ school, session: { startYear: snapshot.sessionStartYear, endYear: snapshot.sessionEndYear }, admission: { name: snapshot.admissionName, number: snapshot.admissionNumber, fatherName: snapshot.fatherName, motherName: snapshot.motherName, classLabel: snapshot.classLabel, sectionLabel: snapshot.sectionLabel, rollNumber: snapshot.rollNumber?.toString() ?? null }, currency: { code: currency, exponent: currencyMinorUnitDigits(currencyCodeSchema.parse(currency)) }, statement: { periodStartDate, throughDate: source.throughDate, asOfSequence: highWater.toString(), openingBalance: amount(openingMinor, currency), openingBalanceMinor: openingMinor.toString(), closingBalance: amount(running, currency), closingBalanceMinor: running.toString() }, entries: rows, generatedAt });
  }
  const reviewHash = createHash("sha256").update(JSON.stringify({ schoolId, sessionId: source.sessionId, currency, throughDate: source.throughDate, timeZone, accounts })).digest("hex");
  // A statement's cutoff is its reviewed high-water sequence per account.
  const ledgerCutoff = accounts.map((account) => ({ admissionId: account.admissionId, currency, highWaterSequence: account.highWaterSequence }));
  return { contexts, name: contexts.length === 1 ? `Account statement ${contexts[0]!.admission.number}` : `${contexts.length} account statements`, financeSource: { kind: "statement" as const, currency, throughDate: source.throughDate, timeZone, accounts }, reviewHash, ledgerCutoff };
}
